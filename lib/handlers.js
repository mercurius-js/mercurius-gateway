'use strict'

const { print } = require('graphql')

const { addErrorsToContext } = require('./errors')
const { hooksRunner } = require('mercurius/lib/hooks')

function gatewayHookRunner (fn, request) {
  return fn(request.schema, request.document, request.context, request.service)
}

function onGatewayReplaceSchemaHookRunner (fn, data) {
  return fn(data.instance, data.schema)
}

function assignApplicationLifecycleHooksToContext (context, hooks) {
  const contextHooks = {
    onGatewayReplaceSchema: null
  }
  if (hooks.onGatewayReplaceSchema.length > 0) { contextHooks.onGatewayReplaceSchema = hooks.onGatewayReplaceSchema.slice() }
  return Object.assign(context, contextHooks)
}

async function onGatewayReplaceSchemaHandler (context, data) {
  await hooksRunner(
    context.onGatewayReplaceSchema,
    onGatewayReplaceSchemaHookRunner,
    data
  )
}

async function preGatewayExecutionHooksRunner (functions, request) {
  let errors = []
  let modifiedDocument

  for (const fn of functions) {
    const result = await fn(
      request.schema,
      modifiedDocument || request.document,
      request.context,
      request.service
    )

    if (result) {
      if (typeof result.document !== 'undefined') {
        modifiedDocument = result.document
      }
      if (typeof result.errors !== 'undefined') {
        errors = errors.concat(result.errors)
      }
    }
  }

  return { errors, modifiedDocument }
}

async function preGatewayExecutionHandler (request) {
  const { errors, modifiedDocument } = await preGatewayExecutionHooksRunner(
    request.context.preGatewayExecution,
    request
  )
  if (errors.length > 0) {
    addErrorsToContext(request.context, errors)
  }
  if (typeof modifiedDocument !== 'undefined') {
    return Object.create(null, {
      modifiedDocument: { value: modifiedDocument },
      modifiedQuery: { get: () => print(modifiedDocument) }
    })
  }
  return {}
}

async function preGatewaySubscriptionExecutionHandler (request) {
  await hooksRunner(
    request.context.preGatewaySubscriptionExecution,
    gatewayHookRunner,
    request
  )
}

module.exports = {
  assignApplicationLifecycleHooksToContext,
  onGatewayReplaceSchemaHandler,
  preGatewayExecutionHandler,
  preGatewaySubscriptionExecutionHandler
}
