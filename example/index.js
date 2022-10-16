const Fastify = require('fastify')
const config = require('./config.js')
const logger = require('./logger.js')
const services = require('./app.js')

const app = Fastify({
  logger: logger(config.log),
  disableRequestLogging: config.log.disableRequestLogging
})

app.register(services(config))

app.addHook('onClose', (instance, done) => {
  done()
})

async function run(fastifyApp) {
  await fastifyApp.listen(config.app.port, '0.0.0.0')
}

run(app).catch(err => {
  app.log.fatal(err, 'error starting app')
  process.exit(1)
})
