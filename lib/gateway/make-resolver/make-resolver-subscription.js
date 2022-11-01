'use strict'

const { print } = require('graphql')
const { preGatewaySubscriptionExecutionHandler } = require('../../handlers')

const {
  getCached,
  getReferences,
  collectArgumentsWithVariableValues,
  collectFragmentsToInclude,
  collectServiceTypeFields,
  getFragmentNamesInSelection,
  collectArgumentNames,
  appendFragments
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
function makeResolverSubscription({
  service,
  createOperation,
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

    const { type, resolverKey } = getReferences(info)

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
      variables[variableName] = variableValue
    }

    // Trigger preGatewaySubscriptionExecution hook
    if (context.preGatewaySubscriptionExecution !== null) {
      await preGatewaySubscriptionExecutionHandler({
        schema,
        document: operation,
        context,
        service
      })
    }
    const subscriptionId = service.createSubscription(
      query,
      variables,
      context.pubsub.publish.bind(context.pubsub),
      context
    )
    return context.pubsub.subscribe(`${service.name}_${subscriptionId}`)
  }
}

module.exports = makeResolverSubscription
