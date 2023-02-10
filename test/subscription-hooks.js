'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const WebSocket = require('ws')
const { once } = require('events')
const { GraphQLSchema, parse } = require('graphql')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const { users } = require('./utils/mocks')

let assignedPort = 3700

const messages = {}

const userSchema = `
extend type Query {
  me: User
}

type User @key(fields: "id") {
  id: ID!
  name: String!
}
`

const messageSchema = `
extend type Mutation {
  sendMessage(message: MessageInput!): Message
}

extend type Subscription {
  newMessage(toUser: ID!): Message
}

type Message @key(fields: "id") {
  id: ID!
  text: String!
  from: User
  to: User
}

extend type User @key(fields: "id") {
  id: ID! @external
  messages: [Message]
}

input MessageInput {
  fromUserId: ID!
  toUserId: ID!
  text: String!
}
`

function query (user) {
  return `
    subscription {
      newMessage(toUser: "${user}") {
        id
        text
        from {
          id
          name
        }
        to {
          id
          name
        }
      }
    }
  `
}

const userResolvers = {
  Query: {
    me: () => {
      return users.u2
    }
  },
  User: {
    __resolveReference: user => {
      return users[user.id]
    }
  }
}

const messageResolvers = {
  Mutation: {
    async sendMessage (root, { message }, { pubsub }) {
      const id = Object.values(messages).length + 1

      const result = {
        id,
        ...message
      }

      messages[id] = result

      await pubsub.publish({
        topic: `NEW_MESSAGE_${message.toUserId}`,
        payload: {
          newMessage: result
        }
      })

      return result
    }
  },
  Subscription: {
    newMessage: {
      subscribe: async (root, { toUser }, { pubsub }) => {
        const subscription = await pubsub.subscribe(`NEW_MESSAGE_${toUser}`)

        return subscription
      }
    }
  },
  Message: {
    __resolveReference: message => messages[message.id],
    from: message => {
      return {
        __typename: 'User',
        id: message.fromUserId
      }
    },
    to: message => {
      return {
        __typename: 'User',
        id: message.toUserId
      }
    }
  }
}

async function createTestService (t, schema, resolvers) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers,
    subscription: true
  })
  await service.listen({ port: assignedPort++ })
  return [service, service.server.address().port]
}

async function createTestGatewayServer (t) {
  const [userService, userServicePort] = await createTestService(
    t,
    userSchema,
    userResolvers
  )
  const [messageService, messageServicePort] = await createTestService(
    t,
    messageSchema,
    messageResolvers
  )

  const gateway = Fastify()
  t.teardown(async () => {
    if (typeof gateway.close === 'function') {
      await gateway.close()
    }
    await userService.close()
    await messageService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`,
          wsUrl: `ws://localhost:${userServicePort}/graphql`
        },
        {
          name: 'message',
          url: `http://localhost:${messageServicePort}/graphql`,
          wsUrl: `ws://localhost:${messageServicePort}/graphql`
        }
      ]
    },
    subscription: true
  })

  return gateway
}

function createWebSocketClient (t, app) {
  const ws = new WebSocket(
    'ws://localhost:' + app.server.address().port + '/graphql',
    'graphql-ws'
  )
  const client = WebSocket.createWebSocketStream(ws, {
    encoding: 'utf8',
    objectMode: true
  })
  t.teardown(client.destroy.bind(client))
  client.setEncoding('utf8')
  return { client, ws }
}

test('gateway subscription - hooks basic', async t => {
  // t.plan(17)
  const gateway = await createTestGatewayServer(t)

  const subscriptionQuery = query('u1')

  gateway.graphql.addHook(
    'preSubscriptionParsing',
    async (schema, source, context) => {
      t.type(schema, GraphQLSchema)
      t.type(source, subscriptionQuery)
      t.type(context, 'object')
      t.ok('preSubscriptionParsing called')
    }
  )

  gateway.graphql.addHook(
    'preSubscriptionExecution',
    async (schema, document, context) => {
      t.type(schema, GraphQLSchema)
      t.same(document, parse(subscriptionQuery))
      t.type(context, 'object')
      t.ok('preSubscriptionExecution called')
    }
  )

  gateway.graphqlGateway.addHook(
    'preGatewaySubscriptionExecution',
    async (schema, document, context) => {
      t.type(schema, GraphQLSchema)
      t.type(document, 'object')
      t.type(context, 'object')
      t.ok('preGatewaySubscriptionExecution called')
    }
  )

  gateway.graphql.addHook(
    'onSubscriptionResolution',
    async (execution, context) => {
      t.same(execution, {
        data: {
          newMessage: {
            id: '1',
            text: 'Hi there u1',
            from: {
              id: 'u2',
              name: 'Jane'
            },
            to: {
              id: 'u1',
              name: 'John'
            }
          }
        }
      })
      t.type(context, 'object')
      t.ok('onSubscriptionResolution called')
    }
  )

  await gateway.listen({ port: assignedPort++ })

  const { client } = createWebSocketClient(t, gateway)

  client.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )
  client.write(
    JSON.stringify({
      id: 1,
      type: 'start',
      payload: {
        query: subscriptionQuery
      }
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')
  }

  gateway.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query: `
        mutation {
          sendMessage(message: {
            text: "Hi there u1",
            fromUserId: "u2",
            toUserId: "u1"
          }) {
            id
          }
        }
      `
    }
  })

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.same(data, {
      id: 1,
      type: 'data',
      payload: {
        data: {
          newMessage: {
            id: '1',
            text: 'Hi there u1',
            from: {
              id: 'u2',
              name: 'Jane'
            },
            to: {
              id: 'u1',
              name: 'John'
            }
          }
        }
      }
    })
  }
})

// ----------------------
// preSubscriptionParsing
// ----------------------
test('gateway - preSubscriptionParsing hooks should handle errors', async t => {
  t.plan(2)
  const gateway = await createTestGatewayServer(t)

  gateway.graphql.addHook('preSubscriptionParsing', async () => {
    throw new Error('a preSubscriptionParsing error occurred')
  })

  gateway.graphql.addHook('preSubscriptionParsing', async () => {
    t.fail('preSubscriptionParsing should not be called again')
  })

  gateway.graphql.addHook('preSubscriptionExecution', async () => {
    t.fail('preSubscriptionExecution should not be called')
  })

  gateway.graphqlGateway.addHook('preGatewaySubscriptionExecution', async () => {
    t.fail('preGatewaySubscriptionExecution should not be called')
  })

  gateway.graphql.addHook('onSubscriptionResolution', async () => {
    t.fail('onSubscriptionResolution should not be called')
  })

  await gateway.listen({ port: assignedPort++ })

  const { client } = createWebSocketClient(t, gateway)

  client.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')
  }

  client.write(
    JSON.stringify({
      id: 1,
      type: 'start',
      payload: {
        query: query('u1')
      }
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.same(data, {
      id: 1,
      type: 'error',
      payload: 'a preSubscriptionParsing error occurred'
    })
  }
})

// ------------------------
// preSubscriptionExecution
// ------------------------
test('gateway - preSubscriptionExecution hooks should handle errors', async t => {
  t.plan(2)
  const gateway = await createTestGatewayServer(t)

  gateway.graphql.addHook('preSubscriptionExecution', async () => {
    throw new Error('a preSubscriptionExecution error occurred')
  })

  gateway.graphql.addHook('preSubscriptionExecution', async () => {
    t.fail('preSubscriptionExecution should not be called again')
  })

  gateway.graphqlGateway.addHook('preGatewaySubscriptionExecution', async () => {
    t.fail('preGatewaySubscriptionExecution should not be called')
  })

  gateway.graphql.addHook('onSubscriptionResolution', async () => {
    t.fail('onSubscriptionResolution should not be called')
  })

  await gateway.listen({ port: assignedPort++ })

  const { client } = createWebSocketClient(t, gateway)

  client.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')
  }

  client.write(
    JSON.stringify({
      id: 1,
      type: 'start',
      payload: {
        query: query('u1')
      }
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.same(data, {
      id: 1,
      type: 'error',
      payload: 'a preSubscriptionExecution error occurred'
    })
  }
})

// -------------------------------
// preGatewaySubscriptionExecution
// -------------------------------
test('gateway - preGatewaySubscriptionExecution hooks should handle errors', async t => {
  t.plan(2)
  const gateway = await createTestGatewayServer(t)

  gateway.graphqlGateway.addHook('preGatewaySubscriptionExecution', async () => {
    throw new Error('a preGatewaySubscriptionExecution error occurred')
  })
  gateway.graphqlGateway.addHook('preGatewaySubscriptionExecution', async () => {
    t.fail('preGatewaySubscriptionExecution should not be called again')
  })

  gateway.graphql.addHook('onSubscriptionResolution', async () => {
    t.fail('onSubscriptionResolution should not be called')
  })

  await gateway.listen({ port: assignedPort++ })

  const { client } = createWebSocketClient(t, gateway)

  client.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')
  }

  client.write(
    JSON.stringify({
      id: 1,
      type: 'start',
      payload: {
        query: query('u1')
      }
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.same(data, {
      id: 1,
      type: 'error',
      payload: 'a preGatewaySubscriptionExecution error occurred'
    })
  }
})

test('gateway subscription - preGatewaySubscriptionExecution hooks should contain service metadata', async t => {
  t.plan(8)
  const gateway = await createTestGatewayServer(t)

  const subscriptionQuery = query('u1')

  gateway.graphqlGateway.addHook(
    'preGatewaySubscriptionExecution',
    async (schema, document, context, service) => {
      t.type(schema, GraphQLSchema)
      t.type(document, 'object')
      t.type(context, 'object')
      t.type(service, 'object')
      t.equal(service.name, 'message')
      t.ok('preGatewaySubscriptionExecution called')
    }
  )

  await gateway.listen({ port: assignedPort++ })

  const { client } = createWebSocketClient(t, gateway)

  client.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )
  client.write(
    JSON.stringify({
      id: 1,
      type: 'start',
      payload: {
        query: subscriptionQuery
      }
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')
  }

  gateway.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query: `
        mutation {
          sendMessage(message: {
            text: "Hi there u1",
            fromUserId: "u2",
            toUserId: "u1"
          }) {
            id
          }
        }
      `
    }
  })

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.same(data, {
      id: 1,
      type: 'data',
      payload: {
        data: {
          newMessage: {
            id: '2',
            text: 'Hi there u1',
            from: {
              id: 'u2',
              name: 'Jane'
            },
            to: {
              id: 'u1',
              name: 'John'
            }
          }
        }
      }
    })
  }
})

// -------------------------
// onSubscriptionResolution
// -------------------------
test('gateway - onSubscriptionResolution hooks should handle errors', async t => {
  t.plan(2)
  const gateway = await createTestGatewayServer(t)

  gateway.graphql.addHook('onSubscriptionResolution', async () => {
    throw new Error('a onSubscriptionResolution error occurred')
  })

  gateway.graphql.addHook('onSubscriptionResolution', async () => {
    t.fail('onSubscriptionResolution should not be called again')
  })

  await gateway.listen({ port: assignedPort++ })

  const { client, ws } = createWebSocketClient(t, gateway)

  client.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )
  client.write(
    JSON.stringify({
      id: 1,
      type: 'start',
      payload: {
        query: query('u1')
      }
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')
  }

  gateway.inject({
    method: 'POST',
    url: '/graphql',
    body: {
      query: `
        mutation {
          sendMessage(message: {
            text: "Hi there u1",
            fromUserId: "u2",
            toUserId: "u1"
          }) {
            id
          }
        }
      `
    }
  })

  await once(client, 'end')
  t.equal(ws.readyState, WebSocket.CLOSED)
})

// -----------------
// onSubscriptionEnd
// -----------------
test('gateway - should call onSubscriptionEnd when subscription ends', async t => {
  t.plan(4)
  const gateway = await createTestGatewayServer(t)

  gateway.graphql.addHook('onSubscriptionEnd', async context => {
    t.type(context, 'object')
    t.ok('onSubscriptionEnd called')
  })

  await gateway.listen({ port: assignedPort++ })

  const { client } = createWebSocketClient(t, gateway)

  client.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )
  client.write(
    JSON.stringify({
      id: 1,
      type: 'start',
      payload: {
        query: query('u1')
      }
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')
  }

  client.write(
    JSON.stringify({
      id: 1,
      type: 'stop',
      payload: {
        query
      }
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'complete')
  }
})

test('gateway - should handle onSubscriptionEnd hook errors', async t => {
  t.plan(2)
  const gateway = await createTestGatewayServer(t)

  gateway.graphql.addHook('onSubscriptionEnd', async () => {
    throw new Error('kaboom')
  })

  await gateway.listen({ port: assignedPort++ })

  const { client, ws } = createWebSocketClient(t, gateway)

  client.write(
    JSON.stringify({
      type: 'connection_init'
    })
  )
  client.write(
    JSON.stringify({
      id: 1,
      type: 'start',
      payload: {
        query: query('u1')
      }
    })
  )

  {
    const [chunk] = await once(client, 'data')
    const data = JSON.parse(chunk)
    t.equal(data.type, 'connection_ack')
  }

  client.write(
    JSON.stringify({
      id: 1,
      type: 'stop'
    })
  )

  await once(client, 'end')
  t.equal(ws.readyState, WebSocket.CLOSED)
})
