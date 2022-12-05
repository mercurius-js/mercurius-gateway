'use strict'

function collectHeaders (context, queryId, response) {
  if (!context.collectors.responseHeaders) {
    context.collectors.responseHeaders = {}
  }
  context.collectors.responseHeaders[queryId] = response.headers
}

function collectStatusCode (context, queryId, response) {
  if (!context.collectors.statusCodes) {
    context.collectors.statusCodes = {}
  }
  context.collectors.statusCodes[queryId] = {
    statusCode: response.statusCode
  }
}

function collectExtensions (context, queryId, response) {
  if (!context.collectors.extensions) {
    context.collectors.extensions = {}
  }
  context.collectors.extensions[queryId] = response.json.extensions
}

function collect ({ collectors, context, queryId, response }) {
  if (!context.collectors) {
    context.collectors = {}
  }
  if (collectors.collectHeaders) {
    collectHeaders(context, queryId, response)
  }

  if (collectors.collectStatutsCodes) {
    collectStatusCode(context, queryId, response)
  }

  if (collectors.collectExtensions && response.json.extensions) {
    collectExtensions(context, queryId, response)
  }
}

module.exports = {
  collect
}
