'use strict'

const Fastify = require('fastify')
const GQL = require('mercurius')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createTestService (t, schema, resolvers = {}) {
  const service = Fastify()

  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port: 0 })

  return [service, service.server.address().port]
}

module.exports = createTestService
