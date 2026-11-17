'use strict'

const { test } = require('node:test')
const { GraphQLObjectType, GraphQLString, print } = require('graphql')
const { createEntityReferenceResolverOperation } = require('../lib/gateway/make-resolver')

const selections = [
  {
    kind: 'Field',
    name: { kind: 'Name', value: 'id' },
    arguments: [],
    directives: []
  }
]

const expected = `query EntitiesQuery($representations: [_Any!]!) {
  _entities(representations: $representations) {
    __typename
    ... on Post {
      id
    }
  }
}`

test('createEntityReferenceResolverOperation accepts a type name', (t) => {
  const operation = createEntityReferenceResolverOperation({
    returnType: 'Post',
    selections,
    variableDefinitions: []
  })

  t.assert.strictEqual(print(operation), expected)
})

test('createEntityReferenceResolverOperation accepts a GraphQLObjectType', (t) => {
  const returnType = new GraphQLObjectType({
    name: 'Post',
    fields: { id: { type: GraphQLString } }
  })

  const operation = createEntityReferenceResolverOperation({
    returnType,
    selections,
    variableDefinitions: []
  })

  t.assert.strictEqual(operation.definitions[0].selectionSet.selections[0].selectionSet.selections[1].typeCondition.name.value, 'Post')
  t.assert.strictEqual(print(operation), expected)
})
