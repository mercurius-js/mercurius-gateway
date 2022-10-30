# federation-support

A module to use the federation feature in `mercurius`.

This module extract the federation parts from `mercurius` to be used as external plugin.

## Quick start

```js
'use strict'

const Fastify = require('fastify')
const mercurius = require('mercurius')
const { createGateway, buildFederationSchema } = require('/index')

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

const app = Fastify()
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

app.register(mercurius, {
  schema: buildFederationSchema(schema),
  resolvers
})

app.get('/', async function (req, reply) {
  const query = '{ _service { sdl } }'
  return app.graphql(query)
})

app.listen({ port: 3000 })
```

### Use GraphQL server as a Gateway for federated schemas

A GraphQL server can act as a Gateway that composes the schemas of the underlying services into one federated schema and executes queries across the services. Every underlying service must be a GraphQL server that [supports the federation](https://www.apollographql.com/docs/federation/supported-subgraphs/).

```js
const gateway = Fastify()
const mercurius = require('mercurius')
const { createGateway } = require('./index')

async function initApp() {
 const { schema } = await createGateway({
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
    gateway
  )
  
  gateway.register(mercurius, {
    schema
  })

  await gateway.listen({ port: 4000 })
}
 
initApp()
```

Check the `mercurius` [docs](https://github.com/mercurius-js/mercurius/blob/master/docs/federation.md) for further information.

## Differences from the integrated version.

### Federated node

```javascript
const schema = '
  type Query {
    me: User
  }
  ...
'

// mercurius integrated version
app.register(mercurius, {
  schema,
  resolvers,
  federationMetadata: true
})

// federation as plugin
app.register(mercurius, {
  schema: buildFederationSchema(schema),
  resolvers
})
```

### Gateway

```javascript
const gatewayConfig = {
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
  
// mercurius integrated version
const { schema } = await createGateway(,
  gatewayConfig
  gateway
)
gateway.register(mercurius, {
  schema
})
  
// gateway as plugin
gateway.register(mercurius, {
  gateway: gatewayConfig
})
```


