import { expect } from 'tstyche'
import Fastify, { FastifyInstance } from 'fastify'
import { MercuriusContext } from 'mercurius'

import mercuriusGatewayPlugin, { MercuriusServiceMetadata } from './index'
import { DocumentNode, GraphQLSchema } from 'graphql'
import { Agent } from 'undici'

const app = Fastify()

expect(() => {
  app.register(mercuriusGatewayPlugin, {})
}).type.toRaiseError()

app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        agent: new Agent(),
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        connections: 10,
        initHeaders: {
          authorization: 'bearer supersecret'
        },
        keepAliveMaxTimeout: 10000,
        mandatory: true,
        allowBatchedQueries: true,
        rejectUnauthorized: true,
        rewriteHeaders: (headers, context) => {
          expect(context).type.toBeAssignableTo<MercuriusContext>()
          return {
            authorization: headers.authorization
          }
        },
        wsUrl: 'ws://localhost:4001/graphql',
        wsConnectionParams: {
          connectionCallback: () => {},
          connectionInitPayload: {
            authorization: 'bearer supersecret'
          },
          failedConnectionCallback: (err) => {
            /* eslint-disable-next-line no-unused-expressions */
            err.message
          },
          failedReconnectCallback: () => {},
          maxReconnectAttempts: 10,
          reconnect: true,
          rewriteConnectionInitPayload: (payload, context) => {
            expect(context).type.toBeAssignableTo<MercuriusContext>()
            return {}
          }
        }
      },
      {
        name: 'post',
        url: 'http://localhost:4002/graphql',
        wsConnectionParams: async () => {
          return {
            connectionCallback: () => {},
            connectionInitPayload: {
              authorization: 'bearer supersecret'
            },
            failedConnectionCallback: (err) => {
              /* eslint-disable-next-line no-unused-expressions */
              err.message
            },
            failedReconnectCallback: () => {},
            maxReconnectAttempts: 10,
            reconnect: true,
            rewriteConnectionInitPayload: (payload, context) => {
              expect(context).type.toBeAssignableTo<MercuriusContext>()
              return {}
            }
          }
        }
      }
    ]
  }
})

// Async rewriteHeaders
app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        keepAlive: 3000,
        rewriteHeaders: async () => {
          const sessionId = await Promise.resolve('12')
          return {
            sessionId
          }
        }
      }
    ]
  }
})

// keepAlive value in service config
app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        keepAlive: 3000
      }
    ]
  }
})

// bodyTimeout value in service config
app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        bodyTimeout: 60000
      }
    ]
  }
})

// headersTimeout value in service config
app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        headersTimeout: 60000
      }
    ]
  }
})

// maxHeaderSize value in service config
app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        maxHeaderSize: 32768
      }
    ]
  }
})

app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        setResponseHeaders: (reply) => reply.header('abc', 'abc')
      }
    ]
  }
})

const servicesFn = async () => [
  {
    name: 'user',
    url: 'http://localhost:4001/graphql',
    schema: `
        type Query {
          dogs: [Dog]
        }`
  }
]

app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: servicesFn
  }
})

expect(() => app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        setResponseHeaders: false
      }
    ]
  }
})).type.toRaiseError()

expect(() => app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        keepAlive: true
      }
    ]
  }
})).type.toRaiseError()

expect(() => app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
        schema: `
        type Query {
          dogs: [Dog]
        }`,
        keepAlive: 'yes'
      }
    ]
  }
})).type.toRaiseError()

// Gateway mode with load balanced services
app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: ['http://localhost:4001/graphql', 'http://localhost:4002/graphql']
      },
      {
        name: 'post',
        url: 'http://localhost:4003/graphql'
      }
    ]
  }
})

// Gateway mode with custom services retry props
app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql'
      }
    ],
    retryServicesCount: 30,
    retryServicesInterval: 5000
  }
})

expect(() => app.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql'
      }
    ],
    retryServicesCount: '30',
    retryServicesInterval: '5000'
  }
})).type.toRaiseError()

app.graphqlGateway.addHook('preGatewayExecution', async function (schema, document, context) {
  expect(schema).type.toBeAssignableTo<GraphQLSchema>()
  expect(document).type.toBeAssignableTo<DocumentNode>()
  expect(context).type.toBeAssignableTo<MercuriusContext>()
  return {
    document,
    errors: [
      new Error('foo')
    ]
  }
})

app.graphqlGateway.addHook('preGatewayExecution', function (schema, document, context) {
  expect(schema).type.toBeAssignableTo<GraphQLSchema>()
  expect(document).type.toBeAssignableTo<DocumentNode>()
  expect(context).type.toBeAssignableTo<MercuriusContext>()
  return {
    document,
    errors: [
      new Error('foo')
    ]
  }
})

app.graphqlGateway.addHook('preGatewayExecution', function (schema, document, context) {
  expect(schema).type.toBeAssignableTo<GraphQLSchema>()
  expect(document).type.toBeAssignableTo<DocumentNode>()
  expect(context).type.toBeAssignableTo<MercuriusContext>()
})

app.graphqlGateway.addHook('preGatewaySubscriptionExecution', async function (schema, document, context) {
  expect(schema).type.toBeAssignableTo<GraphQLSchema>()
  expect(document).type.toBeAssignableTo<DocumentNode>()
  expect(context).type.toBeAssignableTo<MercuriusContext>()
})

app.graphqlGateway.addHook('preGatewaySubscriptionExecution', function (schema, document, context) {
  expect(schema).type.toBeAssignableTo<GraphQLSchema>()
  expect(document).type.toBeAssignableTo<DocumentNode>()
  expect(context).type.toBeAssignableTo<MercuriusContext>()
})

// Hooks containing service metadata
app.graphqlGateway.addHook('preGatewayExecution', async function (schema, document, context, service) {
  expect(schema).type.toBeAssignableTo<GraphQLSchema>()
  expect(document).type.toBeAssignableTo<DocumentNode>()
  expect(context).type.toBeAssignableTo<MercuriusContext>()
  expect(service).type.toBeAssignableTo<MercuriusServiceMetadata>()
})

app.graphqlGateway.addHook('preGatewaySubscriptionExecution', async function (schema, document, context, service) {
  expect(schema).type.toBeAssignableTo<GraphQLSchema>()
  expect(document).type.toBeAssignableTo<DocumentNode>()
  expect(context).type.toBeAssignableTo<MercuriusContext>()
  expect(service).type.toBeAssignableTo<MercuriusServiceMetadata>()
})

// GraphQL Application lifecycle hooks
app.graphqlGateway.addHook('onGatewayReplaceSchema', async function (instance, schema) {
  expect(instance).type.toBeAssignableTo<FastifyInstance>()
  expect(schema).type.toBeAssignableTo<GraphQLSchema>()
})

app.graphqlGateway.addHook('onGatewayReplaceSchema', function (instance, schema) {
  expect(instance).type.toBeAssignableTo<FastifyInstance>()
  expect(schema).type.toBeAssignableTo<GraphQLSchema>()
})
