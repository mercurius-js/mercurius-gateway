'use strict'

const createError = require('@fastify/error')
const mercuriusError = require('mercurius/lib/errors')

const FEDERATED_ERROR = Symbol('FEDERATED_ERROR')

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

module.exports = { ...mercuriusError, ...errors, FederatedError }
