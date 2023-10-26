'use strict'

const { BalancedPool, Pool } = require('undici')
const { URL } = require('url')
const { FederatedError } = require('../errors')
const sJSON = require('secure-json-parse')
const zlib = require('zlib')

function agentOption (opts) {
  return {
    bodyTimeout: opts.bodyTimeout || 30e3, // 30 seconds
    headersTimeout: opts.headersTimeout || 30e3, // 30 seconds
    maxHeaderSize: opts.maxHeaderSize || 16384, // 16 KiB
    keepAliveMaxTimeout:
      opts.keepAliveMaxTimeout || opts.keepAliveMsecs || 5 * 1000, // 5 seconds
    connections: opts.connections || opts.maxSockets || 10,
    tls: {
      rejectUnauthorized: opts.rejectUnauthorized
    }
  }
}

function buildRequest (opts) {
  let { agent } = opts
  if (!agent) {
    if (Array.isArray(opts.url)) {
      const upstreams = []
      for (const url of opts.url) {
        upstreams.push(new URL(url).origin)
      }

      agent = new BalancedPool(upstreams, agentOption(opts))
    } else {
      agent = new Pool(new URL(opts.url).origin, agentOption(opts))
    }
  }

  const rewriteHeaders =
    opts.rewriteHeaders ||
    function () {
      return {}
    }

  async function close () {
    await agent.destroy()
  }

  async function request (opts) {
    try {
      const newHeaders = await rewriteHeaders(
        opts.originalRequestHeaders,
        opts.context
      )

      const response = await agent.request({
        method: opts.method,
        path: opts.url.pathname + (opts.qs || ''),
        headers: {
          ...newHeaders,
          ...opts.headers
        },
        body: opts.body
      })

      return response
    } catch (err) {
      throw new FederatedError([err])
    }
  }

  return {
    request,
    close
  }
}

function sendRequest (request, url, useSecureParse) {
  return async function (opts) {
    try {
      const { body, statusCode, headers } = await request({
        url,
        method: 'POST',
        body: opts.body,
        headers: {
          ...opts.headers,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(opts.body)
        },
        originalRequestHeaders: opts.originalRequestHeaders || {},
        context: opts.context
      })

      let data
      if (headers['content-encoding'] === 'gzip') {
        // undici request() doesn't automaticlally decompress the body
        // so we have to manually do it here:
        const blob = await body.blob()
        const buffer = await blob.arrayBuffer()
        data = zlib.gunzipSync(buffer).toString('utf8')
      } else {
        data = await body.text()
      }
      const json = (useSecureParse ? sJSON : JSON).parse(data.toString())

      if (json.errors && json.errors.length) {
        if (json.data == null) {
          // return a `FederatedError` instance to keep `graphql` happy
          // e.g. have something that derives from `Error`
          throw new FederatedError(json.errors)
        } else {
          (opts.context.errors || (opts.context.errors = [])).push(
            ...json.errors
          )
        }
      }

      return {
        statusCode,
        json,
        headers
      }
    } catch (err) {
      if (err instanceof FederatedError) {
        throw err
      }
      throw new FederatedError([err])
    }
  }
}

module.exports = {
  buildRequest,
  sendRequest
}
