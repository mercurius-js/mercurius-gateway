'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const { MockAgent, setGlobalDispatcher, getGlobalDispatcher } = require('undici')
const plugin = require('../index')

test('gateway with two federated services using MockAgent interceptors', async t => {
  const userServiceHost = 'http://user-service.test'
  const postServiceHost = 'http://post-service.test'

  const mockAgent = new MockAgent()
  setGlobalDispatcher(mockAgent)

  const userPool = mockAgent.get(userServiceHost)
  const postPool = mockAgent.get(postServiceHost)

  // Intercept user service queries
  userPool
    .intercept({
      path: '/graphql',
      method: 'POST'
    })
    .reply(200, (opts) => {
      const body = JSON.parse(opts.body)
      const query = body.query || ''

      // Entity resolution for User
      if (query.includes('_entities')) {
        const representations = body.variables.representations
        const entities = representations.map(ref => ({
          __typename: 'User',
          id: ref.id,
          name: ref.id === 'u1' ? 'Alice' : 'Bob'
        }))
        return JSON.stringify({ data: { _entities: entities } })
      }

      // Regular query: me
      return JSON.stringify({
        data: {
          me: { id: 'u1', name: 'Alice' }
        }
      })
    }, {
      headers: { 'content-type': 'application/json' }
    })
    .persist()

  // Intercept post service queries
  postPool
    .intercept({
      path: '/graphql',
      method: 'POST'
    })
    .reply(200, (opts) => {
      const body = JSON.parse(opts.body)
      const query = body.query || ''

      // Entity resolution for User (posts field)
      if (query.includes('_entities')) {
        const representations = body.variables.representations
        const entities = representations.map(ref => ({
          __typename: 'User',
          id: ref.id,
          posts: [
            { pid: 'p1', title: 'First Post' }
          ]
        }))
        return JSON.stringify({ data: { _entities: entities } })
      }

      return JSON.stringify({ data: null })
    }, {
      headers: { 'content-type': 'application/json' }
    })
    .persist()

  const userServiceSchema = `
    type Query @extends {
      me: User
    }

    type User @key(fields: "id") {
      id: ID!
      name: String!
    }
  `

  const postServiceSchema = `
    type Post @key(fields: "pid") {
      pid: ID!
      title: String
    }

    type User @key(fields: "id") @extends {
      id: ID! @external
      posts: [Post]
    }
  `

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await mockAgent.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `${userServiceHost}/graphql`,
          schema: userServiceSchema,
          agent: getGlobalDispatcher()
        },
        {
          name: 'post',
          url: `${postServiceHost}/graphql`,
          schema: postServiceSchema,
          agent: getGlobalDispatcher()
        }
      ]
    }
  })

  const res = await gateway.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({
      query: `{
        me {
          id
          name
          posts {
            pid
            title
          }
        }
      }`
    })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 'u1',
        name: 'Alice',
        posts: [
          { pid: 'p1', title: 'First Post' }
        ]
      }
    }
  })
})
