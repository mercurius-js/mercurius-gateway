'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const plugin = require('../index')

test('Throws an Error if the service list is empty', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: {
        services: []
      }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Gateway schema init issues No valid service SDLs were provided'
    )
  }
})

test('Throws an Error if the service list is empty', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: {}
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Gateway schema init issues The "services" attribute cannot be undefined'
    )
  }
})

test('Each "gateway" option "services" must be an object', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: { services: ['foo'] }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Invalid options: gateway: all "services" must be objects'
    )
  }
})

test('Each "gateway" option "services" must have a "name"', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: { services: [{}] }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Invalid options: gateway: all "services" must have a "name" String property'
    )
  }
})

test('Each "gateway" option "services" must have a "name" that is a String', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: { services: [{ name: 42 }] }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Invalid options: gateway: all "services" must have a "name" String property'
    )
  }
})

test('Each "gateway" option "services" must have a "name" that is unique', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: {
        services: [{ name: 'foo', url: 'https://foo' }, { name: 'foo' }]
      }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Invalid options: gateway: all "services" must have a unique "name": "foo" is already used'
    )
  }
})

test('Each "gateway" option "services" must have an "url"', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: {
        services: [{ name: 'foo' }]
      }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Invalid options: gateway: all "services" must have an "url" String, or a non-empty Array of String, property'
    )
  }
})

test('Each "gateway" option "services" must have an "url" that is a String or an Array', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: {
        services: [{ name: 'foo', url: new URL('https://foo') }]
      }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Invalid options: gateway: all "services" must have an "url" String, or a non-empty Array of String, property'
    )
  }
})

test('Each "gateway" option "services" must have an "url" that, if it is an Array, should not be empty', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: {
        services: [{ name: 'foo', url: [] }]
      }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Invalid options: gateway: all "services" must have an "url" String, or a non-empty Array of String, property'
    )
  }
})

test('Each "gateway" option "services" must have an "url" that, if it is a non-empty Array, should be filled with Strings only', async t => {
  const gateway = Fastify()

  try {
    await gateway.register(plugin, {
      gateway: {
        services: [{ name: 'foo', url: [new URL('https://foo')] }]
      }
    })
  } catch (err) {
    t.assert.strictEqual(
      err.message,
      'Invalid options: gateway: all "services" must have an "url" String, or a non-empty Array of String, property'
    )
  }
})
