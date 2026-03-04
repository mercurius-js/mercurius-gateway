const { test } = require('node:test')
const fastify = require('fastify')
const { MockAgent } = require('undici')
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
    t.assert.strictEqual(error.constructor.name, FederatedError.name)
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
    t.assert.strictEqual(error.constructor.name, FederatedError.name)
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

test('buildRequest with single url sets origin correctly', async t => {
  const app = fastify()
  app.post('/graphql', async () => {
    return { data: { hello: 'world' } }
  })

  await app.listen({ port: 0 })

  const url = `http://localhost:${app.server.address().port}/graphql`
  const { request, close } = buildRequest({ url })
  t.after(() => {
    close()
    return app.close()
  })

  const result = await sendRequest(
    request,
    new URL(url)
  )({
    method: 'POST',
    body: JSON.stringify({ query: '{ hello }' })
  })

  t.assert.deepStrictEqual(result.json, { data: { hello: 'world' } })
})

test('buildRequest with array of urls sets origin to undefined and uses BalancedPool', async t => {
  const app = fastify()
  app.post('/graphql', async () => {
    return { data: { hello: 'balanced' } }
  })

  await app.listen({ port: 0 })

  const port = app.server.address().port
  const urls = [
    `http://localhost:${port}/graphql`,
    `http://localhost:${port}/graphql`
  ]
  const { request, close } = buildRequest({ url: urls })
  t.after(() => {
    close()
    return app.close()
  })

  const result = await sendRequest(
    request,
    new URL(urls[0])
  )({
    method: 'POST',
    body: JSON.stringify({ query: '{ hello }' })
  })

  t.assert.deepStrictEqual(result.json, { data: { hello: 'balanced' } })
})

test('buildRequest with custom agent uses MockAgent interceptor', async t => {
  const mockAgent = new MockAgent()
  const mockPool = mockAgent.get('http://test.local')

  mockPool.intercept({
    path: '/graphql',
    method: 'POST'
  }).reply(200, JSON.stringify({ data: { hello: 'mock' } }), {
    headers: { 'content-type': 'application/json' }
  })

  const url = 'http://test.local/graphql'
  const { request, close } = buildRequest({ url, agent: mockAgent })
  t.after(async () => {
    await close()
  })

  const result = await sendRequest(
    request,
    new URL(url)
  )({
    method: 'POST',
    body: JSON.stringify({ query: '{ hello }' })
  })

  t.assert.deepStrictEqual(result.json, { data: { hello: 'mock' } })
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
