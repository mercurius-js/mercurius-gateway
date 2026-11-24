'use strict'

// Operation ids are chosen by the client and are only unique within one
// WebSocket connection, so subscriptions are tracked per connection
// (keyed by the connection's upgrade request) and then by operation id.
const kNoConnection = {}

function getConnectionKey (context) {
  return context.request || kNoConnection
}

function trackSubscription (subscriptionMap, context, service, subscriptionId) {
  const connectionKey = getConnectionKey(context)
  let subscriptions = subscriptionMap.get(connectionKey)
  if (!subscriptions) {
    subscriptions = new Map()
    subscriptionMap.set(connectionKey, subscriptions)
  }

  const id = context.id
  let released = false

  const entry = {
    serviceName: service.name,
    subscriptionId,
    release () {
      if (released) {
        return
      }
      released = true

      if (subscriptions.get(id) === entry) {
        subscriptions.delete(id)
      }

      try {
        service.unsubscribe(subscriptionId)
      } catch (err) {
        /* istanbul ignore next */
        if (context.app && context.app.log) {
          context.app.log.warn({ err, serviceName: service.name }, 'failed to unsubscribe from the service')
        }
      }
    }
  }

  subscriptions.set(id, entry)
  return entry
}

function releaseSubscription (subscriptionMap, context, id) {
  const subscriptions = subscriptionMap.get(getConnectionKey(context))
  const entry = subscriptions && subscriptions.get(id)
  if (entry) {
    entry.release()
  }
}

// Releases the upstream subscription however the client subscription ends:
// stop message, client disconnect, completion or error.
async function * releaseOnEnd (events, entry) {
  try {
    for await (const event of events) {
      yield event
    }
  } finally {
    entry.release()
  }
}

module.exports = {
  trackSubscription,
  releaseSubscription,
  releaseOnEnd
}
