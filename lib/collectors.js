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

module.exports = {
  collect
}
