'use strict'

let LRU = require('tiny-lru')
const { MER_ERR_INVALID_OPTS } = require('./errors')

function hasDirective (directiveName, node) {
  if (!node.directives || node.directives.length < 1) {
    return false
  }
  for (let i = 0; i < node.directives.length; i++) {
    if (node.directives[i].name.value === directiveName) {
      return true
    }
  }
}

function hasExtensionDirective (node) {
  if (!node.directives || node.directives.length < 1) {
    return false
  }
  for (let i = 0; i < node.directives.length; i++) {
    const directive = node.directives[i].name.value
    if (directive === 'extends' || directive === 'requires') {
      return true
    }
  }
}

// Required for module bundlers
// istanbul ignore next
LRU = typeof LRU === 'function' ? LRU : LRU.default

function buildCache (opts) {
  if (Object.prototype.hasOwnProperty.call(opts, 'cache')) {
    const isBoolean = typeof opts.cache === 'boolean'
    const isNumber = typeof opts.cache === 'number'

    if (isBoolean && opts.cache === false) {
      // no cache
      return null
    } else if (isNumber) {
      // cache size as specified
      return LRU(opts.cache)
    } else if (!isBoolean && !isNumber) {
      throw new MER_ERR_INVALID_OPTS('Cache type is not supported')
    }
  }

  // default cache, 1024 entries
  return LRU(1024)
}

module.exports = {
  hasDirective,
  hasExtensionDirective,
  buildCache
}
