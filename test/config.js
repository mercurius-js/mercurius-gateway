'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const { createGateway } = require('../index')

test('Throws an Error if the service list is empty', async t => {
  const app = Fastify()

  try {
    await createGateway(
      {
        services: []
      },
      app
    )
  } catch (err) {
    t.equal(
      err.message,
      'Gateway schema init issues No valid service SDLs were provided'
    )
  }
})

test('Throws an Error if the service list is empty', async t => {
  const app = Fastify()

  try {
    await createGateway({}, app)
  } catch (err) {
    t.equal(
      err.message,
      'Gateway schema init issues The "services" attribute cannot be undefined'
    )
  }
})

test('Each "gateway" option "services" must be an object', async t => {
  const app = Fastify()

  try {
    await createGateway(
      {
        services: ['foo']
      },
      app
    )
  } catch (err) {
    t.equal(
      err.message,
      'Invalid options: gateway: all "services" must be objects'
    )
  }
})

test('Each "gateway" option "services" must have a "name"', async t => {
  const app = Fastify()

  try {
    await createGateway(
      {
        services: [{}]
      },
      app
    )
  } catch (err) {
    t.equal(
      err.message,
      'Invalid options: gateway: all "services" must have a "name" String property'
    )
  }
})

test('Each "gateway" option "services" must have a "name" that is a String', async t => {
  const app = Fastify()

  try {
    await createGateway(
      {
        services: [{ name: 42 }]
      },
      app
    )
  } catch (err) {
    t.equal(
      err.message,
      'Invalid options: gateway: all "services" must have a "name" String property'
    )
  }
})

test('Each "gateway" option "services" must have a "name" that is unique', async t => {
  const app = Fastify()

  try {
    await createGateway(
      {
        services: [{ name: 'foo', url: 'https://foo' }, { name: 'foo' }]
      },
      app
    )
  } catch (err) {
    t.equal(
      err.message,
      'Invalid options: gateway: all "services" must have a unique "name": "foo" is already used'
    )
  }
})

test('Each "gateway" option "services" must have an "url"', async t => {
  const app = Fastify()

  try {
    await createGateway(
      {
        services: [{ name: 'foo' }]
      },
      app
    )
  } catch (err) {
    t.equal(
      err.message,
      'Invalid options: gateway: all "services" must have an "url" String, or a non-empty Array of String, property'
    )
  }
})

test('Each "gateway" option "services" must have an "url" that is a String or an Array', async t => {
  const app = Fastify()

  try {
    await createGateway(
      {
        services: [{ name: 'foo', url: new URL('https://foo') }]
      },
      app
    )
  } catch (err) {
    t.equal(
      err.message,
      'Invalid options: gateway: all "services" must have an "url" String, or a non-empty Array of String, property'
    )
  }
})

test('Each "gateway" option "services" must have an "url" that, if it is an Array, should not be empty', async t => {
  const app = Fastify()

  try {
    await createGateway(
      {
        services: [{ name: 'foo', url: [] }]
      },
      app
    )
  } catch (err) {
    t.equal(
      err.message,
      'Invalid options: gateway: all "services" must have an "url" String, or a non-empty Array of String, property'
    )
  }
})

test('Each "gateway" option "services" must have an "url" that, if it is a non-empty Array, should be filled with Strings only', async t => {
  const app = Fastify()

  try {
    await createGateway(
      {
        services: [{ name: 'foo', url: [new URL('https://foo')] }]
      },
      app
    )
  } catch (err) {
    t.equal(
      err.message,
      'Invalid options: gateway: all "services" must have an "url" String, or a non-empty Array of String, property'
    )
  }
})
