function collectHeaders (context, { key, response }) {
  context.collectors.responseHeaders ??= {}
  context.collectors.responseHeaders[key] = response.headers
}

function collect (collectors, context, opts) {
  context.collectors ??= {}
  if (collectors.collectHeaders) {
    collectHeaders(context, opts)
  }
}

function resolvePath ({ prev, key }) {
  return prev ? `${resolvePath(prev)}.${key}` : key
}

module.exports = {
  collect,
  resolvePath
}
