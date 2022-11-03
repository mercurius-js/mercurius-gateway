'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../../index')
const { buildFederationSchema } = require('../../index')

async function createService(t, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port: 0 })

  return [service, service.server.address().port]
}

test('Should handle union with InlineFragment', async t => {
  const products = [
    {
      id: 1,
      type: 'Book',
      name: 'book1'
    },
    {
      id: 2,
      type: 'Book',
      name: 'book2'
    }
  ]

  const [productService, productServicePort] = await createService(
    t,
    `
    extend type Query {
      products: [Product]
      shelve: Shelve
    }
    enum ProductType {
      Book
    }
    union Product = Book
    type Shelve {
      id: ID!
      products: [Product]
    }
    type Book {
      id: ID!
      type: ProductType!
      name: String
    }
  `,
    {
      Product: {
        resolveType(value) {
          return value.type
        }
      },
      Query: {
        products: async () => {
          return products
        },
        shelve: async () => {
          return {
            id: 1,
            products
          }
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await productService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'product',
          url: `http://localhost:${productServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
  {
    shelve {
      ...ShelveInfos
    }
  }
  
  fragment ShelveInfos on Shelve {
    id
    products {
      ...on Book {
        id
        type
        name
      }
    }
  }
  `

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      shelve: {
        id: 1,
        products: [
          {
            id: 1,
            type: 'Book',
            name: 'book1'
          },
          {
            id: 2,
            type: 'Book',
            name: 'book2'
          }
        ]
      }
    }
  })
})

test('Gateway sends initHeaders with _service sdl query', async t => {
  t.plan(1)
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        hello: String
      }
    `),
    resolvers: {
      Query: {
        hello: async () => {
          return 'world'
        }
      }
    }
  })
  service.addHook('preHandler', async req => {
    t.equal(req.headers.authorization, 'ok')
    if (!req.headers.authorization) throw new Error('Unauthorized')
  })

  await service.listen({ port: 0 })

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await service.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'svc',
          url: `http://localhost:${service.server.address().port}/graphql`,
          initHeaders: {
            authorization: 'ok'
          }
        }
      ]
    }
  })

  await gateway.ready()
})

test('Gateway sends initHeaders function result with _service sdl query', async t => {
  t.plan(1)
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(`
      extend type Query {
        hello: String
      }
    `),
    resolvers: {
      Query: {
        hello: async () => {
          return 'world'
        }
      }
    }
  })
  service.addHook('preHandler', async req => {
    t.equal(req.headers.authorization, 'ok')
    if (!req.headers.authorization) throw new Error('Unauthorized')
  })

  await service.listen({ port: 0 })

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await service.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'svc',
          url: `http://localhost:${service.server.address().port}/graphql`,
          async initHeaders() {
            return {
              authorization: 'ok'
            }
          }
        }
      ]
    }
  })

  await gateway.ready()
})

test('Should handle interface', async t => {
  const products = [
    {
      id: 1,
      type: 'Book',
      name: 'book1'
    },
    {
      id: 2,
      type: 'Book',
      name: 'book2'
    }
  ]

  const [productService, productServicePort] = await createService(
    t,
    `
    extend type Query {
      products: [Product]
      shelve: Shelve
    }
    enum ProductType {
      Book
    }

    type Shelve {
      id: ID!
      products: [Product]
    }

    interface Product {
      id: ID!
      type: ProductType!
    }

    type Book implements Product {
      id: ID!
      type: ProductType!
      name: String
    }
  `,
    {
      Product: {
        resolveType(value) {
          return value.type
        }
      },
      Query: {
        products: async () => {
          return products
        },
        shelve: async () => {
          return {
            id: 1,
            products
          }
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await productService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'product',
          url: `http://localhost:${productServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
  {
    shelve {
      ...ShelveInfos
    }
  }

  fragment ShelveInfos on Shelve {
    id
    products {
      ...on Book {
        id
        type
        name
      }
    }
  }
  `

  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      shelve: {
        id: 1,
        products: [
          {
            id: 1,
            type: 'Book',
            name: 'book1'
          },
          {
            id: 2,
            type: 'Book',
            name: 'book2'
          }
        ]
      }
    }
  })
})

test('Should handle interface referenced multiple times in different services', async t => {
  const books = [
    {
      id: 1,
      type: 'Book',
      name: 'book1',
      author: 'toto'
    },
    {
      id: 2,
      type: 'Book',
      name: 'book2',
      author: 'titi'
    }
  ]

  const dictionaries = [
    {
      id: 1,
      type: 'Dictionary',
      name: 'Dictionary 1',
      editor: 'john'
    },
    {
      id: 2,
      type: 'Dictionary',
      name: 'Dictionary 2',
      editor: 'jim'
    }
  ]

  const [bookService, bookServicePort] = await createService(
    t,
    `
    extend type Query {
      books: [Book]
    }
    enum ProductType {
      Dictionary
      Book
    }

    interface Product {
      id: ID!
      type: ProductType!
    }

    type Book implements Product @key(fields: "id") {
      id: ID!
      type: ProductType!
      name: String!
      author: String!
    }
  `,
    {
      Product: {
        resolveType(value) {
          return value.type
        }
      },
      Query: {
        books: async () => {
          return books
        }
      }
    }
  )
  const [dictionariesService, dictionariesServicePort] = await createService(
    t,
    `
    extend type Query {
      dictionaries: [Dictionary]
    }
    enum ProductType {
      Dictionary
      Book
    }

    interface Product {
      id: ID!
      type: ProductType!
    }

    type Dictionary implements Product @key(fields: "id") {
      id: ID!
      type: ProductType!
      name: String!
      editor: String!
    }
  `,
    {
      Product: {
        resolveType(value) {
          return value.type
        }
      },
      Query: {
        dictionaries: async () => {
          return dictionaries
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await dictionariesService.close()
    await bookService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'book',
          url: `http://localhost:${bookServicePort}/graphql`
        },
        {
          name: 'dictionaries',
          url: `http://localhost:${dictionariesServicePort}/graphql`
        }
      ]
    }
  })

  const query1 = `
  {
    books {
      id
      type
      ... on Book {
        name
        author
      }
    }
  }
  `
  const res1 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query: query1 })
  })

  t.same(JSON.parse(res1.body), {
    data: {
      books: [
        {
          id: 1,
          type: 'Book',
          name: 'book1',
          author: 'toto'
        },
        {
          id: 2,
          type: 'Book',
          name: 'book2',
          author: 'titi'
        }
      ]
    }
  })

  const query2 = `
  {
    dictionaries {
      id
      type
      ... on Dictionary {
        name
        editor
      }
    }
  }
  `

  const res2 = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query: query2 })
  })

  t.same(JSON.parse(res2.body), {
    data: {
      dictionaries: [
        {
          id: 1,
          type: 'Dictionary',
          name: 'Dictionary 1',
          editor: 'john'
        },
        {
          id: 2,
          type: 'Dictionary',
          name: 'Dictionary 2',
          editor: 'jim'
        }
      ]
    }
  })
})

test('Should handle complex and nested interfaces with external types', async t => {
  const users = [
    {
      id: 1,
      name: 'toto'
    },
    {
      id: 2,
      name: 'titi'
    }
  ]

  const configsAB = [
    {
      id: 10,
      userId: 1,
      nestedInterface: {
        type: 'ConfigB',
        property: 'hello'
      }
    },
    {
      id: 11,
      userId: 2,
      nestedInterface: {
        type: 'ConfigB',
        property: 'world'
      }
    },
    {
      id: 12,
      userId: 1,
      nestedInterface: {
        type: 'ConfigA',
        arrayProperty: ['hellow', 'world']
      }
    },
    {
      id: 13,
      userId: 2,
      nestedInterface: {
        type: 'ConfigA',
        arrayProperty: ['world', 'hello']
      }
    }
  ]

  const configsC = [
    {
      id: 20,
      userId: 1,
      nestedInterface: {
        type: 'ConfigC',
        integerValue: 101
      }
    },
    {
      id: 21,
      userId: 2,
      nestedInterface: {
        type: 'ConfigC',
        integerValue: 420
      }
    }
  ]

  const configInterface = `
    interface ConfigInterface {
      type: EConfig!
    }
    enum EConfig {
      ConfigA
      ConfigB
      ConfigC
    }
  `

  const [userService, userServicePort] = await createService(
    t,
    `
    type User @key(fields: "id") {
      id: ID!
      name: String!
    }

    extend type Query {
      users: [User]!
    }
  `,
    {
      User: {
        __resolveReference: root => {
          return users.find(u => u.id === root.id)
        }
      },
      Query: {
        users: async () => {
          return users
        }
      }
    }
  )
  const [configABService, configABServicePort] = await createService(
    t,
    `
    ${configInterface}
    type ConfigA implements ConfigInterface {
      type: EConfig!
      arrayProperty: [String]
    }
    type ConfigB implements ConfigInterface {
      type: EConfig!
      property: String
    }
    type ServiceConfigAB @key(fields: "id") {
      id: ID!
      nestedInterface: ConfigInterface!
    }

    extend type Query {
      configsA: [ConfigA]
      configsB: [ConfigB]
    }

    extend type User @key(fields: "id") {
      id: ID! @external
      configABs: [ServiceConfigAB]!
    }
  `,
    {
      ConfigInterface: {
        resolveType(value) {
          return value.type
        }
      },
      User: {
        configABs: async root => {
          return configsAB.filter(c => c.userId === Number(root.id))
        }
      },
      Query: {
        configsA: async () => {
          return configsAB
        },
        configsB: async () => {
          return configsAB
        }
      }
    }
  )
  const [configCService, configCServicePort] = await createService(
    t,
    `
    ${configInterface}
    type ConfigC implements ConfigInterface {
      type: EConfig!
      integerValue: Int
    }
    type ServiceConfigC @key(fields: "id") {
      id: ID!
      nestedInterface: ConfigInterface!
    }

    extend type Query {
      configsC: [ConfigC]!
    }

    extend type User @key(fields: "id") {
      id: ID! @external
      configCs: [ServiceConfigC]!
    }
  `,
    {
      ServiceConfigC: {
        __resolveReference(root) {
          return configsC.find(c => c.id === root.id)
        }
      },
      ConfigInterface: {
        resolveType(value) {
          return value.type
        }
      },
      User: {
        configCs: async root => {
          return configsC.filter(c => c.userId === Number(root.id))
        }
      },
      Query: {
        configsC: async () => {
          return configsC
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await configCService.close()
    await configABService.close()
    await userService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        },
        {
          name: 'configAB',
          url: `http://localhost:${configABServicePort}/graphql`
        },
        {
          name: 'configC',
          url: `http://localhost:${configCServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
  {
    users {
      id
      name
      configABs {
        id
        nestedInterface {
          type
          ... on ConfigA {
            arrayProperty
          }
          ... on ConfigB {
            property
          }
        }
      }
      configCs {
        id
        nestedInterface {
          type
          ... on ConfigC {
            integerValue
          }
        }
      }
    }
  }
  `
  const res = await gateway.inject({
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    url: '/graphql',
    body: JSON.stringify({ query })
  })

  t.same(JSON.parse(res.body), {
    data: {
      users: [
        {
          id: '1',
          name: 'toto',
          configABs: [
            {
              id: '10',
              nestedInterface: {
                type: 'ConfigB',
                property: 'hello'
              }
            },
            {
              id: '12',
              nestedInterface: {
                type: 'ConfigA',
                arrayProperty: ['hellow', 'world']
              }
            }
          ],
          configCs: [
            {
              id: '20',
              nestedInterface: {
                type: 'ConfigC',
                integerValue: 101
              }
            }
          ]
        },
        {
          id: '2',
          name: 'titi',
          configABs: [
            {
              id: '11',
              nestedInterface: {
                type: 'ConfigB',
                property: 'world'
              }
            },
            {
              id: '13',
              nestedInterface: {
                type: 'ConfigA',
                arrayProperty: ['world', 'hello']
              }
            }
          ],
          configCs: [
            {
              id: '21',
              nestedInterface: {
                type: 'ConfigC',
                integerValue: 420
              }
            }
          ]
        }
      ]
    }
  })
})
