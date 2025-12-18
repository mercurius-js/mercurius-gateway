'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const { GraphQLSchema, parse } = require('graphql')
const { promisify } = require('util')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const { users, posts } = require('./utils/mocks')

const immediate = promisify(setImmediate)

async function createTestService (t, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers,
    allowBatchedQueries: true
  })
  await service.listen({ port: 0 })
  return [service, service.server.address().port]
}

const query = `
  query {
    me {
      id
      name
      topPosts(count: 2) {
        pid
        author {
          id
        }
      }
    }
    topPosts(count: 2) {
      pid
    }
  }
`

async function createTestGatewayServer (t, opts = {}) {
  // User service
  const userServiceSchema = `
  type Query @extends {
    me: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
  }`
  const userServiceResolvers = {
    Query: {
      me: () => {
        return users.u1
      }
    },
    User: {
      __resolveReference: user => {
        return users[user.id]
      }
    }
  }
  const [userService, userServicePort] = await createTestService(
    t,
    userServiceSchema,
    userServiceResolvers
  )

  // Post service
  const postServiceSchema = `
  type Post @key(fields: "pid") {
    pid: ID!
    author: User
  }

  extend type Query {
    topPosts(count: Int): [Post]
  }

  type User @key(fields: "id") @extends {
    id: ID! @external
    topPosts(count: Int!): [Post]
  }`
  const postServiceResolvers = {
    Post: {
      __resolveReference: post => {
        return posts[post.pid]
      },
      author: post => {
        return {
          __typename: 'User',
          id: post.authorId
        }
      }
    },
    User: {
      topPosts: (user, { count }) => {
        return Object.values(posts)
          .filter(p => p.authorId === user.id)
          .slice(0, count)
      }
    },
    Query: {
      topPosts: (root, { count = 2 }) => Object.values(posts).slice(0, count)
    }
  }
  const [postService, postServicePort] = await createTestService(
    t,
    postServiceSchema,
    postServiceResolvers
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await userService.close()
    await postService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`,
          allowBatchedQueries: true
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`,
          allowBatchedQueries: true
        }
      ]
    },
    ...opts
  })

  return gateway
}

// -----
// hooks
// -----
test('gateway - hooks', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('preParsing', async function (schema, source, context) {
    await immediate()
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.strictEqual(source, query)
    t.assert.strictEqual(typeof context, 'object')
    t.assert.ok('preParsing called')
  })

  app.graphql.addHook(
    'preValidation',
    async function (schema, document, context) {
      await immediate()
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.deepStrictEqual(document, parse(query))
      t.assert.strictEqual(typeof context, 'object')
      t.assert.ok('preValidation called')
    }
  )

  app.graphql.addHook(
    'preExecution',
    async function (schema, document, context) {
      await immediate()
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.deepStrictEqual(document, parse(query))
      t.assert.strictEqual(typeof context, 'object')
      t.assert.ok('preExecution called')
    }
  )

  // Execution events:
  //  - once for user service query
  //  - once for post service query
  //  - once for reference type topPosts on User
  //  - once for reference type author on Post
  app.graphqlGateway.addHook(
    'preGatewayExecution',
    async function (schema, document, context) {
      await immediate()
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.strictEqual(typeof document, 'object')
      t.assert.strictEqual(typeof context, 'object')
      t.assert.ok('preGatewayExecution called')
    }
  )

  app.graphql.addHook('onResolution', async function (execution, context) {
    await immediate()
    t.assert.strictEqual(typeof execution, 'object')
    t.assert.strictEqual(typeof context, 'object')
    t.assert.ok('onResolution called')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    }
  })
})

test('gateway - hooks validation should handle invalid hook names', async t => {
  const app = await createTestGatewayServer(t)

  try {
    app.graphql.addHook('unsupportedHook', async () => {})
  } catch (e) {
    t.assert.strictEqual(e.message, 'unsupportedHook hook not supported!')
  }
})

test('gateway - hooks validation should handle invalid hook name types', async t => {
  const app = await createTestGatewayServer(t)

  try {
    app.graphqlGateway.addHook(1, async () => {})
  } catch (e) {
    t.assert.strictEqual(e.code, 'MER_ERR_HOOK_INVALID_TYPE')
    t.assert.strictEqual(e.message, 'The hook name must be a string')
  }
})

test('gateway - hooks validation should handle invalid hook handlers', async t => {
  const app = await createTestGatewayServer(t)

  try {
    app.graphqlGateway.addHook('onGatewayReplaceSchema', 'not a function')
  } catch (e) {
    t.assert.strictEqual(e.code, 'MER_ERR_HOOK_INVALID_HANDLER')
    t.assert.strictEqual(e.message, 'The hook callback must be a function')
  }
})

test('gateway - hooks should trigger when JIT is enabled', async t => {
  const app = await createTestGatewayServer(t, { jit: 1 })

  app.graphql.addHook('preParsing', async function (schema, source, context) {
    await immediate()
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.strictEqual(source, query)
    t.assert.strictEqual(typeof context, 'object')
    t.assert.ok('preParsing called')
  })

  // preValidation is not triggered a second time
  app.graphql.addHook(
    'preValidation',
    async function (schema, document, context) {
      await immediate()
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.deepStrictEqual(document, parse(query))
      t.assert.strictEqual(typeof context, 'object')
      t.assert.ok('preValidation called')
    }
  )

  app.graphql.addHook(
    'preExecution',
    async function (schema, document, context) {
      await immediate()
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.deepStrictEqual(document, parse(query))
      t.assert.strictEqual(typeof context, 'object')
      t.assert.ok('preExecution called')
    }
  )

  // Execution events:
  //  - once for user service query
  //  - once for post service query
  //  - once for reference type topPosts on User
  //  - once for reference type author on Post
  app.graphqlGateway.addHook(
    'preGatewayExecution',
    async function (schema, document, context) {
      await immediate()
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.strictEqual(typeof document, 'object')
      t.assert.strictEqual(typeof context, 'object')
      t.assert.ok('preGatewayExecution called')
    }
  )

  app.graphql.addHook('onResolution', async function (execution, context) {
    await immediate()
    t.assert.strictEqual(typeof execution, 'object')
    t.assert.strictEqual(typeof context, 'object')
    t.assert.ok('onResolution called')
  })

  {
    const res = await app.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.assert.deepStrictEqual(JSON.parse(res.body), {
      data: {
        me: {
          id: 'u1',
          name: 'John',
          topPosts: [
            {
              pid: 'p1',
              author: {
                id: 'u1'
              }
            },
            {
              pid: 'p3',
              author: {
                id: 'u1'
              }
            }
          ]
        },
        topPosts: [
          {
            pid: 'p1'
          },
          {
            pid: 'p2'
          }
        ]
      }
    })
  }

  {
    const res = await app.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.assert.deepStrictEqual(JSON.parse(res.body), {
      data: {
        me: {
          id: 'u1',
          name: 'John',
          topPosts: [
            {
              pid: 'p1',
              author: {
                id: 'u1'
              }
            },
            {
              pid: 'p3',
              author: {
                id: 'u1'
              }
            }
          ]
        },
        topPosts: [
          {
            pid: 'p1'
          },
          {
            pid: 'p2'
          }
        ]
      }
    })
  }
})

// --------------------
// preParsing
// --------------------
test('gateway - preParsing hooks should handle errors', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('preParsing', async (schema, source, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.strictEqual(source, query)
    t.assert.strictEqual(typeof context, 'object')
    throw new Error('a preParsing error occured')
  })

  app.graphql.addHook('preParsing', async () => {
    t.assert.fail('this should not be called')
  })

  app.graphql.addHook('preValidation', async () => {
    t.assert.fail('this should not be called')
  })

  app.graphql.addHook('preExecution', async () => {
    t.assert.fail('this should not be called')
  })

  app.graphql.addHook('onResolution', async () => {
    t.assert.fail('this should not be called')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: null,
    errors: [
      {
        message: 'a preParsing error occured'
      }
    ]
  })
})

test('gateway - preParsing hooks should be able to put values onto the context', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('preParsing', async (schema, source, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.strictEqual(source, query)
    t.assert.strictEqual(typeof context, 'object')
    context.foo = 'bar'
  })

  app.graphql.addHook('preParsing', async (schema, source, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.strictEqual(source, query)
    t.assert.strictEqual(typeof context, 'object')
    t.assert.strictEqual(context.foo, 'bar')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    }
  })
})

// --------------
// preValidation
// --------------
test('gateway - preValidation hooks should handle errors', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('preValidation', async (schema, document, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.deepStrictEqual(document, parse(query))
    t.assert.strictEqual(typeof context, 'object')
    throw new Error('a preValidation error occured')
  })

  app.graphql.addHook('preValidation', async () => {
    t.assert.fail('this should not be called')
  })

  app.graphql.addHook('preExecution', async () => {
    t.assert.fail('this should not be called')
  })

  app.graphql.addHook('onResolution', async () => {
    t.assert.fail('this should not be called')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: null,
    errors: [
      {
        message: 'a preValidation error occured'
      }
    ]
  })
})

test('gateway - preValidation hooks should be able to put values onto the context', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('preValidation', async (schema, document, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.deepStrictEqual(document, parse(query))
    t.assert.strictEqual(typeof context, 'object')
    context.foo = 'bar'
  })

  app.graphql.addHook('preValidation', async (schema, document, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.deepStrictEqual(document, parse(query))
    t.assert.strictEqual(typeof context, 'object')
    t.assert.strictEqual(context.foo, 'bar')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    }
  })
})

// -------------
// preExecution
// -------------
test('gateway - preExecution hooks should handle errors', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('preExecution', async (schema, document, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.deepStrictEqual(document, parse(query))
    t.assert.strictEqual(typeof context, 'object')
    throw new Error('a preExecution error occured')
  })

  app.graphql.addHook('preExecution', async () => {
    t.assert.fail('this should not be called')
  })

  app.graphql.addHook('onResolution', async () => {
    t.assert.fail('this should not be called')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: null,
    errors: [
      {
        message: 'a preExecution error occured'
      }
    ]
  })
})

test('gateway - preExecution hooks should be able to put values onto the context', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('preExecution', async (schema, document, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.deepStrictEqual(document, parse(query))
    t.assert.strictEqual(typeof context, 'object')
    context.foo = 'bar'
  })

  app.graphql.addHook('preExecution', async (schema, document, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.deepStrictEqual(document, parse(query))
    t.assert.strictEqual(typeof context, 'object')
    t.assert.strictEqual(context.foo, 'bar')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    }
  })
})

test('gateway - preExecution hooks should be able to modify the request document', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('preExecution', async (schema, document, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.deepStrictEqual(document, parse(query))
    t.assert.strictEqual(typeof context, 'object')
    t.assert.ok('preExecution called')
    const documentClone = JSON.parse(JSON.stringify(document))
    documentClone.definitions[0].selectionSet.selections = [
      documentClone.definitions[0].selectionSet.selections[0]
    ]
    return {
      document: documentClone
    }
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      }
    }
  })
})

test('gateway - preExecution hooks should be able to add to the errors array', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('preExecution', async (schema, document, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.deepStrictEqual(document, parse(query))
    t.assert.strictEqual(typeof context, 'object')
    t.assert.ok('preExecution called for foo error')
    return {
      errors: [new Error('foo')]
    }
  })

  app.graphql.addHook('preExecution', async (schema, document, context) => {
    t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
    t.assert.deepStrictEqual(document, parse(query))
    t.assert.strictEqual(typeof context, 'object')
    t.assert.ok('preExecution called for foo error')
    return {
      errors: [new Error('bar')]
    }
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    },
    errors: [
      {
        message: 'foo'
      },
      {
        message: 'bar'
      }
    ]
  })
})

// -------------------
// preGatewayExecution
// -------------------
test('gateway - preGatewayExecution hooks should handle errors', async t => {
  const app = await createTestGatewayServer(t)

  app.graphqlGateway.addHook(
    'preGatewayExecution',
    async (schema, document, context) => {
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.strictEqual(typeof document, 'object')
      t.assert.strictEqual(typeof context, 'object')
      throw new Error('a preGatewayExecution error occured')
    }
  )

  app.graphqlGateway.addHook('preGatewayExecution', async () => {
    t.assert.fail('this should not be called')
  })

  // This should still be called in the gateway
  app.graphql.addHook('onResolution', async (execution, context) => {
    t.assert.strictEqual(typeof execution, 'object')
    t.assert.strictEqual(typeof context, 'object')
    t.assert.ok('onResolution called')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: null,
      topPosts: null
    },
    errors: [
      {
        message: 'a preGatewayExecution error occured',
        locations: [{ line: 3, column: 5 }],
        path: ['me']
      },
      {
        message: 'a preGatewayExecution error occured',
        locations: [{ line: 13, column: 5 }],
        path: ['topPosts']
      }
    ]
  })
})

test('gateway - preGatewayExecution hooks should be able to put values onto the context', async t => {
  const app = await createTestGatewayServer(t)

  app.graphqlGateway.addHook(
    'preGatewayExecution',
    async (schema, document, context) => {
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.strictEqual(typeof document, 'object')
      t.assert.strictEqual(typeof context, 'object')
      context[document.definitions[0].name.value] = 'bar'
    }
  )

  app.graphqlGateway.addHook(
    'preGatewayExecution',
    async (schema, document, context) => {
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.strictEqual(typeof document, 'object')
      t.assert.strictEqual(typeof context, 'object')
      t.assert.strictEqual(context[document.definitions[0].name.value], 'bar')
    }
  )

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    }
  })
})

test('gateway - preGatewayExecution hooks should be able to add to the errors array', async t => {
  const app = await createTestGatewayServer(t)

  app.graphqlGateway.addHook(
    'preGatewayExecution',
    async (schema, document, context) => {
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.strictEqual(typeof document, 'object')
      t.assert.strictEqual(typeof context, 'object')
      t.assert.ok('preGatewayExecution called for foo error')
      return {
        errors: [new Error(`foo - ${document.definitions[0].name.value}`)]
      }
    }
  )

  app.graphqlGateway.addHook(
    'preGatewayExecution',
    async (schema, document, context) => {
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.strictEqual(typeof document, 'object')
      t.assert.strictEqual(typeof context, 'object')
      t.assert.ok('preGatewayExecution called for foo error')
      return {
        errors: [new Error(`bar - ${document.definitions[0].name.value}`)]
      }
    }
  )

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    },
    errors: [
      {
        message: 'foo - Query_me'
      },
      {
        message: 'bar - Query_me'
      },
      {
        message: 'foo - Query_topPosts'
      },
      {
        message: 'bar - Query_topPosts'
      },
      {
        message: 'foo - EntitiesQuery'
      },
      {
        message: 'bar - EntitiesQuery'
      },
      {
        message: 'foo - EntitiesQuery'
      },
      {
        message: 'bar - EntitiesQuery'
      }
    ]
  })
})

test('gateway - preGatewayExecution hooks should be able to modify the request document', async t => {
  const app = await createTestGatewayServer(t)

  app.graphqlGateway.addHook(
    'preGatewayExecution',
    async (schema, document, context) => {
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.strictEqual(typeof document, 'object')
      t.assert.strictEqual(typeof context, 'object')
      t.assert.ok('preGatewayExecution called')
      if (document.definitions[0].name.value === 'EntitiesQuery') {
        if (
          document.definitions[0].selectionSet.selections[0].selectionSet
            .selections[1].selectionSet.selections[0].arguments[0]
        ) {
          const documentClone = JSON.parse(JSON.stringify(document))
          documentClone.definitions[0].selectionSet.selections[0].selectionSet.selections[1].selectionSet.selections[0].arguments[0].value.value = 1
          return {
            document: documentClone
          }
        }
      }
    }
  )

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    }
  })
})

test('gateway - preGatewayExecution hooks should contain service metadata', async t => {
  const app = await createTestGatewayServer(t)

  // Execution events:
  //  - user service: once for user service query
  //  - post service: once for post service query
  //  - post service: once for reference type topPosts on User
  //  - user service: once for reference type author on Post
  app.graphqlGateway.addHook(
    'preGatewayExecution',
    async function (schema, document, context, service) {
      await immediate()
      t.assert.strictEqual(schema.constructor.name, GraphQLSchema.name)
      t.assert.strictEqual(typeof document, 'object')
      t.assert.strictEqual(typeof context, 'object')
      if (typeof service === 'object' && service.name === 'user') {
        t.assert.strictEqual(service.name, 'user')
      } else if (typeof service === 'object' && service.name === 'post') {
        t.assert.strictEqual(service.name, 'post')
      } else {
        t.assert.fail('service metadata should be correctly populated')
        return
      }
      t.assert.ok('preGatewayExecution called')
    }
  )

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    }
  })
})

// -------------
// onResolution
// -------------
test('gateway - onResolution hooks should handle errors', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('onResolution', async (execution, context) => {
    t.assert.strictEqual(typeof execution, 'object')
    t.assert.strictEqual(typeof context, 'object')
    throw new Error('a onResolution error occured')
  })

  app.graphql.addHook('onResolution', async () => {
    t.assert.fail('this should not be called')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: null,
    errors: [
      {
        message: 'a onResolution error occured'
      }
    ]
  })
})

test('gateway - onResolution hooks should be able to put values onto the context', async t => {
  const app = await createTestGatewayServer(t)

  app.graphql.addHook('onResolution', async (execution, context) => {
    t.assert.strictEqual(typeof execution, 'object')
    t.assert.strictEqual(typeof context, 'object')
    context.foo = 'bar'
  })

  app.graphql.addHook('onResolution', async (execution, context) => {
    t.assert.strictEqual(typeof execution, 'object')
    t.assert.strictEqual(typeof context, 'object')
    t.assert.strictEqual(context.foo, 'bar')
  })

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        topPosts: [
          {
            pid: 'p1',
            author: {
              id: 'u1'
            }
          },
          {
            pid: 'p3',
            author: {
              id: 'u1'
            }
          }
        ]
      },
      topPosts: [
        {
          pid: 'p1'
        },
        {
          pid: 'p2'
        }
      ]
    }
  })
})
