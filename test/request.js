const { test } = require('node:test')
const fastify = require('fastify')
const { sendRequest, buildRequest } = require('../lib/gateway/request')
const { FederatedError } = require('../lib/errors')
const zlib = require('zlib')

test('sendRequest method rejects when request errs', async t => {
  const url = new URL('http://localhost:3001')
  const { request } = buildRequest({ url })
  await t.assert.rejects(
    sendRequest(
      request,
      url
    )({
      method: 'POST',
      body: JSON.stringify({
        query: `
      query ServiceInfo {
        _service {
          sdl
        }
      }
      `
      })
    })
  )
})

test('sendRequest method rejects when response is not valid json', async t => {
  const app = fastify()
  app.post('/', async () => {
    return 'response'
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.after(() => {
    close()
    return app.close()
  })
  try {
    await sendRequest(
      request,
      url
    )({
      method: 'POST',
      body: JSON.stringify({
        query: `
        query ServiceInfo {
          _service {
            sdl
          }
        }
        `
      })
    })
    t.assert.fail('it must throw')
  } catch (error) {
    t.assert.ok(error instanceof FederatedError)
    t.assert.ok(Array.isArray(error.extensions.errors))

    // Full string on Node 17 is "Unexpected token r in JSON at position 0"
    t.assert.match(error.extensions.errors[0].message, /Unexpected token/)
  }
})

test('sendRequest method rejects when response contains only errors', async t => {
  const app = fastify()
  app.post('/', async () => {
    return { errors: ['foo'] }
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.after(() => {
    close()
    return app.close()
  })

  try {
    await sendRequest(
      request,
      url
    )({
      method: 'POST',
      body: JSON.stringify({
        query: `
      query ServiceInfo {
        _service {
          sdl
        }
      }
      `
      })
    })
    t.assert.fail('it must throw')
  } catch (error) {
    t.assert.ok(error instanceof FederatedError)
    t.assert.deepStrictEqual(error.extensions, { errors: ['foo'] })
  }
})

test('sendRequest method accepts when response contains data and errors', async t => {
  const app = fastify()
  app.post('/', async () => {
    return { data: {}, errors: ['foo'] }
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.after(() => {
    close()
    return app.close()
  })
  const context = {}
  const result = await sendRequest(
    request,
    url
  )({
    context,
    method: 'POST',
    body: JSON.stringify({
      query: `
      query ServiceInfo {
        _service {
          sdl
        }
      }
      `
    })
  })
  t.assert.deepStrictEqual(result.json, { data: {}, errors: ['foo'] })
  t.assert.deepStrictEqual(context, { errors: ['foo'] })
})

test('sendRequest method should accept useSecureParse flag and parse the response securely', async t => {
  const app = fastify()
  app.post('/', async () => {
    return '{" __proto__": { "foo": "bar" } }'
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.after(() => {
    close()
    return app.close()
  })
  const result = await sendRequest(
    request,
    url,
    true
  )({
    method: 'POST',
    body: JSON.stringify({
      query: `
    query ServiceInfo {
      _service {
        sdl
      }
    }
    `
    })
  })

  // checking for prototype leakage: https://github.com/fastify/secure-json-parse#introduction
  // secure parsing should not allow it
  t.assert.ok(result.json)
  t.assert.ok(!result.json.foo)
  const testObject = Object.assign({}, result.json)
  t.assert.ok(!testObject.foo)
})

test('sendRequest method should run without useSecureParse flag', async t => {
  const app = fastify()
  app.post('/', async () => {
    return '{ "foo": "bar" }'
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.after(() => {
    close()
    return app.close()
  })
  const result = await sendRequest(
    request,
    url,
    false
  )({
    method: 'POST',
    body: JSON.stringify({
      query: `
      query ServiceInfo {
        _service {
          sdl
        }
      }
      `
    })
  })

  t.assert.deepStrictEqual(result.json, { foo: 'bar' })
})

test('sendRequest method should decompress gzip bodies', async t => {
  const app = fastify()
  app.post('/', async (request, reply) => {
    const compressedBody = zlib.gzipSync('{ "foo": "bar" }')
    return reply
      .status(200)
      .type('application/json')
      .header('content-encoding', 'gzip')
      .send(compressedBody)
  })

  await app.listen({ port: 0 })

  const url = new URL(`http://localhost:${app.server.address().port}`)
  const { request, close } = buildRequest({ url })
  t.after(() => {
    close()
    return app.close()
  })
  const result = await sendRequest(
    request,
    url,
    false
  )({
    method: 'POST',
    body: JSON.stringify({
      query: `
      query ServiceInfo {
        _service {
          sdl
        }
      }
      `
    })
  })

  t.assert.deepStrictEqual(result.json, { foo: 'bar' })
})
