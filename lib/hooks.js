'use strict'

const applicationHooks = [
  'onGatewayReplaceSchema'
]
const lifecycleHooks = [
  'preGatewayExecution',
  'preGatewaySubscriptionExecution'
]

const supportedHooks = lifecycleHooks.concat(applicationHooks)

const { MER_ERR_HOOK_INVALID_TYPE, MER_ERR_HOOK_INVALID_HANDLER, MER_ERR_HOOK_UNSUPPORTED_HOOK } = require('./errors')

function Hooks () {
  this.preGatewayExecution = []
  this.preGatewaySubscriptionExecution = []
  this.onGatewayReplaceSchema = []
}

Hooks.prototype.validate = function (hook, fn) {
  if (typeof hook !== 'string') throw new MER_ERR_HOOK_INVALID_TYPE()
  if (typeof fn !== 'function') throw new MER_ERR_HOOK_INVALID_HANDLER()
  if (supportedHooks.indexOf(hook) === -1) {
    throw new MER_ERR_HOOK_UNSUPPORTED_HOOK(hook)
  }
}

Hooks.prototype.add = function (hook, fn) {
  this.validate(hook, fn)
  this[hook].push(fn)
}

function assignApplicationLifecycleHooksToContext (context, hooks) {
  const contextHooks = {
    onGatewayReplaceSchema: null
  }
  if (hooks.onGatewayReplaceSchema.length > 0) contextHooks.onGatewayReplaceSchema = hooks.onGatewayReplaceSchema.slice()
  return Object.assign(context, contextHooks)
}

function assignLifeCycleHooksToContext (context, hooks) {
  const contextHooks = {
    preGatewayExecution: null,
    preGatewaySubscriptionExecution: null
  }
  if (hooks.preGatewayExecution.length > 0) contextHooks.preGatewayExecution = hooks.preGatewayExecution.slice()
  if (hooks.preGatewaySubscriptionExecution.length > 0) contextHooks.preGatewaySubscriptionExecution = hooks.preGatewaySubscriptionExecution.slice()
  return Object.assign(context, contextHooks)
}

async function hooksRunner (functions, runner, request) {
  for (const fn of functions) {
    await runner(fn, request)
  }
}

module.exports = {
  Hooks,
  assignLifeCycleHooksToContext,
  assignApplicationLifecycleHooksToContext,
  hooksRunner
}
