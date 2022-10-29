'use strict'

const { test } = require('tap')
const Fastify = require('fastify')
const { createGateway } = require('../../index')

const invalidSchema = `
  extend type Query {
    hello: World!
  }
`

const validSchema = `
  extend type Query {
    foo: String!
  }
`

async function createRemoteService(schema) {
  const service = Fastify()
  service.post('/graphql', async (request, reply) => {
    reply.send({ data: { _service: { sdl: schema } } })
  })

  await service.listen({ port: 0 })

  return [service, service.server.address().port]
}

async function createNonWorkingRemoteService() {
  const service = Fastify()
  service.post('/graphql', async (request, reply) => {
    reply.send({ data: undefined })
  })

  await service.listen({ port: 0 })

  return [service, service.server.address().port]
}

test(
  'Throws an Error and cleans up service connections correctly if the service do not return the SDL',
  { timeout: 4000 },
  async t => {
    const [service, servicePort] = await createNonWorkingRemoteService(
      invalidSchema
    )

    const gateway = Fastify()

    t.teardown(async () => {
      await service.close()
    })

    try {
      await createGateway(
        {
          services: [
            {
              name: 'not-working',
              url: `http://localhost:${servicePort}/graphql`
            }
          ]
        },
        gateway
      )
    } catch (err) {
      t.equal(
        err.message,
        'Gateway schema init issues No valid service SDLs were provided'
      )
    }
  }
)

test(
  'Throws an Error and cleans up service connections correctly if there are no valid services',
  { timeout: 4000 },
  async t => {
    t.plan(1)
    const [service, servicePort] = await createRemoteService(invalidSchema)

    const gateway = Fastify()

    t.teardown(async () => {
      await service.close()
    })

    try {
      await createGateway(
        {
          services: [
            {
              name: 'not-working',
              url: `http://localhost:${servicePort}/graphql`
            }
          ]
        },
        gateway
      )
    } catch (err) {
      t.equal(
        err.message,
        'Gateway schema init issues No valid service SDLs were provided'
      )
    }
  }
)

test('Returns schema related errors for mandatory services', async t => {
  const [service, servicePort] = await createRemoteService(invalidSchema)

  const gateway = Fastify()

  t.teardown(async () => {
    await Promise.all([gateway.close(), service.close()])
  })

  try {
    await createGateway(
      {
        services: [
          {
            name: 'not-working',
            url: `http://localhost:${servicePort}/graphql`,
            mandatory: true,
            keepAliveTimeout: 10, // milliseconds
            keepAliveMaxTimeout: 10 // milliseconds
          }
        ]
      },
      gateway
    )
  } catch (err) {
    t.equal(err.message, 'Unknown type "World".')
  }
})

test('Does not error if at least one service schema is valid', async t => {
  const [service, servicePort] = await createRemoteService(validSchema)
  const [invalidService, invalidServicePort] = await createRemoteService(
    invalidSchema
  )

  const gateway = Fastify({
    logger: true
  })

  let warnCalled = 0
  gateway.log.warn = message => {
    warnCalled++
    t.matchSnapshot(message)
  }

  t.teardown(async () => {
    await Promise.all([service.close(), invalidService.close()])
  })

  try {
    await createGateway(
      {
        services: [
          {
            name: 'working',
            url: `http://localhost:${servicePort}/graphql`
          },
          {
            name: 'not-working',
            url: `http://localhost:${invalidServicePort}/graphql`
          }
        ]
      },
      gateway
    )
  } catch (err) {
    t.error(err)
  }
  t.equal(warnCalled, 2, 'Warning is called')
})
