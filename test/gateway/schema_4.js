'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../../index')
const { buildFederationSchema } = require('../../index')

async function createService(t, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port: 0 })

  return [service, service.server.address().port]
}

test('Uses the supplied schema for federation rather than fetching it remotely', async t => {
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
    }
  }

  const [userService, userServicePort] = await createService(
    t,
    `
    directive @customDirective on FIELD_DEFINITION

    extend type Query {
      me: User
      hello: String
    }

    type User @key(fields: "id") {
      id: ID!
      name: String!
      avatar(size: AvatarSize): String
      friends: [User]
    }

    enum AvatarSize {
      small
      medium
      large
    }
  `,
    {
      Query: {
        me: () => {
          return users.u1
        },
        hello: () => 'World'
      },
      User: {
        __resolveReference: user => {
          return users[user.id]
        },
        avatar: (user, { size }) => `avatar-${size}.jpg`,
        friends: user => Object.values(users).filter(u => u.id !== user.id)
      }
    }
  )

  const postServiceSdl = `
    type Post @key(fields: "pid") {
      pid: ID!
      title: String
      content: String
      author: User @requires(fields: "title")
    }

    extend type Query {
      topPosts(count: Int): [Post]
      _service: String
    }

    type User @key(fields: "id") @extends {
      id: ID! @external
      name: String @external
      posts: [Post]
      numberOfPosts: Int @requires(fields: "id")
    }
  `

  const [postService, postServicePort] = await createService(
    t,
    postServiceSdl,
    {
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
        posts: user => {
          return Object.values(posts).filter(p => p.authorId === user.id)
        },
        numberOfPosts: user => {
          return Object.values(posts).filter(p => p.authorId === user.id).length
        }
      },
      Query: {
        topPosts: (root, { count = 2 }) => Object.values(posts).slice(0, count),
        _service: () => new Error('Not supposed to retrieve this')
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
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`,
          schema: postServiceSdl
        }
      ]
    }
  })

  const query = `
  query MainQuery(
    $size: AvatarSize
    $count: Int
  ) {
    me {
      id
      name
      avatar(size: $size)
      friends {
        ...UserFragment
        friends {
          ...UserFragment
        }
      }
      posts {
        ...PostFragment
      }
      numberOfPosts
    }
    topPosts(count: $count) {
      ...PostFragment
    }
    hello
  }

  fragment UserFragment on User {
    id
    name
    avatar(size: medium)
    numberOfPosts
  }

  fragment PostFragment on Post {
    pid
    title
    content
    ...AuthorFragment
  }

  fragment AuthorFragment on Post {
    author {
      ...UserFragment
    }
  }`
  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({
      query,
      variables: {
        size: 'small',
        count: 1
      }
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        avatar: 'avatar-small.jpg',
        friends: [
          {
            id: 'u2',
            name: 'Jane',
            avatar: 'avatar-medium.jpg',
            numberOfPosts: 2,
            friends: [
              {
                id: 'u1',
                name: 'John',
                avatar: 'avatar-medium.jpg',
                numberOfPosts: 2
              },
              {
                id: 'u3',
                name: 'Jack',
                avatar: 'avatar-medium.jpg',
                numberOfPosts: 0
              }
            ]
          },
          {
            id: 'u3',
            name: 'Jack',
            avatar: 'avatar-medium.jpg',
            numberOfPosts: 0,
            friends: [
              {
                id: 'u1',
                name: 'John',
                avatar: 'avatar-medium.jpg',
                numberOfPosts: 2
              },
              {
                id: 'u2',
                name: 'Jane',
                avatar: 'avatar-medium.jpg',
                numberOfPosts: 2
              }
            ]
          }
        ],
        posts: [
          {
            pid: 'p1',
            title: 'Post 1',
            content: 'Content 1',
            author: {
              id: 'u1',
              name: 'John',
              avatar: 'avatar-medium.jpg',
              numberOfPosts: 2
            }
          },
          {
            pid: 'p3',
            title: 'Post 3',
            content: 'Content 3',
            author: {
              id: 'u1',
              name: 'John',
              avatar: 'avatar-medium.jpg',
              numberOfPosts: 2
            }
          }
        ],
        numberOfPosts: 2
      },
      topPosts: [
        {
          pid: 'p1',
          title: 'Post 1',
          content: 'Content 1',
          author: {
            id: 'u1',
            name: 'John',
            avatar: 'avatar-medium.jpg',
            numberOfPosts: 2
          }
        }
      ],
      hello: 'World'
    }
  })
})

test('Non mandatory gateway failure wont stop gateway creation', async t => {
  const [brokenService, brokenServicePort] = await createService(
    t,
    `
    extend type Query {
      _service: String
    }
  `,
    {
      Query: {
        _service: () => {
          throw new Error()
        }
      }
    }
  )

  const [workingService, workingServicePort] = await createService(
    t,
    `
    extend type Query {
      hello: String!
    }
  `,
    {
      Query: {
        hello: () => 'world'
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await brokenService.close()
    await workingService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'working',
          url: `http://localhost:${workingServicePort}/graphql`
        },
        {
          name: 'broken',
          url: `http://localhost:${brokenServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
    query {
      hello
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
      hello: 'world'
    }
  })
})

test('Update the schema', async t => {
  const partialSchema = `
    extend type Query {
      hello: String!
    }
  `

  const fullSchema = `
    extend type Query {
      hello: String
      world: String
    }
  `

  const [service, servicePort] = await createService(t, fullSchema, {
    Query: {
      hello: () => 'world',
      world: () => 'hello'
    }
  })

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await service.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'working',
          url: `http://localhost:${servicePort}/graphql`,
          schema: partialSchema
        }
      ]
    }
  })

  const query = `
    query {
      hello
      world
    }`
  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(
    JSON.parse(res.body).errors[0].message,
    'Cannot query field "world" on type "Query".'
  )

  gateway.graphql.gateway.serviceMap.working.setSchema(fullSchema)
  const newSchema = await gateway.graphql.gateway.refresh()

  gateway.graphql.replaceSchema(newSchema)

  const res2 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res2.body), {
    data: {
      hello: 'world',
      world: 'hello'
    }
  })
})

test('Update the schema without any changes', async t => {
  const schemaNode = `
    extend type Query {
      hello: String!
    }
  `

  const [service, servicePort] = await createService(t, schemaNode, {
    Query: {
      hello: () => 'world'
    }
  })

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await service.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'working',
          url: `http://localhost:${servicePort}/graphql`,
          schema: schemaNode
        }
      ]
    }
  })

  const query = `
    query {
      hello
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
      hello: 'world'
    }
  })

  gateway.graphql.gateway.serviceMap.working.setSchema(schemaNode)
  const newSchema = await gateway.graphql.gateway.refresh()

  t.equal(newSchema, null)
})

test('It builds the gateway schema correctly with two services query extension having the _service fields', async t => {
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
    }
  }

  const [userService, userServicePort] = await createService(
    t,
    `
    directive @customDirective on FIELD_DEFINITION

    type _Service {
      sdl: String
    }

    extend type Query {
      me: User
      hello: String
      _service: _Service!
    }

    type User @key(fields: "id") {
      id: ID!
      name: String!
      avatar(size: AvatarSize): String
      friends: [User]
    }

    enum AvatarSize {
      small
      medium
      large
    }
  `,
    {
      Query: {
        me: () => {
          return users.u1
        },
        hello: () => 'World'
      },
      User: {
        __resolveReference: user => {
          return users[user.id]
        },
        avatar: (user, { size }) => `avatar-${size}.jpg`,
        friends: user => Object.values(users).filter(u => u.id !== user.id)
      }
    }
  )

  const [postService, postServicePort] = await createService(
    t,
    `
    type Post @key(fields: "pid") {
      pid: ID!
      title: String
      content: String
      author: User @requires(fields: "title")
    }

    type _Service {
      sdl: String
    }

    extend type Query {
      topPosts(count: Int): [Post]
      _service: _Service!
    }

    type User @key(fields: "id") @extends {
      id: ID! @external
      name: String @external
      posts: [Post]
      numberOfPosts: Int @requires(fields: "id")
    }
  `,
    {
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
        posts: user => {
          return Object.values(posts).filter(p => p.authorId === user.id)
        },
        numberOfPosts: user => {
          return Object.values(posts).filter(p => p.authorId === user.id).length
        }
      },
      Query: {
        topPosts: (root, { count = 2 }) => Object.values(posts).slice(0, count)
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
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`,
          rewriteHeaders: headers => {
            if (headers.authorization) {
              return {
                authorization: headers.authorization
              }
            }
          }
        },
        {
          name: 'post',
          url: `http://localhost:${postServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
  query MainQuery(
    $size: AvatarSize
    $count: Int
  ) {
    me {
      id
      name
      avatar(size: $size)
      friends {
        ...UserFragment
        friends {
          ...UserFragment
        }
      }
      posts {
        ...PostFragment
      }
      numberOfPosts
    }
    topPosts(count: $count) {
      ...PostFragment
    }
    hello
  }

  fragment UserFragment on User {
    id
    name
    avatar(size: medium)
    numberOfPosts
  }

  fragment PostFragment on Post {
    pid
    title
    content
    ...AuthorFragment
  }

  fragment AuthorFragment on Post {
    author {
      ...UserFragment
    }
  }`
  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'bearer supersecret'
    },
    url: '/graphql',
    body: JSON.stringify({
      query,
      variables: {
        size: 'small',
        count: 1
      }
    })
  })

  t.same(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'John',
        avatar: 'avatar-small.jpg',
        friends: [
          {
            id: 'u2',
            name: 'Jane',
            avatar: 'avatar-medium.jpg',
            numberOfPosts: 2,
            friends: [
              {
                id: 'u1',
                name: 'John',
                avatar: 'avatar-medium.jpg',
                numberOfPosts: 2
              },
              {
                id: 'u3',
                name: 'Jack',
                avatar: 'avatar-medium.jpg',
                numberOfPosts: 0
              }
            ]
          },
          {
            id: 'u3',
            name: 'Jack',
            avatar: 'avatar-medium.jpg',
            numberOfPosts: 0,
            friends: [
              {
                id: 'u1',
                name: 'John',
                avatar: 'avatar-medium.jpg',
                numberOfPosts: 2
              },
              {
                id: 'u2',
                name: 'Jane',
                avatar: 'avatar-medium.jpg',
                numberOfPosts: 2
              }
            ]
          }
        ],
        posts: [
          {
            pid: 'p1',
            title: 'Post 1',
            content: 'Content 1',
            author: {
              id: 'u1',
              name: 'John',
              avatar: 'avatar-medium.jpg',
              numberOfPosts: 2
            }
          },
          {
            pid: 'p3',
            title: 'Post 3',
            content: 'Content 3',
            author: {
              id: 'u1',
              name: 'John',
              avatar: 'avatar-medium.jpg',
              numberOfPosts: 2
            }
          }
        ],
        numberOfPosts: 2
      },
      topPosts: [
        {
          pid: 'p1',
          title: 'Post 1',
          content: 'Content 1',
          author: {
            id: 'u1',
            name: 'John',
            avatar: 'avatar-medium.jpg',
            numberOfPosts: 2
          }
        }
      ],
      hello: 'World'
    }
  })
})
