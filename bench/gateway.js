'use strict'

const Fastify = require('fastify')
const mercuriusGateway = require('..')

const app = Fastify()

app.register(mercuriusGateway, {
  gateway: {
    services: [{
      name: 'user',
      url: 'http://localhost:3001/graphql'
    }, {
      name: 'post',
      url: 'http://localhost:3002/graphql'
    }]
  },
  graphiql: false,
  jit: 1
})

app.listen({ port: 3000 })
