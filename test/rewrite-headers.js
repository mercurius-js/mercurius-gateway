'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createTestService (schema, resolvers = {}, hooks = {}) {
  const service = Fastify()
  service.register(GQL, { schema: buildFederationSchema(schema), resolvers })

  Object.entries(hooks).forEach(([hookName, handler]) => {
    service.addHook(hookName, handler)
  })

  await service.listen({ port: 0 })
  return [service, service.server.address().port]
}

const TEST_USERS = {
  u1: { id: 'u1', name: 'John' },
  u2: { id: 'u2', name: 'Jane' }
}

// User service
async function createUserService ({ hooks } = {}) {
  const schema = `
  type Query @extends {
    me: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String!
  }`

  const resolvers = {
    Query: {
      me: () => TEST_USERS.u1
    }
  }

  return createTestService(schema, resolvers, hooks)
}

test('gateway - service rewriteHeaders', async t => {
  await t.test('rewriteHeaders is called as expected', async t => {
    const [users, usersPort] = await createUserService()

    const gateway = Fastify()
    t.after(async () => {
      await gateway.close()
      await users.close()
    })

    const rewriteHeaders = (headers, context = 'not-passed') => {
      t.assert.ok(headers != null, 'Headers is never undefined/null')

      // `context` isn't available from `getRemoteSchemaDefinition`
      // as such assert it's 'not-passed' OR includes `app` exact instance
      t.assert.ok(context === 'not-passed' || context.app === gateway)
    }

    const url = `http://localhost:${usersPort}/graphql`
    await gateway.register(plugin, {
      gateway: { services: [{ name: 'user', url, rewriteHeaders }] }
    })

    const res = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query: 'query { user: me { id name } }' })
    })

    const expected = { data: { user: { id: 'u1', name: 'John' } } }
    t.assert.deepStrictEqual(JSON.parse(res.body), expected)
  })

  await t.test('returned headers are sent to graphql service', async t => {
    const custom = `Testing-${Math.trunc(Math.random() * 100)}`
    const onRequest = async req => {
      t.assert.ok(req.headers['x-custom'] === custom)
    }

    const [users, usersPort] = await createUserService({ hooks: { onRequest } })

    const gateway = Fastify()
    t.after(async () => {
      await gateway.close()
      await users.close()
    })

    const rewriteHeaders = async () => ({ 'x-custom': custom })
    const url = `http://localhost:${usersPort}/graphql`

    await gateway.register(plugin, {
      gateway: { services: [{ name: 'user', url, rewriteHeaders }] }
    })

    const res = await gateway.inject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      url: '/graphql',
      body: JSON.stringify({ query: 'query { user: me { id name } }' })
    })

    const expected = { data: { user: { id: 'u1', name: 'John' } } }
    t.assert.deepStrictEqual(JSON.parse(res.body), expected)
  })
})
