'use strict'

function collectHeaders (context, queryId, response, serviceName) {
  if (!context.collectors.responseHeaders) {
    context.collectors.responseHeaders = {}
  }
  context.collectors.responseHeaders[queryId] = {
    service: serviceName,
    data: response.headers
  }
}

function collectStatusCode (context, queryId, response, serviceName) {
  if (!context.collectors.statusCodes) {
    context.collectors.statusCodes = {}
  }
  context.collectors.statusCodes[queryId] = {
    service: serviceName,
    data: {
      statusCode: response.statusCode
    }
  }
}

function collectExtensions (context, queryId, response, serviceName) {
  if (!context.collectors.extensions) {
    context.collectors.extensions = {}
  }
  context.collectors.extensions[queryId] = {
    service: serviceName,
    data: response.json.extensions
  }
}

function collect ({ collectors, context, queryId, response, serviceName }) {
  if (!context.collectors) {
    context.collectors = {}
  }

  if (collectors.collectHeaders) {
    collectHeaders(context, queryId, response, serviceName)
  }

  if (collectors.collectStatutsCodes) {
    collectStatusCode(context, queryId, response, serviceName)
  }

  if (collectors.collectExtensions && response.json.extensions) {
    collectExtensions(context, queryId, response, serviceName)
  }
}

module.exports = {
  collect
}
