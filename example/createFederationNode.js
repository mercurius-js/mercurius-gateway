const Fastify = require('fastify')
const mercurius = require('mercurius')

async function createNode(name, schema, resolvers, port) {
  const app = Fastify()
  app.register(mercurius, {
    schema,
    resolvers,
    federationMetadata: true
  })

  app.get('/', async function () {
    const query = '{ _service { sdl } }'
    return app.graphql(query)
  })

  await app.listen({ port })
}

module.exports = createNode
