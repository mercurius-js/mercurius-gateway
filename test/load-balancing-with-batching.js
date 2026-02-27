'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const { users, posts } = require('./utils/mocks')

async function createTestService (
  t,
  schema,
  resolvers = {},
  fn = async () => {}
) {
  const service = Fastify()
  service.addHook('preHandler', fn)
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers,
    allowBatchedQueries: true
  })
  await service.listen({ port: 0 })
  return [service, service.server.address().port]
}

test('load balances two peers', async t => {
  // User service
  const userServiceSchema = `
  type Query @extends {
    me: User
  }

  type Metadata {
    info: String!
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
    metadata(input: String!): Metadata!
  }`
  const userServiceResolvers = {
    Query: {
      me: () => {
        return users.u1
      }
    },
    User: {
      metadata: (user, args) => {
        return {
          info: args.input
        }
      }
    }
  }
  let user1called = 0
  let user2called = 0
  const [userService1, userServicePort1] = await createTestService(
    t,
    userServiceSchema,
    userServiceResolvers,
    async () => {
      user1called++
    }
  )
  const [userService2, userServicePort2] = await createTestService(
    t,
    userServiceSchema,
    userServiceResolvers,
    async () => {
      user2called++
    }
  )

  // Post service
  const postServiceSchema = `
  type Post @key(fields: "pid") {
    pid: ID!
  }

  type User @key(fields: "id") @extends {
    id: ID! @external
    topPosts(count: Int!): [Post]
  }`
  const postServiceResolvers = {
    User: {
      topPosts: (user, { count }) => {
        return Object.values(posts)
          .filter(p => p.authorId === user.id)
          .slice(0, count)
      }
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
    await userService1.close()
    await userService2.close()
    await postService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: [
            `http://localhost:${userServicePort1}/graphql`,
            `http://localhost:${userServicePort2}/graphql`
          ],
          allowBatchedQueries: true
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`,
          allowBatchedQueries: true
        }
      ]
    }
  })

  await gateway

  const variables = {
    shouldSkip: true,
    input: 'hello'
  }
  const query = `
    query GetMe($input: String!, $shouldSkip: Boolean!) {
      me {
        id
        name
        metadata(input: $input) @skip(if: $shouldSkip) {
          info
        }
        topPosts(count: 1) @skip(if: $shouldSkip) {
          pid
        }
      }
    }`

  {
    const res = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query, variables })
    })

    t.assert.deepStrictEqual(JSON.parse(res.body), {
      data: {
        me: {
          id: 'u1',
          name: 'John'
        }
      }
    })
  }

  {
    const res = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query, variables })
    })

    t.assert.deepStrictEqual(JSON.parse(res.body), {
      data: {
        me: {
          id: 'u1',
          name: 'John'
        }
      }
    })
  }

  // Called two times, one to get the schema and one for the query
  t.assert.strictEqual(user1called, 2)

  // Called one time, one one for the query
  t.assert.strictEqual(user2called, 1)
})
