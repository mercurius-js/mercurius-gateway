'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const plugin = require('../index')
const createTestService = require('./utils/create-test-service')

async function createTestGatewayServer (t) {
  const [service, servicePort] = await createTestService(
    t,
    `
    extend type Query {
      me: User!
    }

    type User {
      id: Int!
      name: String!
      secret: String
    }
    `,
    {
      Query: {
        me: () => ({
          id: 1,
          name: 'John Doe'
        })
      },
      User: {
        secret: () => new Error('You have no access to this field!')
      }
    }
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await service.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'service',
          url: `http://localhost:${servicePort}/graphql`
        }
      ]
    }
  })

  return gateway
}

test('query returns both data and errors', async (t) => {
  const app = await createTestGatewayServer(t)

  const query = 'query { me { id name secret } }'

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.assert.deepStrictEqual(JSON.parse(res.body), {
    data: {
      me: {
        id: 1,
        name: 'John Doe',
        secret: null
      }
    },
    errors: [
      {
        message: 'You have no access to this field!',
        locations: [
          {
            line: 5,
            column: 5
          }
        ],
        path: ['me', 'secret']
      }
    ]
  })
})
