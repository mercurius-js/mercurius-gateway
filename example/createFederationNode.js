const Fastify = require('fastify')
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')

async function createNode (name, schema, resolvers, port) {
  const app = Fastify()
  app.register(mercuriusFederationPlugin, {
    schema,
    resolvers
  })

  app.get('/', async function () {
    const query = '{ _service { sdl } }'
    return app.graphql(query)
  })

  await app.listen({ port })
}

module.exports = createNode
