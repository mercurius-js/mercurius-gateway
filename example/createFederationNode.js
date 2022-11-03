const Fastify = require('fastify')
const plugin = require('./index')

async function createNode(name, schema, resolvers, port) {
  const app = Fastify()
  app.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: 'http://localhost:4001/graphql'
        },
        {
          name: 'post',
          url: 'http://localhost:4002/graphql'
        }
      ]
    }
  })

  app.get('/', async function () {
    const query = '{ _service { sdl } }'
    return app.graphql(query)
  })

  await app.listen({ port })
}

module.exports = createNode
