function collectHeaders (context, queryId, response) {
  context.collectors.responseHeaders ??= {}
  context.collectors.responseHeaders[queryId] = response.headers
}

function collect ({ collectors, context, queryId, response }) {
  context.collectors ??= {}
  if (collectors.collectHeaders) {
    collectHeaders(context, queryId, response)
  }
}

module.exports = {
  collect
}
