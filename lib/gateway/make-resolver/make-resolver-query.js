'use strict'

const { print } = require('graphql')
const { preGatewayExecutionHandler } = require('../../handlers')

const {
  getCached,
  getReferences,
  collectArgumentsWithVariableValues,
  collectFragmentsToInclude,
  collectServiceTypeFields,
  getFragmentNamesInSelection,
  collectArgumentNames,
  removeNonIdProperties,
  appendFragments,
  createEntityReferenceResolverOperation,
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
function makeResolverQuery({
  service,
  createOperation,
  transformData,
  typeToServiceMap,
  serviceMap,
  entityResolversFactory,
  lruGatewayResolvers
}) {
  return async function (parent, args, context, info) {
    const {
      fieldNodes,
      fieldName,
      parentType,
      operation: originalOperation,
      variableValues,
      fragments,
      schema
    } = info

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
      collectArgumentNames(fieldNodes[0]).map(argumentName =>
        variableNamesToDefine.add(argumentName)
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

    // Add variables to payload
    for (const [variableName, variableValue] of Object.entries(
      variableValues
    )) {
      if (variableNamesToDefine.has(variableName)) {
        variables[variableName] = variableValue
      }
    }

    let entityResolvers =
      context.reply?.[kEntityResolvers] || entityResolversFactory.create()

    // Trigger preGatewayExecution hook
    let modifiedQuery
    if (context.preGatewayExecution !== null) {
      ;({ modifiedQuery } = await preGatewayExecutionHandler({
        schema,
        document: operation,
        context,
        service
      }))
    }

    const response = await service.sendRequest({
      method: 'POST',
      body: JSON.stringify({
        query: modifiedQuery || query,
        variables
      }),
      originalRequestHeaders: context.reply
        ? context.reply.request.headers
        : {},
      context
    })

    service.setResponseHeaders(context.reply || {})

    const transformed = transformData(response)
    // TODO support union types
    const transformedTypeName = Array.isArray(transformed)
      ? transformed.length > 0 && transformed[0].__typename
      : transformed && transformed.__typename

    if (typeToServiceMap) {
      // If the type is defined in the typeToServiceMap, we need to resolve the type if the type is a reference
      // and it is fullfilled by another service
      const targetService = typeToServiceMap[transformedTypeName]
      // targetService can be null if it is a value type or not defined anywhere
      if (targetService && targetService !== service.name) {
        selections = collectServiceTypeFields(
          fieldNodes[0].selectionSet.selections,
          serviceMap[targetService],
          type,
          schema
        )

        const toFill = Array.isArray(transformed) ? transformed : [transformed]

        variables.representations = toFill.map(ref =>
          removeNonIdProperties(ref, schema.getType(transformedTypeName))
        )

        operation = createEntityReferenceResolverOperation({
          returnType: transformedTypeName,
          selections,
          variableDefinitions: []
        })

        query = print(operation)

        const usedFragments = getFragmentNamesInSelection(selections)
        const fragmentsToDefine = collectFragmentsToInclude(
          usedFragments,
          fragments,
          serviceMap[targetService],
          schema
        )
        query = appendFragments(query, fragmentsToDefine)

        // We are completely skipping the resolver logic in this case to avoid expensive
        // multiple requests to the other service, one for each field. Our current logic
        // for the entities data loaders would not work in this case as we would need to
        // resolve each field individually. Therefore we are short-cricuiting it and
        // just issuing the request. A different algorithm based on the graphql executor
        // is possible but it would be significantly slower and difficult to prepare.
        const response2 = await entityResolvers[`${targetService}Entity`]({
          document: operation,
          query,
          variables,
          context,
          id: queryId
        })
        const entities = response2.json.data._entities
        for (let i = 0; i < entities.length; i++) {
          Object.assign(toFill[i], entities[i])
        }
      }
    }
    return transformed
  }
}

module.exports = makeResolverQuery
