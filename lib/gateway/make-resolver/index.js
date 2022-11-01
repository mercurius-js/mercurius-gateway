'use strict'

const {
  createQueryOperation,
  createFieldResolverOperation,
  createEntityReferenceResolverOperation,
  kEntityResolvers
} = require('./utils')

const makeResolver = require('./make-resolver')
const makeResolverQuery = require('./make-resolver-query')
const makeResolverSubscription = require('./make-resolver-subscription')

module.exports = {
  makeResolver,
  makeResolverQuery,
  makeResolverSubscription,
  createQueryOperation,
  createFieldResolverOperation,
  createEntityReferenceResolverOperation,
  kEntityResolvers
}
