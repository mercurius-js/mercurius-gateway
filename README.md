# @mercurius/gateway

A module to create aa Apollo Federation v1 gateway with `mercurius`.

## Quick start

```javascript
npm i fastify @mercuriusjs/federation @mercuriusjs/gateway
```

Create the `user` service
```js
'use strict'

const Fastify = require('fastify')
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')

const users = {
  1: {
    id: '1',
    name: 'John',
    username: '@john'
  },
  2: {
    id: '2',
    name: 'Jane',
    username: '@jane'
  }
}

const service = Fastify()
const schema = `
  extend type Query {
    me: User
  }

  type User @key(fields: "id") {
    id: ID!
    name: String
    username: String
  }
`

const resolvers = {
  Query: {
    me: () => {
      return users['1']
    }
  },
  User: {
    __resolveReference: (source, args, context, info) => {
      return users[source.id]
    }
  }
}

service.register(mercuriusFederationPlugin, {
  schema,
  resolvers
})

service.listen({ port: 4001 })
```

Create the `post` service
```js
'use strict'

const Fastify = require('fastify')
const { mercuriusFederationPlugin } = require('@mercuriusjs/federation')

const posts = {
  p1: {
    pid: 'p1',
    title: 'Post 1',
    content: 'Content 1',
    authorId: 'u1'
  },
  p2: {
    pid: 'p2',
    title: 'Post 2',
    content: 'Content 2',
    authorId: 'u2'
  }
}

const service = Fastify()
const schema = `
  extend type Query {
    topPosts(count: Int): [Post]
  }

  type Post @key(fields: "pid") {
    pid: ID!
    title: String
    content: String
    author: User @requires(fields: "pid title")
  }
`

const resolvers = {
  Query: {
    topPosts: (root, { count = 2 }) => Object.values(posts).slice(0, count)
  },
  Post: {
    __resolveReference: post => {
      return posts[post.pid]
    },
    author: post => {
      return {
        __typename: 'User',
        id: post.authorId
      }
    }
  }
}

service.register(mercuriusFederationPlugin, {
  schema,
  resolvers
})

service.listen({ port: 4002 })
```

Create the `gateway`
```js
'use strict'

const Fastify = require('fastify')
const mercuriusGateway = require('@mercuriusjs/gateway')

const gateway = Fastify()
gateway.register(mercuriusGateway, {
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

gateway.listen({ port: 3000 })
```

## API

### mercuriusGateway

Register the gateway in `fastify`.

```javascript
const mercuriusGateway = require('@mercurius/gateway')

const schema = ...
const resolvers = ...
const app = Fastify()

app.register(mercuriusGateway, {
  gateway: [
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
```

#### options
- all the mercurius plugin [options](https://mercurius.dev/#/docs/api/options?id=plugin-options)
- `gateway`: Object. Run the GraphQL server in gateway mode.

  - `gateway.services`: Service[] An array of GraphQL services that are part of the gateway
    - `service.name`: A unique name for the service. Required.
    - `service.url`: The URL of the service endpoint. It can also be an `Array` of URLs and in which case all the requests will be load balanced throughout the URLs. Required.
    - `service.mandatory`: `Boolean` Marks service as mandatory. If any of the mandatory services are unavailable, gateway will exit with an error. (Default: `false`)
    - `service.useSecureParse`: `Boolean` Marks if the service response needs to be parsed securely using [secure-json-parse](https://github.com/fastify/secure-json-parse). (Default: `false`)
    - `service.rewriteHeaders`: `Function` A function that gets the original headers as a parameter and returns an object containing values that should be added to the headers
    - `service.setResponseHeaders`: `Function` A function that gets `reply` as a parameter and can be used to set headers for the federated response to be sent to the client.
    - `service.initHeaders`: `Function` or `Object` An object or a function that returns the headers sent to the service for the initial \_service SDL query.
    - `service.connections`: The number of clients to create. (Default: `10`)
    - `service.agent`: An optional, fully configured [undici](https://github.com/nodejs/undici) agent/pool instance to use to perform network requests. If used, you must set all connections options on the instance as the request related options from the `service` configuration will not be applied.
    - `service.bodyTimeout`: The timeout after which a request will time out, in milliseconds. (Default: `30e3` - 30 seconds)
    - `service.headersTimeout`: The amount of time the parser will wait to receive the complete HTTP headers, in milliseconds. (Default: `30e3` - 30 seconds)
    - `service.keepAliveMaxTimeout`: The maximum allowed keepAliveTimeout. (Default: `5e3` - 5 seconds)
    - `service.maxHeaderSize`: The maximum length of request headers in bytes. (Default: `16384` - 16KiB)
    - `service.keepAlive`: The amount of time pass between the keep-alive messages sent from the gateway to the service, if `undefined`, no keep-alive messages will be sent. (Default: `undefined`)
    - `service.wsUrl`: The url of the websocket endpoint
    - `service.wsConnectionParams`: `Function` or `Object`
      - `wsConnectionParams.connectionInitPayload`: `Function` or `Object` An object or a function that returns the `connection_init` payload sent to the service.
      - `wsConnectionParams.reconnect`: `Boolean` Enable reconnect on connection close (Default: `false`)
      - `wsConnectionParams.maxReconnectAttempts`: `Number` Defines the maximum reconnect attempts if reconnect is enabled (Default: `Infinity`)
      - `wsConnectionParams.connectionCallback`: `Function` A function called after a `connection_ack` message is received.
      - `wsConnectionParams.failedConnectionCallback`: `Function` A function called after a `connection_error` message is received, the first argument contains the message payload.
      - `wsConnectionParams.failedReconnectCallback`: `Function` A function called if reconnect is enabled and maxReconnectAttempts is reached.
      - `wsConnectionParams.rewriteConnectionInitPayload`: `Function` A function that gets the original `connection_init` payload along with the context as a parameter and returns an object that replaces the original `connection_init` payload before forwarding it to the federated service
  - `gateway.retryServicesCount`: `Number` Specifies the maximum number of retries when a service fails to start on gateway initialization. (Default: 10)
  - `gateway.retryServicesInterval`: `Number` The amount of time(in milliseconds) between service retry attempts in case a service fails to start on gateway initialization. (Default: 3000)
