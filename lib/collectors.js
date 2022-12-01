function collectHeaders (context, key, response) {
  context.collectors.responseHeaders ??= {}
  context.collectors.responseHeaders[key] = response.headers
}

function collect ({ collectors, context, key, response }) {
  context.collectors ??= {}
  if (collectors.collectHeaders) {
    collectHeaders(context, key, response)
  }
}

function resolvePath ({ prev, key }) {
  return prev ? `${resolvePath(prev)}.${key}` : key
}

module.exports = {
  collect,
  resolvePath
}
