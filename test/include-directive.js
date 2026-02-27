'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')
const { users, posts } = require('./utils/mocks')

async function createTestService (t, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port: 0 })
  return [service, service.server.address().port]
}

async function createTestGatewayServer (t) {
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
  const [userService, userServicePort] = await createTestService(
    t,
    userServiceSchema,
    userServiceResolvers
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
    await userService.close()
    await postService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`
        }
      ]
    }
  })

  return gateway
}

test('gateway - should support truthy include directive', async t => {
  const app = await createTestGatewayServer(t)

  const variables = {
    shouldInclude: true,
    input: 'hello'
  }
  const query = `
    query GetMe($input: String!, $shouldInclude: Boolean!) {
      me {
        id
        name
        metadata(input: $input) @include(if: $shouldInclude) {
          info
        }
        topPosts(count: 1) @include(if: $shouldInclude) {
          pid
        }
      }
    }`

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query, variables })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        metadata: {
          info: 'hello'
        },
        topPosts: [
          {
            pid: 'p1'
          }
        ]
      }
    }
  })
})

test('gateway - should support falsy include directive', async t => {
  const app = await createTestGatewayServer(t)

  const variables = {
    shouldInclude: false,
    input: 'hello'
  }
  const query = `
    query GetMe($input: String!, $shouldInclude: Boolean!) {
      me {
        id
        name
        metadata(input: $input) @include(if: $shouldInclude) {
          info
        }
        topPosts(count: 1) @include(if: $shouldInclude) {
          pid
        }
      }
    }`

  const res = await app.inject({
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
})
