'use strict'

const { GraphQLError } = require('graphql')
const createError = require('@fastify/error')

const FEDERATED_ERROR = Symbol('FEDERATED_ERROR')

function addErrorsToContext (context, errors) {
  let newErrors
  if (context.errors !== null) {
    newErrors = context.errors.concat(errors)
  } else {
    newErrors = errors
  }

  context.errors = newErrors
}

// converts an error to a `GraphQLError` compatible
// allows to copy the `path` & `locations` properties
// from the already serialized error
function toGraphQLError (err) {
  if (err instanceof GraphQLError) {
    return err
  }

  const gqlError = new GraphQLError(
    err.message,
    err.nodes,
    err.source,
    err.positions,
    err.path,
    err,
    err.extensions
  )

  gqlError.locations = err.locations

  return gqlError
}

// a specialized `Error` which extends the `Error` built-in
// to satisfy the `graphql` error handler
class FederatedError extends Error {
  constructor (errors) {
    if (errors && !Array.isArray(errors)) {
      throw new TypeError('errors must be an Array')
    }
    super(FEDERATED_ERROR.toString())
    this.extensions = { errors }
  }
}

const errors = {
  /**
   * General errors
   * Replicated from `mercurius`.
   * TODO: export the errors from mercurius
   */
  MER_ERR_INVALID_OPTS: createError(
    'MER_ERR_INVALID_OPTS',
    'Invalid options: %s'
  ),
  /**
   * Hooks errors
   * Replicated from `mercurius`.
   * TODO: export the errors from mercurius
   */
  MER_ERR_HOOK_INVALID_TYPE: createError(
    'MER_ERR_HOOK_INVALID_TYPE',
    'The hook name must be a string',
    500,
    TypeError
  ),
  MER_ERR_HOOK_INVALID_HANDLER: createError(
    'MER_ERR_HOOK_INVALID_HANDLER',
    'The hook callback must be a function',
    500,
    TypeError
  ),
  MER_ERR_HOOK_UNSUPPORTED_HOOK: createError(
    'MER_ERR_HOOK_UNSUPPORTED_HOOK',
    '%s hook not supported!',
    500
  ),
  MER_ERR_SERVICE_RETRY_FAILED: createError(
    'MER_ERR_SERVICE_RETRY_FAILED',
    'Mandatory services retry failed - [%s]',
    500
  ),
  /**
   * Gateway errors
   */
  MER_ERR_GQL_GATEWAY: createError('MER_ERR_GQL_GATEWAY', 'Gateway issues: %s'),
  MER_ERR_GQL_GATEWAY_INVALID_SCHEMA: createError(
    'MER_ERR_GQL_GATEWAY_INVALID_SCHEMA',
    'The _entities resolver tried to load an entity for type "%s", but no object type of that name was found in the schema'
  ),
  MER_ERR_GQL_GATEWAY_REFRESH: createError(
    'MER_ERR_GQL_GATEWAY_REFRESH',
    'Refresh schema issues'
  ),
  MER_ERR_GQL_GATEWAY_INIT: createError(
    'MER_ERR_GQL_GATEWAY_INIT',
    'Gateway schema init issues'
  ),
  MER_ERR_GQL_GATEWAY_MISSING_KEY_DIRECTIVE: createError(
    'MER_ERR_GQL_GATEWAY_MISSING_KEY_DIRECTIVE',
    'Missing @key directive in %s type'
  ),
  MER_ERR_GQL_GATEWAY_DUPLICATE_DIRECTIVE: createError(
    'MER_ERR_GQL_GATEWAY_DUPLICATE_DIRECTIVE',
    'Directive with a different definition but the same name "%s" already exists in the gateway schema'
  )
}

function defaultErrorFormatter (execution, ctx) {
  // There is always app if there is a context
  const log = ctx.reply ? ctx.reply.log : ctx.app.log

  let statusCode = execution.data ? 200 : (execution.statusCode || 200)

  const errors = execution.errors.map((error) => {
    log.info({ err: error }, error.message)

    // parses, converts & combines errors if they are the result of a federated request
    if (error.message === FEDERATED_ERROR.toString() && error.extensions) {
      return error.extensions.errors.map(err => toGraphQLError(err))
    }

    // it handles fastify errors MER_ERR_GQL_VALIDATION
    if (error.originalError?.errors) {
      // not all errors are `GraphQLError` type, we need to convert them
      return error.originalError.errors.map(toGraphQLError)
    }

    return error
    // as the result of the outer map could potentially contain arrays with federated errors
    // the result needs to be flattened
    // and convert error into serializable format
  }).reduce((acc, val) => acc.concat(val), []).map((error) => error.toJSON())

  // Override status code when there is no data or statusCode present
  if (!execution.data && typeof execution.statusCode === 'undefined' && execution.errors.length > 0) {
    if (errors.length === 1) {
      // If single error defined, use status code if present
      if (typeof execution.errors[0].originalError !== 'undefined' && typeof execution.errors[0].originalError.statusCode === 'number') {
        statusCode = execution.errors[0].originalError.statusCode
        // Otherwise, use 200 as per graphql-over-http spec
      } else {
        statusCode = 200
      }
    }
  }

  return {
    statusCode,
    response: {
      data: execution.data || null,
      errors
    }
  }
}

module.exports = { ...errors, defaultErrorFormatter, FederatedError, addErrorsToContext }
