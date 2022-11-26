'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const plugin = require('../index')
const createTestService = require('./utils/create-test-service')

async function createTestGatewayServer (t) {
  const [firstService, firstServicePort] = await createTestService(
    t,
    'extend type Query { countMe: Int! }',
    { Query: { countMe: () => 42 } }
  )

  const [secondService, secondServicePort] = await createTestService(
    t,
    'extend type Query { noCountMe: Int! }',
    { Query: { noCountMe: () => 13 } }
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

  const query = 'query { countMe noCountMe }'

  const res = await app.inject({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      countMe: 42,
      noCountMe: 13
    }
  })
})
