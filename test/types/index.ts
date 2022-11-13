import { expectAssignable, expectError } from 'tsd'
import Fastify from 'fastify'
import { MercuriusContext } from 'mercurius'

import mercuriusGatewayPlugin from '../../index'

const gateway = Fastify()

expectError(() => {
  gateway.register(mercuriusGatewayPlugin, {})
})

gateway.register(mercuriusGatewayPlugin, {
  gateway: {
    services: [
      {
        name: 'user',
        url: 'http://localhost:4001/graphql',
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
        rejectUnauthorized: true,
        rewriteHeaders: (headers, context) => {
          expectAssignable<MercuriusContext>(context)
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
            expectAssignable<MercuriusContext>(context)
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
              expectAssignable<MercuriusContext>(context)
              return {}
            }
          }
        }
      }
    ]
  }
})

// Async rewriteHeaders
gateway.register(mercuriusGatewayPlugin, {
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
gateway.register(mercuriusGatewayPlugin, {
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

gateway.register(mercuriusGatewayPlugin, {
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

expectError(() => gateway.register(mercuriusGatewayPlugin, {
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
}))

expectError(() => gateway.register(mercuriusGatewayPlugin, {
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
}))

expectError(() => gateway.register(mercuriusGatewayPlugin, {
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
}))

// Gateway mode with load balanced services
gateway.register(mercuriusGatewayPlugin, {
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
gateway.register(mercuriusGatewayPlugin, {
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

expectError(() => gateway.register(mercuriusGatewayPlugin, {
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
}))
