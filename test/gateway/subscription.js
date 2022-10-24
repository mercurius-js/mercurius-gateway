'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const WebSocket = require('ws')
const GQL = require('mercurius')
const { createGateway } = require('../../index')

const users = {
  u1: {
    id: 'u1',
    name: 'John'
  },
  u2: {
    id: 'u2',
    name: 'Jane'
  }
}

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
    async sendMessage(root, { message }, { pubsub }) {
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

test('gateway subscription handling works correctly', t => {
  t.plan(1)
  let userService
  let messageService
  let gateway
  let client

  async function createUserService() {
    userService = Fastify()
    await userService.register(GQL, {
      schema: userSchema,
      resolvers: userResolvers,
      federationMetadata: true,
      subscription: true
    })
    await userService.listen({ port: 3600 })
  }

  async function createMessageService() {
    messageService = Fastify()
    await messageService.register(GQL, {
      schema: messageSchema,
      resolvers: messageResolvers,
      federationMetadata: true,
      subscription: true
    })
    await messageService.listen({ port: 3601 })
  }

  async function createGatewayApp() {
    const userServicePort = userService.server.address().port
    const messageServicePort = messageService.server.address().port

    gateway = Fastify()

    const { schema } = await createGateway(
      {
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
      gateway
    )

    await gateway.register(GQL, {
      subscription: true,
      jit: 1,
      schema
    })

    await gateway.listen({ port: 3501 })
  }

  function runSubscription() {
    return new Promise(resolve => {
      const ws = new WebSocket(
        `ws://localhost:${gateway.server.address().port}/graphql`,
        'graphql-ws'
      )
      client = WebSocket.createWebSocketStream(ws, {
        encoding: 'utf8',
        objectMode: true
      })

      client.setEncoding('utf8')

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
            query: `
          subscription {
            newMessage(toUser: "u1") {
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
        })
      )

      client.write(
        JSON.stringify({
          id: 2,
          type: 'start',
          payload: {
            query: `
          subscription {
            newMessage(toUser: "u2") {
              id
            }
          }
        `
          }
        })
      )

      client.write(
        JSON.stringify({
          id: 2,
          type: 'stop'
        })
      )

      client.on('data', async chunk => {
        const data = JSON.parse(chunk)

        if (data.id === 1 && data.type === 'data') {
          t.equal(
            chunk,
            JSON.stringify({
              type: 'data',
              id: 1,
              payload: {
                data: {
                  newMessage: {
                    id: '1',
                    text: 'Hi there',
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
          )

          await client.end()
          resolve()
        } else if (data.id === 2 && data.type === 'complete') {
          gateway.inject({
            method: 'POST',
            url: '/graphql',
            body: {
              query: `
              mutation {
                sendMessage(message: {
                  text: "Hi there",
                  fromUserId: "u2",
                  toUserId: "u1"
                }) {
                  id
                }
              }
            `
            }
          })
        }
      })
    })
  }

  t.teardown(async () => {
    await client.destroy()
    await gateway.close()
    await messageService.close()
    await userService.close()
  })

  Promise.all([createUserService(), createMessageService()])
    .then(() => createGatewayApp())
    .then(() => runSubscription())
    .then(() => {
      t.end()
    })
})

test('gateway wsConnectionParams object is passed to SubscriptionClient', t => {
  t.plan(1)
  function onConnect(data) {
    t.same(data.payload, connectionInitPayload)
    t.end()
  }

  const connectionInitPayload = {
    hello: 'world'
  }

  let testService
  let gateway

  t.teardown(async () => {
    await gateway.close()
    await testService.close()
  })

  async function createTestService() {
    testService = Fastify()
    testService.register(GQL, {
      schema: `
      type Query {
        test: String
      }
    `,
      federationMetadata: true,
      subscription: { onConnect }
    })

    return testService.listen({ port: 3500 })
  }

  async function createGatewayApp() {
    const testServicePort = testService.server.address().port
    gateway = Fastify()
    const { schema } = await createGateway(
      {
        services: [
          {
            name: 'test',
            url: `http://localhost:${testServicePort}/graphql`,
            wsUrl: `ws://localhost:${testServicePort}/graphql`,
            wsConnectionParams: {
              connectionInitPayload
            }
          }
        ]
      },
      gateway
    )

    await gateway.register(GQL, {
      subscription: true,
      schema
    })
    await gateway.ready()
  }

  createTestService().then(() => createGatewayApp())
})

test('gateway wsConnectionParams function is passed to SubscriptionClient', t => {
  function onConnect(data) {
    t.same(data.payload, connectionInitPayload)
    t.end()
  }

  const connectionInitPayload = {
    hello: 'world'
  }
  const testService = Fastify()

  testService.register(GQL, {
    schema: `
      type Query {
        test: String
      }
    `,
    federationMetadata: true,
    subscription: { onConnect }
  })

  testService.listen({ port: 3510 }, async err => {
    t.error(err)
    const testServicePort = testService.server.address().port

    const gateway = Fastify()
    t.teardown(async () => {
      await gateway.close()
      await testService.close()
    })

    const { schema } = await createGateway(
      {
        services: [
          {
            name: 'test',
            url: `http://localhost:${testServicePort}/graphql`,
            wsUrl: `ws://localhost:${testServicePort}/graphql`,
            wsConnectionParams: async function () {
              return {
                connectionInitPayload
              }
            }
          }
        ]
      },
      gateway
    )

    gateway.register(GQL, {
      subscription: true,
      schema
    })
    await gateway.ready()
  })
})

test('gateway forwards the connection_init payload to the federated service on gql_start using the connectionInit extension', t => {
  t.plan(3)
  function onConnect(data) {
    if (data && data.payload && Object.entries(data.payload).length) {
      t.same(data.payload, connectionInitPayload)
    }

    return true
  }

  const connectionInitPayload = {
    hello: 'world'
  }
  const testService = Fastify()

  testService.register(GQL, {
    schema: `
      type Notification {
        id: ID!
        message: String
      }

      type Query {
        notifications: [Notification]
      }

      type Subscription {
        notificationAdded: Notification
      }
    `,
    resolvers: {
      Query: {
        notifications: () => []
      },
      Subscription: {
        notificationAdded: {
          subscribe: () => {
            t.end()
          }
        }
      }
    },
    federationMetadata: true,
    subscription: { onConnect }
  })

  testService.listen({ port: 3520 }, async err => {
    t.error(err)

    const testServicePort = testService.server.address().port

    const gateway = Fastify()
    t.teardown(async () => {
      await gateway.close()
      await testService.close()
    })

    const { schema } = await createGateway(
      {
        services: [
          {
            name: 'test',
            url: `http://localhost:${testServicePort}/graphql`,
            wsUrl: `ws://localhost:${testServicePort}/graphql`
          }
        ]
      },
      gateway
    )

    gateway.register(GQL, {
      subscription: true,
      schema
    })

    gateway.listen({ port: 3540 }, async err => {
      t.error(err)
      const ws = new WebSocket(
        `ws://localhost:${gateway.server.address().port}/graphql`,
        'graphql-ws'
      )
      const client = WebSocket.createWebSocketStream(ws, {
        encoding: 'utf8',
        objectMode: true
      })
      t.teardown(client.destroy.bind(client))
      client.setEncoding('utf8')

      client.write(
        JSON.stringify({
          type: 'connection_init',
          payload: connectionInitPayload
        })
      )

      client.on('data', chunk => {
        const data = JSON.parse(chunk)
        if (data.type === 'connection_ack') {
          client.write(
            JSON.stringify({
              id: 1,
              type: 'start',
              payload: {
                query: `
                subscription {
                  notificationAdded {
                    id
                    message
                  }
                }
              `
              }
            })
          )
          client.destroy()
        }
      })
    })
  })
})

test('connection_init payload is overwritten at gateway and forwarded to the federated service', t => {
  t.plan(6)
  const initialPayload = { token: 'some-token' }
  const rewritePayload = { user: { id: '1' } }

  function onConnectGateway(data) {
    if (data && data.payload && Object.entries(data.payload).length) {
      t.same(data.payload, initialPayload)
    }

    return rewritePayload
  }

  function rewriteConnectionInitPayload(payload, context) {
    t.same(payload, initialPayload)
    t.has(context, rewritePayload)
    return { user: context.user }
  }

  function onConnectService(data) {
    if (data && data.payload && Object.entries(data.payload).length) {
      t.same(data.payload, rewritePayload)
    }

    return true
  }

  const testService = Fastify()

  testService.register(GQL, {
    schema: `
      type Notification {
        id: ID!
        message: String
      }

      type Query {
        notifications: [Notification]
      }

      type Subscription {
        notificationAdded: Notification
      }
    `,
    resolvers: {
      Query: {
        notifications: () => []
      },
      Subscription: {
        notificationAdded: {
          subscribe: () => {
            t.end()
          }
        }
      }
    },
    federationMetadata: true,
    subscription: { onConnect: onConnectService }
  })

  testService.listen({ port: 3602 }, async err => {
    t.error(err)

    const testServicePort = testService.server.address().port

    const gateway = Fastify()
    t.teardown(async () => {
      await gateway.close()
      await testService.close()
    })

    const { schema } = await createGateway(
      {
        services: [
          {
            name: 'test',
            url: `http://localhost:${testServicePort}/graphql`,
            wsUrl: `ws://localhost:${testServicePort}/graphql`,
            wsConnectionParams: {
              rewriteConnectionInitPayload
            }
          }
        ]
      },
      gateway
    )

    gateway.register(GQL, {
      subscription: {
        onConnect: onConnectGateway
      },
      schema
    })

    gateway.listen({ port: 3603 }, async err => {
      t.error(err)
      const ws = new WebSocket(
        `ws://localhost:${gateway.server.address().port}/graphql`,
        'graphql-ws'
      )
      const client = WebSocket.createWebSocketStream(ws, {
        encoding: 'utf8',
        objectMode: true
      })
      t.teardown(client.destroy.bind(client))
      client.setEncoding('utf8')

      client.write(
        JSON.stringify({
          type: 'connection_init',
          payload: initialPayload
        })
      )

      client.on('data', chunk => {
        const data = JSON.parse(chunk)
        if (data.type === 'connection_ack') {
          client.write(
            JSON.stringify({
              id: 1,
              type: 'start',
              payload: {
                query: `
                subscription {
                  notificationAdded {
                    id
                    message
                  }
                }
              `
              }
            })
          )
          client.destroy()
        }
      })
    })
  })
})

test('subscriptions work with scalars', async t => {
  let testService
  let gateway

  const schema = `
  extend type Query {
      ignored: Boolean!
  }

  extend type Mutation {
      addTestEvent(value: Int!): Int!
  }

  extend type Subscription {
      testEvent: Int!
  }`

  const resolvers = {
    Query: {
      ignored: () => true
    },
    Mutation: {
      addTestEvent: async (_, { value }, { pubsub }) => {
        await pubsub.publish({
          topic: 'testEvent',
          payload: { testEvent: value }
        })

        return value
      }
    },
    Subscription: {
      testEvent: {
        subscribe: async (_, __, { pubsub }) => {
          return await pubsub.subscribe('testEvent')
        }
      }
    }
  }

  function createTestService() {
    testService = Fastify()
    testService.register(GQL, {
      schema,
      resolvers,
      federationMetadata: true,
      subscription: true
    })

    return testService.listen({ port: 3604 })
  }

  async function createGatewayApp() {
    const testServicePort = testService.server.address().port

    gateway = Fastify()

    const { schema } = await createGateway(
      {
        services: [
          {
            name: 'testService',
            url: `http://localhost:${testServicePort}/graphql`,
            wsUrl: `ws://localhost:${testServicePort}/graphql`
          }
        ]
      },
      gateway
    )

    gateway.register(GQL, {
      subscription: true,
      schema
    })

    return gateway.listen({ port: 3605 })
  }

  function runSubscription() {
    const ws = new WebSocket(
      `ws://localhost:${gateway.server.address().port}/graphql`,
      'graphql-ws'
    )
    const client = WebSocket.createWebSocketStream(ws, {
      encoding: 'utf8',
      objectMode: true
    })
    t.teardown(async () => {
      client.destroy()
      await gateway.close()
      await testService.close()
    })
    client.setEncoding('utf8')

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
          query: `
          subscription {
            testEvent
          }
        `
        }
      })
    )

    client.write(
      JSON.stringify({
        id: 2,
        type: 'start',
        payload: {
          query: `
          subscription {
            testEvent
          }
        `
        }
      })
    )

    client.write(
      JSON.stringify({
        id: 2,
        type: 'stop'
      })
    )

    let end

    const endPromise = new Promise(resolve => {
      end = resolve
    })

    client.on('data', chunk => {
      const data = JSON.parse(chunk)

      if (data.id === 1 && data.type === 'data') {
        t.equal(
          chunk,
          JSON.stringify({
            type: 'data',
            id: 1,
            payload: {
              data: {
                testEvent: 1
              }
            }
          })
        )

        client.end()
        end()
      } else if (data.id === 2 && data.type === 'complete') {
        gateway.inject({
          method: 'POST',
          url: '/graphql',
          body: {
            query: `
              mutation {
                addTestEvent(value: 1)
              }
            `
          }
        })
      }
    })

    return endPromise
  }

  await createTestService()
  await createGatewayApp()
  await runSubscription()
})

test('subscriptions work with different contexts', async t => {
  let testService
  let gateway

  const schema = `
  extend type Query {
      ignored: Boolean!
  }

  extend type Mutation {
      addTestEvent(value: Int!): Int!
  }

  type Event @key(fields: "value") {
    value: Int! @external
  }

  extend type Subscription {
      testEvent(value: Int!): Int!
  }`

  const resolvers = {
    Query: {
      ignored: () => true
    },
    Mutation: {
      addTestEvent: async (_, { value }, { pubsub }) => {
        await pubsub.publish({
          topic: 'testEvent',
          payload: { testEvent: value }
        })

        return value
      }
    },
    Subscription: {
      testEvent: {
        subscribe: GQL.withFilter(
          async (_, __, { pubsub }) => {
            return await pubsub.subscribe('testEvent')
          },
          ({ testEvent }, { value }) => {
            return testEvent === value
          }
        )
      }
    }
  }

  function createTestService() {
    testService = Fastify()
    testService.register(GQL, {
      schema,
      resolvers,
      federationMetadata: true,
      subscription: true
    })

    return testService.listen({ port: 3606 })
  }

  async function createGatewayApp() {
    const testServicePort = testService.server.address().port

    gateway = Fastify()

    const { schema } = await createGateway(
      {
        services: [
          {
            name: 'testService',
            url: `http://localhost:${testServicePort}/graphql`,
            wsUrl: `ws://localhost:${testServicePort}/graphql`
          }
        ]
      },
      gateway
    )

    gateway.register(GQL, {
      subscription: true,
      schema
    })

    return gateway.listen({ port: 3607 })
  }

  function runSubscription(id) {
    const ws = new WebSocket(
      `ws://localhost:${gateway.server.address().port}/graphql`,
      'graphql-ws'
    )
    const client = WebSocket.createWebSocketStream(ws, {
      encoding: 'utf8',
      objectMode: true
    })
    t.teardown(async () => {
      client.destroy()
    })
    client.setEncoding('utf8')

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
          query: `
          subscription TestEvent($value: Int!) {
            testEvent(value: $value)
          }
        `,
          variables: { value: id }
        }
      })
    )

    client.write(
      JSON.stringify({
        id: 2,
        type: 'start',
        payload: {
          query: `
          subscription TestEvent($value: Int!) {
            testEvent(value: $value)
          }
        `,
          variables: { value: id }
        }
      })
    )

    client.write(
      JSON.stringify({
        id: 2,
        type: 'stop'
      })
    )

    let end

    const endPromise = new Promise(resolve => {
      end = resolve
    })

    client.on('data', chunk => {
      const data = JSON.parse(chunk)

      if (data.id === 1 && data.type === 'data') {
        t.equal(
          chunk,
          JSON.stringify({
            type: 'data',
            id: 1,
            payload: {
              data: {
                testEvent: id
              }
            }
          })
        )

        client.end()
        end()
      } else if (data.id === 2 && data.type === 'complete') {
        gateway.inject({
          method: 'POST',
          url: '/graphql',
          body: {
            query: `
              mutation AddTestEvent($value: Int!) {
                addTestEvent(value: $value)
              }
            `,
            variables: { value: id }
          }
        })
      }
    })

    return endPromise
  }

  await createTestService()
  await createGatewayApp()
  const subscriptions = new Array(10)
    .fill(null)
    .map((_, i) => runSubscription(i))
  await Promise.all(subscriptions)

  t.teardown(async () => {
    await gateway.close()
    await testService.close()
  })
})

test('connection_init headers available in federation event resolver', async t => {
  let subscriptionService
  let resolverService
  let gateway

  const onConnect = data => {
    if (data.payload.gateway) {
      return { headers: {} }
    } else {
      return {
        headers: data.payload.headers
      }
    }
  }

  const wsConnectionParams = {
    connectionInitPayload() {
      return {
        gateway: true
      }
    }
  }

  function createResolverService() {
    const schema = `
      extend type Query {
        ignoredResolver: Boolean!
      }

      extend type Event @key(fields: "value") {
        id: ID! @external
        userId: Int!
      }
    `

    const resolvers = {
      Query: {
        ignoredResolver: () => true
      },
      Event: {
        userId: root => {
          return parseInt(root.id)
        }
      }
    }

    resolverService = Fastify()
    resolverService.register(GQL, {
      schema,
      resolvers,
      federationMetadata: true,
      subscription: { onConnect }
    })

    return resolverService.listen({ port: 3608 })
  }

  function createSubscriptionService() {
    const schema = `
      extend type Query {
        ignored: Boolean!
      }

      type Event @key(fields: "id") {
        id: ID!
      }

      extend type Mutation {
        addTestEvent(value: Int!): Int!
      }

      extend type Subscription {
        testEvent(value: Int!): Event!
      }
      `

    const resolvers = {
      Query: {
        ignored: () => true
      },
      Mutation: {
        addTestEvent: async (_, { value }, { pubsub }) => {
          await pubsub.publish({
            topic: 'testEvent',
            payload: { testEvent: { id: value } }
          })

          return value
        }
      },
      Subscription: {
        testEvent: {
          subscribe: GQL.withFilter(
            async (_, __, { pubsub }) => {
              return await pubsub.subscribe('testEvent')
            },
            (root, args, { headers }) => {
              return headers.userId === root.testEvent.id
            }
          )
        }
      }
    }

    subscriptionService = Fastify()
    subscriptionService.register(GQL, {
      schema,
      resolvers,
      federationMetadata: true,
      subscription: { onConnect }
    })

    return subscriptionService.listen({ port: 3609 })
  }

  async function createGatewayApp() {
    const subscriptionServicePort = subscriptionService.server.address().port
    const resolverServicePort = resolverService.server.address().port

    gateway = Fastify()

    const { schema } = await createGateway(
      {
        services: [
          {
            name: 'subscriptionService',
            url: `http://localhost:${subscriptionServicePort}/graphql`,
            wsUrl: `ws://localhost:${subscriptionServicePort}/graphql`,
            wsConnectionParams
          },
          {
            name: 'resolverService',
            url: `http://localhost:${resolverServicePort}/graphql`,
            wsUrl: `ws://localhost:${resolverServicePort}/graphql`,
            wsConnectionParams
          }
        ]
      },
      gateway
    )
    gateway.register(GQL, {
      subscription: true,
      schema
    })

    return gateway.listen({ port: 3610 })
  }

  function runSubscription(id) {
    const ws = new WebSocket(
      `ws://localhost:${gateway.server.address().port}/graphql`,
      'graphql-ws'
    )
    const client = WebSocket.createWebSocketStream(ws, {
      encoding: 'utf8',
      objectMode: true
    })
    t.teardown(async () => {
      client.destroy()
    })
    client.setEncoding('utf8')

    client.write(
      JSON.stringify({
        type: 'connection_init',
        payload: { headers: { userId: id } }
      })
    )

    client.write(
      JSON.stringify({
        id: 1,
        type: 'start',
        payload: {
          query: `
          subscription TestEvent($value: Int!) {
            testEvent(value: $value) {
              id
              userId
            }
          }
        `,
          variables: { value: id }
        }
      })
    )

    client.write(
      JSON.stringify({
        id: 2,
        type: 'start',
        payload: {
          query: `
          subscription TestEvent($value: Int!) {
            testEvent(value: $value) {
              id
              userId
            }
          }
        `,
          variables: { value: id }
        }
      })
    )

    client.write(
      JSON.stringify({
        id: 2,
        type: 'stop'
      })
    )

    let end

    const endPromise = new Promise(resolve => {
      end = resolve
    })

    client.on('data', chunk => {
      const data = JSON.parse(chunk)

      if (data.id === 1 && data.type === 'data') {
        t.equal(
          chunk,
          JSON.stringify({
            type: 'data',
            id: 1,
            payload: {
              data: {
                testEvent: {
                  id: String(id),
                  userId: id
                }
              }
            }
          })
        )

        client.end()
        end()
      } else if (data.id === 2 && data.type === 'complete') {
        gateway.inject({
          method: 'POST',
          url: '/graphql',
          body: {
            query: `
              mutation AddTestEvent($value: Int!) {
                addTestEvent(value: $value)
              }
            `,
            variables: { value: id }
          }
        })
      }
    })

    return endPromise
  }

  await createSubscriptionService()
  await createResolverService()
  await createGatewayApp()
  const subscriptions = new Array(10)
    .fill(null)
    .map((_, i) => runSubscription(i))
  await Promise.all(subscriptions)

  t.teardown(async () => {
    await gateway.close()
    await subscriptionService.close()
    await resolverService.close()
  })
})