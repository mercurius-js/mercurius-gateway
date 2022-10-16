async function hooksRunner(functions, runner, request) {
  for (const fn of functions) {
    await runner(fn, request)
  }
}

function onGatewayReplaceSchemaHookRunner(fn, data) {
  return fn(data.instance, data.schema)
}

function assignApplicationLifecycleHooksToContext(context, hooks) {
  const contextHooks = {
    onGatewayReplaceSchema: null
  }
  if (hooks.onGatewayReplaceSchema.length > 0)
    contextHooks.onGatewayReplaceSchema = hooks.onGatewayReplaceSchema.slice()
  return Object.assign(context, contextHooks)
}

async function onGatewayReplaceSchemaHandler(context, data) {
  await hooksRunner(
    context.onGatewayReplaceSchema,
    onGatewayReplaceSchemaHookRunner,
    data
  )
}

module.exports = {
  assignApplicationLifecycleHooksToContext,
  onGatewayReplaceSchemaHandler
}
