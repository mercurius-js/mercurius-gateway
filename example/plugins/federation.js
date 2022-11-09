const fp = require('fastify-plugin')
const plugin = require('../../index')

module.exports = fp(
  async (fastify, options) => {
    await fastify.register(plugin, {
      graphiql: options.graphql.graphiql,
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

    fastify.get('/sdl', async function () {
      const query = '{ _service { sdl } }'
      return fastify.graphql(query)
    })
  },
  {
    name: 'mercurius',
    dependencies: ['node-1', 'node-2']
  }
)
