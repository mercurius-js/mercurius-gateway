'use strict'

const { test } = require('node:test')
const Fastify = require('fastify')
const { once } = require('node:events')
const { setTimeout: sleep } = require('node:timers/promises')
const WebSocket = require('ws')
const GQL = require('mercurius')
const plugin = require('../index')
const { buildFederationSchema } = require('@mercuriusjs/federation')

async function createTestService () {
  const active = new Set()
  const service = Fastify()

  await service.register(GQL, {
    schema: buildFederationSchema(`
      type Notification {
        id: String!
      }
      type Query {
        notifications: [Notification]
      }
      type Mutation {
        addNotification(id: String!): Notification
      }
      type Subscription {
        notificationAdded(id: String!): Notification
      }
    `),
    resolvers: {
      Query: {
        notifications: () => []
      },
      Mutation: {
        addNotification: async (_, { id }, { pubsub }) => {
          const notification = { id }
          await pubsub.publish({
            topic: `NOTIFICATION_ADDED_${id}`,
            payload: { notificationAdded: notification }
          })
          return notification
        }
      },
      Subscription: {
        notificationAdded: {
          subscribe: async function * (_, { id }, { pubsub }) {
            active.add(id)
            try {
              for await (const event of await pubsub.subscribe(`NOTIFICATION_ADDED_${id}`)) {
                yield event
              }
            } finally {
              active.delete(id)
            }
          }
        }
      }
    },
    subscription: true
  })
  await service.listen({ port: 0 })

  return { service, active }
}

async function createGateway (service) {
  const port = service.server.address().port
  const gateway = Fastify()

  await gateway.register(plugin, {
    gateway: {
      services: [
        {
          name: 'notifications',
          url: `http://localhost:${port}/graphql`,
          wsUrl: `ws://localhost:${port}/graphql`
        }
      ]
    },
    subscription: true
  })
  await gateway.listen({ port: 0 })

  return gateway
}

async function connect (gateway) {
  const ws = new WebSocket(`ws://localhost:${gateway.server.address().port}/graphql`, 'graphql-ws')
  const messages = []
  const waiters = []

  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    messages.push(message)
    for (const waiter of [...waiters]) {
      if (waiter.match(message)) {
        waiters.splice(waiters.indexOf(waiter), 1)
        waiter.resolve(message)
      }
    }
  })

  await once(ws, 'open')
  ws.send(JSON.stringify({ type: 'connection_init' }))

  const client = {
    ws,
    messages,
    send: (message) => ws.send(JSON.stringify(message)),
    waitFor: (match) => {
      const found = messages.find(match)
      if (found) return Promise.resolve(found)
      return new Promise((resolve) => waiters.push({ match, resolve }))
    },
    subscribe: (id, notificationId) => ws.send(JSON.stringify({
      id,
      type: 'start',
      payload: { query: `subscription { notificationAdded(id: "${notificationId}") { id } }` }
    }))
  }

  await client.waitFor((m) => m.type === 'connection_ack')
  return client
}

async function waitUntil (condition, message) {
  for (let i = 0; i < 100; i++) {
    if (condition()) return
    await sleep(20)
  }
  throw new Error(message)
}

function addNotification (gateway, id) {
  return gateway.inject({
    method: 'POST',
    url: '/graphql',
    body: { query: `mutation { addNotification(id: "${id}") { id } }` }
  })
}

test('stopping a subscription only affects the connection that owns the operation id', async (t) => {
  const { service, active } = await createTestService()
  const gateway = await createGateway(service)
  const alice = await connect(gateway)
  const bob = await connect(gateway)

  t.after(async () => {
    alice.ws.terminate()
    bob.ws.terminate()
    await gateway.close()
    await service.close()
  })

  // both clients use the same operation id on their own connection
  alice.subscribe(1, 'alice')
  bob.subscribe(1, 'bob')
  await waitUntil(() => active.has('alice') && active.has('bob'), 'upstream subscriptions were not started')

  alice.send({ id: 1, type: 'stop' })
  await alice.waitFor((m) => m.id === 1 && m.type === 'complete')

  await waitUntil(() => !active.has('alice'), 'alice upstream subscription was not stopped')
  t.assert.ok(active.has('bob'), 'bob upstream subscription must keep running')

  await addNotification(gateway, 'bob')
  const event = await Promise.race([
    bob.waitFor((m) => m.id === 1 && m.type === 'data'),
    sleep(2000).then(() => null)
  ])
  t.assert.deepStrictEqual(event && event.payload, { data: { notificationAdded: { id: 'bob' } } })
})

test('closing a client connection stops its upstream subscriptions', async (t) => {
  const { service, active } = await createTestService()
  const gateway = await createGateway(service)
  const alice = await connect(gateway)
  const bob = await connect(gateway)

  t.after(async () => {
    bob.ws.terminate()
    await gateway.close()
    await service.close()
  })

  alice.subscribe(1, 'alice')
  bob.subscribe(1, 'bob')
  await waitUntil(() => active.has('alice') && active.has('bob'), 'upstream subscriptions were not started')

  // the client goes away without sending stop
  alice.ws.terminate()

  await waitUntil(() => !active.has('alice'), 'alice upstream subscription was not stopped after disconnect')
  t.assert.ok(active.has('bob'), 'bob upstream subscription must keep running')
})
