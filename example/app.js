const fp = require('fastify-plugin')
const autoload = require('@fastify/autoload')
const cors = require('@fastify/cors')

module.exports = config =>
  fp(async function (fastify, options) {
    fastify.decorate('config', config)

    await fastify.register(cors, {})

    for (const plugin of config.thirdParty || []) {
      fastify.register(plugin.module, Object.assign({}, options, config))
    }

    for (const plugin of config.autoload) {
      fastify.register(autoload, {
        dir: plugin.path,
        options: Object.assign({}, options, config)
      })
    }

    fastify.get('/alive', () => {
      return { status: 'OK' }
    })

    fastify.get('/', () => {
      return { status: 'OK' }
    })
  })
