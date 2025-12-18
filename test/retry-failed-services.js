'use strict'

const { describe, test, beforeEach, afterEach } = require('node:test')
const Fastify = require('fastify')
const { GraphQLSchema } = require('graphql')
const GQL = require('mercurius')
const FakeTimers = require('@sinonjs/fake-timers')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const { users, posts } = require('./utils/mocks')

async function createTestService (port, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port })
  return service
}

const userService = {
  schema: `
  extend type Query {
    me: User
  }
  
  type User @key(fields: "id") {
    id: ID!
    name: String!
  }
  `,
  resolvers: {
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
}

const postService = {
  schema: `
  type Post @key(fields: "pid") {
    pid: ID!
    title: String
    content: String
    author: User @requires(fields: "pid title")
  }

  type User @key(fields: "id") @extends {
    id: ID! @external
    name: String @external
    posts(count: Int): [Post]
  }
`,
  resolvers: {
    Post: {
      author: post => {
        return {
          __typename: 'User',
          id: post.authorId
        }
      }
    },
    User: {
      posts: (user, { count }) => {
        return Object.values(posts)
          .filter(p => p.authorId === user.id)
          .slice(0, count)
      }
    }
  }
}

describe('retry-failed-services', () => {
  let clock

  beforeEach(() => {
    clock = FakeTimers.install({
      shouldClearNativeTimers: true,
      shouldAdvanceTime: true,
      advanceTimeDelta: 100
    })
  })

  afterEach(() => {
    clock.uninstall()
  })

  test('gateway - retry mandatory failed services on startup', async t => {
    const service1 = await createTestService(
      0,
      userService.schema,
      userService.resolvers
    )

    let service2 = null
    clock.setTimeout(async () => {
      service2 = await createTestService(
        5113,
        postService.schema,
        postService.resolvers
      )
    }, 5000)

    const gateway = Fastify()
    t.after(async () => {
      await gateway.close()
      await service1.close()
      await service2.close()
    })

    await gateway.register(plugin, {
      gateway: {
        services: [
          {
            name: 'user',
            url: `http://localhost:${service1.server.address().port}/graphql`,
            mandatory: false
          },
          {
            name: 'post',
            url: 'http://localhost:5113/graphql',
            mandatory: true
          }
        ]
      },
      jit: 1
    })

    gateway.graphqlGateway.addHook(
      'onGatewayReplaceSchema',
      async (instance, schema) => {
        t.assert.strictEqual(typeof instance, 'object')
        t.assert.ok(schema instanceof GraphQLSchema)
        t.assert.ok('should be called')
      }
    )

    await gateway.ready()

    const query = `
    query {
      user: me {
        id
        name
        posts(count: 1) {
          pid
        }
      }
    }`

    const res = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.assert.deepStrictEqual(await res.json(), {
      errors: [
        {
          message: 'Cannot query field "posts" on type "User".',
          locations: [{ line: 6, column: 9 }]
        }
      ],
      data: null
    })

    for (let i = 0; i < 100; i++) {
      await clock.tickAsync(100)
    }

    const res1 = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.assert.deepStrictEqual(JSON.parse(res1.body), {
      data: {
        user: {
          id: 'u1',
          name: 'John',
          posts: [
            {
              pid: 'p1'
            }
          ]
        }
      }
    })
  })

  test('gateway - should not call onGatewayReplaceSchemaHandler if the hook is not specified', async t => {
    const service1 = await createTestService(
      0,
      userService.schema,
      userService.resolvers
    )

    let service2 = null
    clock.setTimeout(async () => {
      service2 = await createTestService(
        5111,
        postService.schema,
        postService.resolvers
      )
    }, 2000)

    const gateway = Fastify()
    t.after(async () => {
      await gateway.close()
      await service1.close()
      await service2.close()
    })

    await gateway.register(plugin, {
      gateway: {
        services: [
          {
            name: 'user',
            url: `http://localhost:${service1.server.address().port}/graphql`,
            mandatory: false
          },
          {
            name: 'post',
            url: 'http://localhost:5111/graphql',
            mandatory: true
          }
        ],
        retryServicesCount: 10,
        retryServicesInterval: 2000
      },
      jit: 1
    })

    await gateway.ready()

    const query = `
    query {
      user: me {
        id
        name
        posts(count: 1) {
          pid
        }
      }
    }`

    const res = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.assert.deepStrictEqual(await res.json(), {
      errors: [
        {
          message: 'Cannot query field "posts" on type "User".',
          locations: [{ line: 6, column: 9 }]
        }
      ],
      data: null
    })

    for (let i = 0; i < 100; i++) {
      await clock.tickAsync(100)
    }

    const res1 = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.assert.deepStrictEqual(JSON.parse(res1.body), {
      data: {
        user: {
          id: 'u1',
          name: 'John',
          posts: [
            {
              pid: 'p1'
            }
          ]
        }
      }
    })
  })

  test('gateway - dont retry non-mandatory failed services on startup', async t => {
    const service1 = await createTestService(
      0,
      userService.schema,
      userService.resolvers
    )

    const gateway = Fastify()
    t.after(async () => {
      await gateway.close()
      await service1.close()
    })

    await gateway.register(plugin, {
      gateway: {
        services: [
          {
            name: 'user',
            url: `http://localhost:${service1.server.address().port}/graphql`,
            mandatory: false
          },
          {
            name: 'post',
            url: 'http://localhost:5112/graphql',
            mandatory: false
          }
        ],
        pollingInterval: 2000
      },
      jit: 1
    })

    await gateway.ready()

    const query = `
    query {
      user: me {
        id
        name
        posts(count: 1) {
          pid
        }
      }
    }`

    const res = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.assert.deepStrictEqual(await res.json(), {
      errors: [
        {
          message: 'Cannot query field "posts" on type "User".',
          locations: [{ line: 6, column: 9 }]
        }
      ],
      data: null
    })

    for (let i = 0; i < 100; i++) {
      await clock.tickAsync(150)
    }

    const res1 = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.assert.deepStrictEqual(await res1.json(), {
      errors: [
        {
          message: 'Cannot query field "posts" on type "User".',
          locations: [{ line: 6, column: 9 }]
        }
      ],
      data: null
    })
  })

  test('gateway - should log error if retry throws', async t => {
    const service1 = await createTestService(
      0,
      userService.schema,
      userService.resolvers
    )

    let service2 = null

    clock.setTimeout(async () => {
      service2 = await createTestService(
        5114,
        postService.schema,
        postService.resolvers
      )
    }, 500)

    const gateway = Fastify()

    gateway.log.error = error => {
      if (error.message.includes('kaboom')) {
        t.assert.ok(true)
      }
    }

    t.after(async () => {
      await gateway.close()
      await service1.close()
      await service2.close()
    })

    await gateway.register(plugin, {
      gateway: {
        services: [
          {
            name: 'user',
            url: `http://localhost:${service1.server.address().port}/graphql`,
            mandatory: false
          },
          {
            name: 'post',
            url: 'http://localhost:5114/graphql',
            mandatory: true
          }
        ],
        retryServicesCount: 1,
        retryServicesInterval: 3000
      },
      jit: 1
    })

    gateway.graphqlGateway.addHook('onGatewayReplaceSchema', async () => {
      throw new Error('kaboom')
    })

    await gateway.ready()

    for (let i = 0; i < 200; i++) {
      await clock.tickAsync(50)
    }
  })

  test('gateway - stop retrying after no. of retries exceeded', async t => {
    const service1 = await createTestService(
      0,
      userService.schema,
      userService.resolvers
    )

    const gateway = Fastify()

    let errCount = 0
    gateway.log.error = error => {
      if (error.code === 'MER_ERR_GQL_GATEWAY_REFRESH' && errCount === 0) {
        errCount++
        t.assert.ok(true)
      }
    }

    t.after(async () => {
      await gateway.close()
      await service1.close()
    })

    await gateway.register(plugin, {
      gateway: {
        services: [
          {
            name: 'user',
            url: `http://localhost:${service1.server.address().port}/graphql`,
            mandatory: false
          },
          {
            name: 'post',
            url: 'http://localhost:5115/graphql',
            mandatory: true
          }
        ],
        retryServicesCount: 1,
        retryServicesInterval: 2000
      },
      jit: 1
    })

    await gateway.ready()

    for (let i = 0; i < 100; i++) {
      await clock.tickAsync(150)
    }
  })
})
