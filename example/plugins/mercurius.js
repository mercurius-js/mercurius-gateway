const mercurius = require('mercurius')
const fp = require('fastify-plugin')
const { createGateway } = require('../../index')

module.exports = fp(
  async (fastify, options) => {
    const gateway = await createGateway(
      {
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
      },
      fastify
    )

    await fastify.register(mercurius, {
      schema: gateway.schema,
      graphiql: options.graphql.graphiql
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
