'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createTestService (t, schema, resolvers = {}) {
  const service = Fastify()

  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port: 0 })

  return [service, service.server.address().port]
}

async function createTestGatewayServer (t) {
  // User service
  const userExtendSchema = `
    type Query @extends {
      hello: String
    }

    extend type User @key(fields: "id") {
      id: ID! @external
      name: String @external
      numberOfPosts: Int @requires(fields: "id name")
    }
  `

  const [userExtendService, userExtendServicePort] = await createTestService(
    t,
    userExtendSchema,
    {}
  )

  // user service
  const userServiceSchema = `    
    extend type Query {
      me: User
    }

    type User @key(fields: "id"){
      id: ID!
      name: String!
      fullName: String
      friends: [User]
    }
    `

  const [userService, userServicePort] = await createTestService(
    t,
    userServiceSchema,
    {}
  )

  const gateway = Fastify()
  t.after(async () => {
    await gateway.close()
    await userExtendService.close()
    await userService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'userExtend',
          url: `http://localhost:${userExtendServicePort}/graphql`
        },
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ]
    }
  })

  return gateway
}

test('should contain all the fields', async t => {
  const app = await createTestGatewayServer(t)

  const serviceMap = app.graphqlGateway.serviceMap

  t.assert.deepStrictEqual(Object.keys(serviceMap.user.schema._typeMap.User._fields), ['id', 'name', 'fullName', 'friends'])
  t.assert.deepStrictEqual(Object.keys(serviceMap.userExtend.schema._typeMap.User._fields), ['id', 'name', 'numberOfPosts'])
})
