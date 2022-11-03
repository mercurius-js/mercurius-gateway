const fp = require('fastify-plugin')
const GQL = require('mercurius')

const { createGateway } = require('./gateway')

module.exports = fp(async (fastify, props) => {
  const gateway = props.gateway
  delete props.gateway
  await fastify.register(GQL, {
    schema: ` type Query { hello: String }`,
    ...props
  })
  await createGateway(gateway, fastify)
})
