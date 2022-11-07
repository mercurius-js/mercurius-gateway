'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercurius/federation')

async function createService(t, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port: 0 })

  return [service, service.server.address().port]
}

test('Should support array references with _entities query', async t => {
  const topPosts = [
    {
      id: 1,
      title: 'test',
      content: 'test',
      authorIds: [1, 2]
    },
    {
      id: 2,
      title: 'test2',
      content: 'test2',
      authorIds: [3]
    }
  ]

  const users = [
    {
      id: 1,
      name: 'toto'
    },
    {
      id: 2,
      name: 'titi'
    },
    {
      id: 3,
      name: 'tata'
    }
  ]

  const [postService, postServicePort] = await createService(
    t,
    `
    extend type Query {
      topPosts: [Post]
    }

    type Post @key(fields: "id") {
      id: ID!
      title: String
      content: String
      authors: [User]
    }

    extend type User @key(fields: "id") {
      id: ID! @external
    }
  `,
    {
      Post: {
        authors: async root => {
          if (root.authorIds) {
            return root.authorIds.map(id => ({ __typename: 'User', id }))
          }
        }
      },
      Query: {
        topPosts: async () => {
          return topPosts
        }
      }
    }
  )

  const [userService, userServicePort] = await createService(
    t,
    `
    type User @key(fields: "id") {
      id: ID!
      name: String
    }
  `,
    {
      User: {
        __resolveReference: async reference => {
          if (reference.id) {
            return users.find(u => u.id === parseInt(reference.id))
          }
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await postService.close()
    await userService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`
        },
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
  {
    topPosts{
      id
      title
      content
      authors {
        id
        name
      }
    }
  }`

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      topPosts: [
        {
          id: 1,
          title: 'test',
          content: 'test',
          authors: [
            {
              id: 1,
              name: 'toto'
            },
            {
              id: 2,
              name: 'titi'
            }
          ]
        },
        {
          id: 2,
          title: 'test2',
          content: 'test2',
          authors: [
            {
              id: 3,
              name: 'tata'
            }
          ]
        }
      ]
    }
  })
})

test('Should support multiple `extends` of the same type in the service SDL', async t => {
  const [productService, productServicePort] = await createService(
    t,
    `
    extend type Query {
      ping: Int
    }
    extend type Query {
      pong: Int
    }
  `,
    {
      Query: {
        ping: async () => {
          return 1
        },
        pong: async () => {
          return 2
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await productService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'product',
          url: `http://localhost:${productServicePort}/graphql`
        }
      ]
    }
  })

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: '{ ping }'
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      ping: 1
    }
  })

  const res2 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query: '{ pong }'
    })
  })

  t.same(JSON.parse(res2.body), {
    data: {
      pong: 2
    }
  })
})

test('Should support array references with _entities query and empty response', async t => {
  const topPosts = [
    {
      id: 1,
      title: 'test',
      content: 'test',
      authorIds: []
    },
    {
      id: 2,
      title: 'test2',
      content: 'test2',
      authorIds: []
    }
  ]

  const users = [
    {
      id: 1,
      name: 'toto'
    },
    {
      id: 2,
      name: 'titi'
    },
    {
      id: 3,
      name: 'tata'
    }
  ]

  const [postService, postServicePort] = await createService(
    t,
    `
    extend type Query {
      topPosts: [Post]
    }

    type Post @key(fields: "id") {
      id: ID!
      title: String
      content: String
      authors: [User]!
    }

    extend type User @key(fields: "id") {
      id: ID! @external
    }
  `,
    {
      Post: {
        authors: async root => {
          if (root.authorIds) {
            return root.authorIds.map(id => ({ __typename: 'User', id }))
          }
        }
      },
      Query: {
        topPosts: async () => {
          return topPosts
        }
      }
    }
  )

  const [userService, userServicePort] = await createService(
    t,
    `
    type User @key(fields: "id") {
      id: ID!
      name: String
    }
  `,
    {
      User: {
        __resolveReference: async reference => {
          if (reference.id) {
            return users.find(u => u.id === parseInt(reference.id))
          }
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await postService.close()
    await userService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`
        },
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
  {
    topPosts{
      id
      title
      content
      authors {
        id
        name
      }
    }
  }`

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      topPosts: [
        {
          id: 1,
          title: 'test',
          content: 'test',
          authors: []
        },
        {
          id: 2,
          title: 'test2',
          content: 'test2',
          authors: []
        }
      ]
    }
  })
})

test('Should support array references with _entities query and empty response and nullable field', async t => {
  const topPosts = [
    {
      id: 1,
      title: 'test',
      content: 'test',
      authorIds: []
    },
    {
      id: 2,
      title: 'test2',
      content: 'test2',
      authorIds: []
    }
  ]

  const users = [
    {
      id: 1,
      name: 'toto'
    },
    {
      id: 2,
      name: 'titi'
    },
    {
      id: 3,
      name: 'tata'
    }
  ]

  const [postService, postServicePort] = await createService(
    t,
    `
    extend type Query {
      topPosts: [Post]
    }

    type Post @key(fields: "id") {
      id: ID!
      title: String
      content: String
      authors: [User]
    }

    extend type User @key(fields: "id") {
      id: ID! @external
    }
  `,
    {
      Post: {
        authors: async root => {
          if (root.authorIds) {
            return root.authorIds.map(id => ({ __typename: 'User', id }))
          }
        }
      },
      Query: {
        topPosts: async () => {
          return topPosts
        }
      }
    }
  )

  const [userService, userServicePort] = await createService(
    t,
    `
    type User @key(fields: "id") {
      id: ID!
      name: String
    }
  `,
    {
      User: {
        __resolveReference: async reference => {
          if (reference.id) {
            return users.find(u => u.id === parseInt(reference.id))
          }
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await postService.close()
    await userService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`
        },
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
  {
    topPosts{
      id
      title
      content
      authors {
        id
        name
      }
    }
  }`

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      topPosts: [
        {
          id: 1,
          title: 'test',
          content: 'test',
          authors: null
        },
        {
          id: 2,
          title: 'test2',
          content: 'test2',
          authors: null
        }
      ]
    }
  })
})
