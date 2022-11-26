'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const plugin = require('../index')
const createTestService = require('./utils/create-test-service')

const users = {
  u1: {
    id: 'u1',
    name: 'John'
  },
  u2: {
    id: 'u2',
    name: 'Jane'
  },
  u3: {
    id: 'u3',
    name: 'Jack'
  }
}

const posts = {
  p1: {
    pid: 'p1',
    title: 'Post 1',
    content: 'Content 1',
    authorId: 'u1'
  },
  p2: {
    pid: 'p2',
    title: 'Post 2',
    content: 'Content 2',
    authorId: 'u2'
  },
  p3: {
    pid: 'p3',
    title: 'Post 3',
    content: 'Content 3',
    authorId: 'u1'
  },
  p4: {
    pid: 'p4',
    title: 'Post 4',
    content: 'Content 4',
    authorId: 'u2'
  },
  p5: {
    pid: 'p5',
    title: 'Post 5',
    content: 'Apollo filters this one out. Mercurius filters it out, then calls __resolveReference for some reason. This causes it to call User.posts again (but this time without posts data). So it looks up posts again, but this time without the filter logic that was in place in the Query resolver.',
    authorId: 'u1'
  }
}

async function createTestGatewayServer (t) {
  const [firstService, firstServicePort] = await createTestService(
    t,
    `
    type User @key(fields: "id") {
      id: ID!
      name: String!
    }
  `,
    {
      User: {
        __resolveReference: (user, args, context, info) => {
          return users[user.id]
        }
      }
    }
  )

  const [secondService, secondServicePort] = await createTestService(
    t,
    `
    type Post @key(fields: "pid") {
      pid: ID!
      title: String
      content: String
      author: User
    }
    type Query @extends {
      userByPost(ids: [ID!]!): [User] @provides (fields: "id")
    }
    extend type User @key(fields: "id") {
      id: ID! @external
      name: String @external
      posts: [Post]
    }
  `,
    {
      Post: {
        __resolveReference: (post, args, context, info) => {
          return posts[post.pid]
        },
        author: (post, args, context, info) => {
          return {
            __typename: 'User',
            id: post.authorId
          }
        }
      },
      User: {
        posts: (user, args, context, info) => {
          if (user.posts) {
            return user.posts
          }
          t.fail('Should not be called')
          return Object.values(posts).filter(p => p.authorId === user.id)
        }
      },
      Query: {
        userByPost: (root, args, context, info) => {
          const users = []
          for (const id of args.ids) {
            users.push({ id, posts: Object.values(posts).filter(p => p.authorId === id && p.pid !== 'p5') })
          }
          return users
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await firstService.close()
    await secondService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'first',
          url: `http://localhost:${firstServicePort}/graphql`
        },
        {
          name: 'second',
          url: `http://localhost:${secondServicePort}/graphql`
        }
      ]
    }
  })

  return gateway
}

test('query returns a scalar type', async t => {
  t.plan(1)
  const app = await createTestGatewayServer(t)

  const query = 'query { userByPost(ids: ["u1","u2"]) { id posts { pid title content } } }'

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      userByPost: [{
        id: 'u1',
        posts: [{ pid: 'p1', title: 'Post 1', content: 'Content 1' }, {
          pid: 'p3',
          title: 'Post 3',
          content: 'Content 3'
        }]
      }, {
        id: 'u2',
        posts: [{ pid: 'p2', title: 'Post 2', content: 'Content 2' }, {
          pid: 'p4',
          title: 'Post 4',
          content: 'Content 4'
        }]
      }]
    }
  })
})
