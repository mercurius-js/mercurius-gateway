'use strict'

const fp = require('fastify-plugin')
const GQL = require('mercurius')

const { createGateway } = require('./gateway')
const { defaultErrorFormatter, FederatedError } = require('./errors')

const plugin = fp(async (fastify, opts) => {
  const gateway = opts.gateway
  delete opts.gateway

  const errorFormatter = typeof opts.errorFormatter === 'function' ? opts.errorFormatter : defaultErrorFormatter

  await fastify.register(GQL, {
    schema: ' type Query { hello: String }',
    ...opts,
    errorFormatter
  })
  await createGateway(gateway, fastify)
})

plugin.FederatedError = FederatedError
plugin.defaultErrorFormatter = defaultErrorFormatter

module.exports = plugin
