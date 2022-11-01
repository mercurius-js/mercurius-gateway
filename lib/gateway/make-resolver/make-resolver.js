'use strict'

const { print } = require('graphql')

const {
  getCached,
  getReferences,
  collectArgumentsWithVariableValues,
  collectFragmentsToInclude,
  collectServiceTypeFields,
  getFragmentNamesInSelection,
  removeNonIdProperties,
  getRequiredFields,
  appendFragments,
  kEntityResolvers
} = require('./utils')

/**
 * Creates a resolver function for a fields type
 *
 * There are 3 options:
 *  - Query field resolver: when the service of the type is null
 *  - Reference entity resolver: when the service of type defined the field on the type
 *  - Field entity resolver: when the field was added through type extension in the service of the field's type
 *
 */
function makeResolver({
  service,
  createOperation,
  transformData,
  isReference,
  entityResolversFactory,
  lruGatewayResolvers
}) {
  return async function (parent, args, context, info) {
    const {
      fieldNodes,
      fieldName,
      parentType,
      operation: originalOperation,
      fragments,
      schema
    } = info

    if (isReference && !parent[fieldName]) return null

    const { type, queryId, resolverKey } = getReferences(info)

    const cached = getCached(context, resolverKey, lruGatewayResolvers)

    let variableNamesToDefine
    let operation
    let query
    let selections

    if (cached) {
      variableNamesToDefine = cached.variableNamesToDefine
      query = cached.query
      operation = cached.operation
    } else {
      // Remove items from selections that are not defined in the service
      selections = fieldNodes[0].selectionSet
        ? collectServiceTypeFields(
            fieldNodes[0].selectionSet.selections,
            service,
            type,
            schema
          )
        : []

      // collect all variable names that are used in selection
      variableNamesToDefine = new Set(
        collectArgumentsWithVariableValues(selections)
      )
      const variablesToDefine = originalOperation.variableDefinitions.filter(
        definition => variableNamesToDefine.has(definition.variable.name.value)
      )

      // create the operation that will be sent to the service
      operation = createOperation({
        returnType: type,
        parentType,
        fieldName,
        selections,
        isReference,
        variableDefinitions: variablesToDefine,
        args: fieldNodes[0].arguments,
        operation: originalOperation.operation
      })

      query = print(operation)

      // check if fragments are used in the original query
      const usedFragments = getFragmentNamesInSelection(selections)
      const fragmentsToDefine = collectFragmentsToInclude(
        usedFragments,
        fragments,
        service,
        schema
      )
      query = appendFragments(query, fragmentsToDefine)

      if (lruGatewayResolvers != null) {
        lruGatewayResolvers.set(`${context.__currentQuery}_${resolverKey}`, {
          query,
          operation,
          variableNamesToDefine
        })
      }
    }

    const variables = {}

    if (isReference) {
      if (parent[fieldName] instanceof Array) {
        variables.representations = parent[fieldName].map(ref =>
          removeNonIdProperties(ref, type)
        )
      } else {
        variables.representations = [
          removeNonIdProperties(parent[fieldName], type)
        ]
      }
    } else {
      variables.representations = [
        {
          ...removeNonIdProperties(parent, parentType),
          ...getRequiredFields(
            parent,
            schema.getType(parentType).getFields()[fieldName]
          )
        }
      ]
    }

    let entityResolvers =
      context.reply?.[kEntityResolvers] || entityResolversFactory.create()

    // This method is declared in gateway.js inside of onRequest
    // hence it's unique per request.
    const response = await entityResolvers[`${service.name}Entity`]({
      document: operation,
      query,
      variables,
      context,
      id: queryId
    })

    return transformData(response)
  }
}

module.exports = makeResolver
