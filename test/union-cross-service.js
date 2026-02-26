'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createService (t, schema, resolvers = {}) {
  const service = Fastify()
  service.register(GQL, {
    schema: buildFederationSchema(schema),
    resolvers
  })
  await service.listen({ port: 0 })
  return [service, service.server.address().port]
}

const articles = {
  a1: { id: 'a1', title: 'GraphQL Federation Guide' },
  a2: { id: 'a2', title: 'Fastify Performance Tips' }
}

const reviews = {
  r1: { id: 'r1', rating: 5, body: 'Excellent!' },
  r2: { id: 'r2', rating: 3, body: 'Average' }
}

const users = {
  u1: { id: 'u1', name: 'Alice' },
  u2: { id: 'u2', name: 'Bob' }
}

test('gateway resolves union type with entity members defined on separate services', async t => {
  t.plan(2)

  // Article service - owns the Article entity
  const [articleService, articleServicePort] = await createService(
    t,
    `
    type Article @key(fields: "id") {
      id: ID!
      title: String!
    }
    `,
    {
      Article: {
        __resolveReference (article) {
          return { __typename: 'Article', ...articles[article.id] }
        }
      }
    }
  )

  // Review service - owns the Review entity
  const [reviewService, reviewServicePort] = await createService(
    t,
    `
    type Review @key(fields: "id") {
      id: ID!
      rating: Int!
      body: String!
    }
    `,
    {
      Review: {
        __resolveReference (review) {
          return { __typename: 'Review', ...reviews[review.id] }
        }
      }
    }
  )

  // Search service - defines the query and union, but Article/Review are stubs
  const [searchService, searchServicePort] = await createService(
    t,
    `
    extend type Query {
      search: [SearchResult]
    }

    union SearchResult = Article | Review

    extend type Article {
      id: ID! @external
    }

    extend type Review {
      id: ID! @external
    }
    `,
    {
      Query: {
        search: () => {
          return [
            { __typename: 'Article', id: 'a1' },
            { __typename: 'Review', id: 'r1' },
            { __typename: 'Article', id: 'a2' },
            { __typename: 'Review', id: 'r2' }
          ]
        }
      },
      SearchResult: {
        resolveType (obj) {
          return obj.__typename
        }
      }
    }
  )

  // User service - extends both entities with user fields
  const [userService, userServicePort] = await createService(
    t,
    `
    type User @key(fields: "id") {
      id: ID!
      name: String!
    }

    extend type Article @key(fields: "id") {
      id: ID! @external
      author: User
    }

    extend  type Review @key(fields: "id") {
      id: ID! @external
      reviewer: User
    }
    `,
    {
      User: {
        __resolveReference (user) {
          return users[user.id]
        }
      },
      Article: {
        author (article) {
          return article.id === 'a1' ? users.u1 : users.u2
        }
      },
      Review: {
        reviewer (review) {
          return review.id === 'r1' ? users.u2 : users.u1
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await articleService.close()
    await reviewService.close()
    await searchService.close()
    await userService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'article',
          url: `http://localhost:${articleServicePort}/graphql`
        },
        {
          name: 'review',
          url: `http://localhost:${reviewServicePort}/graphql`
        },
        {
          name: 'search',
          url: `http://localhost:${searchServicePort}/graphql`
        },
        {
          name: 'user',
          url: `http://localhost:${userServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
    query {
      search {
        __typename
        ...ArticleFields
        ...ReviewFields
      }
    }

    fragment ArticleFields on Article {
      id
      title
      author {
        id
        name
      }
    }

    fragment ReviewFields on Review {
      id
      rating
      body
      reviewer {
        id
        name
      }
    }
  `

  const expected = {
    data: {
      search: [
        {
          __typename: 'Article',
          id: 'a1',
          title: 'GraphQL Federation Guide',
          author: {
            id: 'u1',
            name: 'Alice'
          }
        },
        {
          __typename: 'Review',
          id: 'r1',
          rating: 5,
          body: 'Excellent!',
          reviewer: {
            id: 'u2',
            name: 'Bob'
          }
        },
        {
          __typename: 'Article',
          id: 'a2',
          title: 'Fastify Performance Tips',
          author: {
            id: 'u2',
            name: 'Bob'
          }
        },
        {
          __typename: 'Review',
          id: 'r2',
          rating: 3,
          body: 'Average',
          reviewer: {
            id: 'u1',
            name: 'Alice'
          }
        }
      ]
    }
  }

  // Not cached
  {
    const res = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.same(JSON.parse(res.body), expected)
  }

  // Cached
  {
    const res = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.same(JSON.parse(res.body), expected)
  }
})

test('gateway resolves union type using inline fragments', async t => {
  t.plan(1)

  const [articleService, articleServicePort] = await createService(
    t,
    `
    type Article @key(fields: "id") {
      id: ID!
      title: String!
    }
    `,
    {
      Article: {
        __resolveReference (article) {
          return { __typename: 'Article', ...articles[article.id] }
        }
      }
    }
  )

  const [reviewService, reviewServicePort] = await createService(
    t,
    `
    type Review @key(fields: "id") {
      id: ID!
      rating: Int!
      body: String!
    }
    `,
    {
      Review: {
        __resolveReference (review) {
          return { __typename: 'Review', ...reviews[review.id] }
        }
      }
    }
  )

  const [searchService, searchServicePort] = await createService(
    t,
    `
    extend type Query {
      search: [SearchResult]
    }

    union SearchResult = Article | Review

    extend type Article {
      id: ID! @external
    }

    extend type Review {
      id: ID! @external
    }
    `,
    {
      Query: {
        search: () => {
          return [
            { __typename: 'Article', id: 'a1' },
            { __typename: 'Review', id: 'r1' }
          ]
        }
      },
      SearchResult: {
        resolveType (obj) {
          return obj.__typename
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await articleService.close()
    await reviewService.close()
    await searchService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'article',
          url: `http://localhost:${articleServicePort}/graphql`
        },
        {
          name: 'review',
          url: `http://localhost:${reviewServicePort}/graphql`
        },
        {
          name: 'search',
          url: `http://localhost:${searchServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
    query {
      search {
        __typename
        ... on Article {
          id
          title
        }
        ... on Review {
          id
          rating
          body
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
      search: [
        {
          __typename: 'Article',
          id: 'a1',
          title: 'GraphQL Federation Guide'
        },
        {
          __typename: 'Review',
          id: 'r1',
          rating: 5,
          body: 'Excellent!'
        }
      ]
    }
  })
})

test('gateway resolves nested union array fields from different services', async t => {
  t.plan(2)

  const products = {
    p1: { id: 'p1', name: 'Widget', price: 9.99 },
    p2: { id: 'p2', name: 'Gadget', price: 24.99 }
  }

  const digitalProducts = {
    d1: { id: 'd1', title: 'E-Book', downloadUrl: 'https://example.com/ebook' }
  }

  const [productService, productServicePort] = await createService(
    t,
    `
    type Product @key(fields: "id") {
      id: ID!
      name: String!
      price: Float!
    }
    `,
    {
      Product: {
        __resolveReference (product) {
          return { __typename: 'Product', ...products[product.id] }
        }
      }
    }
  )

  const [digitalService, digitalServicePort] = await createService(
    t,
    `
    type DigitalProduct @key(fields: "id") {
      id: ID!
      title: String!
      downloadUrl: String!
    }
    `,
    {
      DigitalProduct: {
        __resolveReference (product) {
          return { __typename: 'DigitalProduct', ...digitalProducts[product.id] }
        }
      }
    }
  )

  const [storeService, storeServicePort] = await createService(
    t,
    `
    extend type Query {
      orders: [Order]
    }

    type Order {
      id: ID!
      items: [Purchasable]
    }

    union Purchasable = Product | DigitalProduct

    extend type Product {
      id: ID! @external
    }

    extend type DigitalProduct {
      id: ID! @external
    }
    `,
    {
      Query: {
        orders: () => [
          {
            id: '1',
            items: [
              { __typename: 'Product', id: 'p1' },
              { __typename: 'DigitalProduct', id: 'd1' },
              { __typename: 'Product', id: 'p2' }
            ]
          }
        ]
      },
      Purchasable: {
        resolveType (obj) {
          return obj.__typename
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await productService.close()
    await digitalService.close()
    await storeService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'product',
          url: `http://localhost:${productServicePort}/graphql`
        },
        {
          name: 'digital',
          url: `http://localhost:${digitalServicePort}/graphql`
        },
        {
          name: 'store',
          url: `http://localhost:${storeServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
    query {
      orders {
        id
        items {
          ... on Product {
            id
            name
            price
          }
          ... on DigitalProduct {
            id
            title
            downloadUrl
          }
        }
      }
    }
  `

  const expected = {
    data: {
      orders: [
        {
          id: '1',
          items: [
            {
              id: 'p1',
              name: 'Widget',
              price: 9.99
            },
            {
              id: 'd1',
              title: 'E-Book',
              downloadUrl: 'https://example.com/ebook'
            },
            {
              id: 'p2',
              name: 'Gadget',
              price: 24.99
            }
          ]
        }
      ]
    }
  }

  // Not cached
  {
    const res = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.same(JSON.parse(res.body), expected)
  }

  // Cached
  {
    const res = await gateway.inject({
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      url: '/graphql',
      body: JSON.stringify({ query })
    })

    t.same(JSON.parse(res.body), expected)
  }
})

test('gateway resolves nested union fields inside inline fragments', async t => {
  t.plan(1)

  const products = {
    p1: { id: 'p1', name: 'Widget', price: 9.99 }
  }

  const digitalProducts = {
    d1: { id: 'd1', title: 'E-Book', downloadUrl: 'https://example.com/ebook' }
  }

  const [productService, productServicePort] = await createService(
    t,
    `
    type Product @key(fields: "id") {
      id: ID!
      name: String!
      price: Float!
    }
    `,
    {
      Product: {
        __resolveReference (product) {
          return { __typename: 'Product', ...products[product.id] }
        }
      }
    }
  )

  const [digitalService, digitalServicePort] = await createService(
    t,
    `
    type DigitalProduct @key(fields: "id") {
      id: ID!
      title: String!
      downloadUrl: String!
    }
    `,
    {
      DigitalProduct: {
        __resolveReference (product) {
          return { __typename: 'DigitalProduct', ...digitalProducts[product.id] }
        }
      }
    }
  )

  const [storeService, storeServicePort] = await createService(
    t,
    `
    extend type Query {
      catalog: [CatalogEntry]
    }

    union CatalogEntry = Order | Coupon

    type Order {
      id: ID!
      item: Purchasable
    }

    type Coupon {
      id: ID!
      code: String!
    }

    union Purchasable = Product | DigitalProduct

    extend type Product {
      id: ID! @external
    }

    extend type DigitalProduct {
      id: ID! @external
    }
    `,
    {
      Query: {
        catalog: () => [
          { __typename: 'Order', id: '1', item: { __typename: 'Product', id: 'p1' } },
          { __typename: 'Coupon', id: '2', code: 'SAVE20' },
          { __typename: 'Order', id: '3', item: { __typename: 'DigitalProduct', id: 'd1' } }
        ]
      },
      CatalogEntry: {
        resolveType (obj) {
          return obj.__typename
        }
      },
      Purchasable: {
        resolveType (obj) {
          return obj.__typename
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await productService.close()
    await digitalService.close()
    await storeService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'product',
          url: `http://localhost:${productServicePort}/graphql`
        },
        {
          name: 'digital',
          url: `http://localhost:${digitalServicePort}/graphql`
        },
        {
          name: 'store',
          url: `http://localhost:${storeServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
    query {
      catalog {
        ... on Order {
          id
          item {
            ... on Product {
              id
              name
              price
            }
            ... on DigitalProduct {
              id
              title
              downloadUrl
            }
          }
        }
        ... on Coupon {
          id
          code
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
      catalog: [
        {
          id: '1',
          item: {
            id: 'p1',
            name: 'Widget',
            price: 9.99
          }
        },
        {
          id: '2',
          code: 'SAVE20'
        },
        {
          id: '3',
          item: {
            id: 'd1',
            title: 'E-Book',
            downloadUrl: 'https://example.com/ebook'
          }
        }
      ]
    }
  })
})

test('gateway skips entity resolution for nested union when all fields already present', async t => {
  t.plan(1)

  const [productService, productServicePort] = await createService(
    t,
    `
    type Product @key(fields: "id") {
      id: ID!
      name: String!
    }
    `,
    {
      Product: {
        __resolveReference (product) {
          return { __typename: 'Product', ...product }
        }
      }
    }
  )

  const [digitalService, digitalServicePort] = await createService(
    t,
    `
    type DigitalProduct @key(fields: "id") {
      id: ID!
      title: String!
    }
    `,
    {
      DigitalProduct: {
        __resolveReference (product) {
          return { __typename: 'DigitalProduct', ...product }
        }
      }
    }
  )

  const [storeService, storeServicePort] = await createService(
    t,
    `
    extend type Query {
      orders: [Order]
    }

    type Order {
      id: ID!
      items: [Purchasable]
    }

    union Purchasable = Product | DigitalProduct

    extend type Product {
      id: ID! @external
    }

    extend type DigitalProduct {
      id: ID! @external
    }
    `,
    {
      Query: {
        orders: () => [
          {
            id: '1',
            items: [
              { __typename: 'Product', id: 'p1' },
              { __typename: 'DigitalProduct', id: 'd1' }
            ]
          }
        ]
      },
      Purchasable: {
        resolveType (obj) {
          return obj.__typename
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await productService.close()
    await digitalService.close()
    await storeService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'product',
          url: `http://localhost:${productServicePort}/graphql`
        },
        {
          name: 'digital',
          url: `http://localhost:${digitalServicePort}/graphql`
        },
        {
          name: 'store',
          url: `http://localhost:${storeServicePort}/graphql`
        }
      ]
    }
  })

  // Only request 'id' which is already in the @key representation
  const query = `
    query {
      orders {
        id
        items {
          ... on Product {
            id
          }
          ... on DigitalProduct {
            id
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
      orders: [
        {
          id: '1',
          items: [
            { id: 'p1' },
            { id: 'd1' }
          ]
        }
      ]
    }
  })
})

test('gateway handles null items in nested union arrays', async t => {
  t.plan(1)

  const products = {
    p1: { id: 'p1', name: 'Widget', price: 9.99 }
  }

  const [productService, productServicePort] = await createService(
    t,
    `
    type Product @key(fields: "id") {
      id: ID!
      name: String!
      price: Float!
    }
    `,
    {
      Product: {
        __resolveReference (product) {
          return { __typename: 'Product', ...products[product.id] }
        }
      }
    }
  )

  const [digitalService, digitalServicePort] = await createService(
    t,
    `
    type DigitalProduct @key(fields: "id") {
      id: ID!
      title: String!
      downloadUrl: String!
    }
    `,
    {
      DigitalProduct: {
        __resolveReference () {
          return null
        }
      }
    }
  )

  const [storeService, storeServicePort] = await createService(
    t,
    `
    extend type Query {
      orders: [Order]
    }

    type Order {
      id: ID!
      items: [Purchasable]
    }

    union Purchasable = Product | DigitalProduct

    extend type Product {
      id: ID! @external
    }

    extend type DigitalProduct {
      id: ID! @external
    }
    `,
    {
      Query: {
        orders: () => [
          {
            id: '1',
            items: [
              { __typename: 'Product', id: 'p1' },
              null,
              { __typename: 'Product', id: 'p1' }
            ]
          }
        ]
      },
      Purchasable: {
        resolveType (obj) {
          return obj.__typename
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await productService.close()
    await digitalService.close()
    await storeService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'product',
          url: `http://localhost:${productServicePort}/graphql`
        },
        {
          name: 'digital',
          url: `http://localhost:${digitalServicePort}/graphql`
        },
        {
          name: 'store',
          url: `http://localhost:${storeServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
    query {
      orders {
        id
        items {
          ... on Product {
            id
            name
            price
          }
          ... on DigitalProduct {
            id
            title
            downloadUrl
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
      orders: [
        {
          id: '1',
          items: [
            {
              id: 'p1',
              name: 'Widget',
              price: 9.99
            },
            null,
            {
              id: 'p1',
              name: 'Widget',
              price: 9.99
            }
          ]
        }
      ]
    }
  })
})

test('gateway handles null entity from resolver in top-level union', async t => {
  t.plan(1)

  const [articleService, articleServicePort] = await createService(
    t,
    `
    type Article @key(fields: "id") {
      id: ID!
      title: String!
    }
    `,
    {
      Article: {
        __resolveReference (article) {
          if (article.id === 'a_missing') return null
          return { __typename: 'Article', ...articles[article.id] }
        }
      }
    }
  )

  const [reviewService, reviewServicePort] = await createService(
    t,
    `
    type Review @key(fields: "id") {
      id: ID!
      rating: Int!
      body: String!
    }
    `,
    {
      Review: {
        __resolveReference (review) {
          return { __typename: 'Review', ...reviews[review.id] }
        }
      }
    }
  )

  const [searchService, searchServicePort] = await createService(
    t,
    `
    extend type Query {
      search: [SearchResult]
    }

    union SearchResult = Article | Review

    extend type Article {
      id: ID! @external
    }

    extend type Review {
      id: ID! @external
    }
    `,
    {
      Query: {
        search: () => {
          return [
            { __typename: 'Article', id: 'a1' },
            { __typename: 'Article', id: 'a_missing' },
            { __typename: 'Review', id: 'r1' }
          ]
        }
      },
      SearchResult: {
        resolveType (obj) {
          return obj.__typename
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await articleService.close()
    await reviewService.close()
    await searchService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'article',
          url: `http://localhost:${articleServicePort}/graphql`
        },
        {
          name: 'review',
          url: `http://localhost:${reviewServicePort}/graphql`
        },
        {
          name: 'search',
          url: `http://localhost:${searchServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
    query {
      search {
        __typename
        ... on Article {
          id
          title
        }
        ... on Review {
          id
          rating
          body
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
      search: [
        {
          __typename: 'Article',
          id: 'a1',
          title: 'GraphQL Federation Guide'
        },
        null,
        {
          __typename: 'Review',
          id: 'r1',
          rating: 5,
          body: 'Excellent!'
        }
      ]
    }
  })
})

test('gateway handles null entity from resolver in nested union', async t => {
  t.plan(1)

  const products = {
    p1: { id: 'p1', name: 'Widget', price: 9.99 }
  }

  const [productService, productServicePort] = await createService(
    t,
    `
    type Product @key(fields: "id") {
      id: ID!
      name: String!
      price: Float!
    }
    `,
    {
      Product: {
        __resolveReference (product) {
          return { __typename: 'Product', ...products[product.id] }
        }
      }
    }
  )

  const [digitalService, digitalServicePort] = await createService(
    t,
    `
    type DigitalProduct @key(fields: "id") {
      id: ID!
      title: String!
      downloadUrl: String!
    }
    `,
    {
      DigitalProduct: {
        __resolveReference (product) {
          if (product.id === 'd_missing') return null
          return { __typename: 'DigitalProduct', id: product.id, title: 'E-Book', downloadUrl: 'https://example.com/ebook' }
        }
      }
    }
  )

  const [storeService, storeServicePort] = await createService(
    t,
    `
    extend type Query {
      orders: [Order]
    }

    type Order {
      id: ID!
      items: [Purchasable]
    }

    union Purchasable = Product | DigitalProduct

    extend type Product {
      id: ID! @external
    }

    extend type DigitalProduct {
      id: ID! @external
    }
    `,
    {
      Query: {
        orders: () => [
          {
            id: '1',
            items: [
              { __typename: 'Product', id: 'p1' },
              { __typename: 'DigitalProduct', id: 'd_missing' }
            ]
          }
        ]
      },
      Purchasable: {
        resolveType (obj) {
          return obj.__typename
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await productService.close()
    await digitalService.close()
    await storeService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'product',
          url: `http://localhost:${productServicePort}/graphql`
        },
        {
          name: 'digital',
          url: `http://localhost:${digitalServicePort}/graphql`
        },
        {
          name: 'store',
          url: `http://localhost:${storeServicePort}/graphql`
        }
      ]
    }
  })

  const query = `
    query {
      orders {
        id
        items {
          ... on Product {
            id
            name
            price
          }
          ... on DigitalProduct {
            id
            title
            downloadUrl
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
      orders: [
        {
          id: '1',
          items: [
            {
              id: 'p1',
              name: 'Widget',
              price: 9.99
            },
            null
          ]
        }
      ]
    }
  })
})

test('gateway resolves nested union inside inline fragments with non-matching fragment first', async t => {
  t.plan(1)

  const products = {
    p1: { id: 'p1', name: 'Widget', price: 9.99 }
  }

  const digitalProducts = {
    d1: { id: 'd1', title: 'E-Book', downloadUrl: 'https://example.com/ebook' }
  }

  const [productService, productServicePort] = await createService(
    t,
    `
    type Product @key(fields: "id") {
      id: ID!
      name: String!
      price: Float!
    }
    `,
    {
      Product: {
        __resolveReference (product) {
          return { __typename: 'Product', ...products[product.id] }
        }
      }
    }
  )

  const [digitalService, digitalServicePort] = await createService(
    t,
    `
    type DigitalProduct @key(fields: "id") {
      id: ID!
      title: String!
      downloadUrl: String!
    }
    `,
    {
      DigitalProduct: {
        __resolveReference (product) {
          return { __typename: 'DigitalProduct', ...digitalProducts[product.id] }
        }
      }
    }
  )

  const [storeService, storeServicePort] = await createService(
    t,
    `
    extend type Query {
      catalog: [CatalogEntry]
    }

    union CatalogEntry = Order | Coupon

    type Order {
      id: ID!
      item: Purchasable
    }

    type Coupon {
      id: ID!
      code: String!
    }

    union Purchasable = Product | DigitalProduct

    extend type Product {
      id: ID! @external
    }

    extend type DigitalProduct {
      id: ID! @external
    }
    `,
    {
      Query: {
        catalog: () => [
          { __typename: 'Order', id: '1', item: { __typename: 'Product', id: 'p1' } },
          { __typename: 'Coupon', id: '2', code: 'SAVE20' },
          { __typename: 'Order', id: '3', item: { __typename: 'DigitalProduct', id: 'd1' } },
          { __typename: 'Order', id: '4', item: null }
        ]
      },
      CatalogEntry: {
        resolveType (obj) {
          return obj.__typename
        }
      },
      Purchasable: {
        resolveType (obj) {
          return obj.__typename
        }
      }
    }
  )

  const gateway = Fastify()
  t.teardown(async () => {
    await gateway.close()
    await productService.close()
    await digitalService.close()
    await storeService.close()
  })

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'product',
          url: `http://localhost:${productServicePort}/graphql`
        },
        {
          name: 'digital',
          url: `http://localhost:${digitalServicePort}/graphql`
        },
        {
          name: 'store',
          url: `http://localhost:${storeServicePort}/graphql`
        }
      ]
    }
  })

  // Coupon fragment placed BEFORE Order fragment intentionally
  // to exercise the code path where an inline fragment is checked
  // but does not contain the nested union field
  const query = `
    query {
      catalog {
        ... on Coupon {
          id
          code
        }
        ... on Order {
          id
          item {
            ... on Product {
              id
              name
              price
            }
            ... on DigitalProduct {
              id
              title
              downloadUrl
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
      catalog: [
        {
          id: '1',
          item: {
            id: 'p1',
            name: 'Widget',
            price: 9.99
          }
        },
        {
          id: '2',
          code: 'SAVE20'
        },
        {
          id: '3',
          item: {
            id: 'd1',
            title: 'E-Book',
            downloadUrl: 'https://example.com/ebook'
          }
        },
        {
          id: '4',
          item: null
        }
      ]
    }
  })
})
