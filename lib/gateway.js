'use strict'

const buildGateway = require('./gateway/build-gateway')
const {
  MER_ERR_INVALID_OPTS,
  MER_ERR_GQL_GATEWAY,
  MER_ERR_GQL_GATEWAY_INIT
} = require('./errors')

const {
  onGatewayReplaceSchemaHandler
} = require('./handlers')
const { buildCache } = require('./util')
const { Hooks, assignLifeCycleHooksToContext, assignApplicationLifecycleHooksToContext } = require('./hooks')

const kGatewayHooks = Symbol('mercurius.gateway.hooks')

function validateGateway (opts) {
  const gateway = opts

  if (typeof gateway.services === 'function') return

  if (Array.isArray(gateway.services)) {
    const serviceNames = new Set()
    for (const service of gateway.services) {
      if (typeof service !== 'object') {
        throw new MER_ERR_INVALID_OPTS(
          'gateway: all "services" must be objects'
        )
      }
      if (typeof service.name !== 'string') {
        throw new MER_ERR_INVALID_OPTS(
          'gateway: all "services" must have a "name" String property'
        )
      }
      if (serviceNames.has(service.name)) {
        throw new MER_ERR_INVALID_OPTS(
          `gateway: all "services" must have a unique "name": "${service.name}" is already used`
        )
      }
      serviceNames.add(service.name)
      if (
        typeof service.url !== 'string' &&
        (!Array.isArray(service.url) ||
          service.url.length === 0 ||
          !service.url.every(url => typeof url === 'string'))
      ) {
        throw new MER_ERR_INVALID_OPTS(
          'gateway: all "services" must have an "url" String, or a non-empty Array of String, property'
        )
      }
    }
  } else {
    throw new MER_ERR_GQL_GATEWAY_INIT(
      'The "services" attribute cannot be undefined'
    )
  }
}

async function createGateway (gatewayOpts, app) {
  validateGateway(gatewayOpts)

  const retryServicesCount =
    gatewayOpts && gatewayOpts.retryServicesCount
      ? gatewayOpts.retryServicesCount
      : 10

  const retryInterval = gatewayOpts.retryServicesInterval || 3000

  const lruGatewayResolvers = buildCache(gatewayOpts)

  const serviceMap = {}

  try {
    const gateway = await buildGateway(
      serviceMap,
      gatewayOpts,
      app,
      lruGatewayResolvers
    )

    gateway[kGatewayHooks] = new Hooks()

    // Wrapper that we expose to the user for GraphQL hooks handling
    gateway.addHook = function (name, fn) {
      gateway[kGatewayHooks].add(name, fn)
    }

    app.graphql.replaceSchema(gateway.schema)

    let gatewayInterval
    let gatewayRetryIntervalTimer

    // eslint-disable-next-line
    function gatewayClose() {
      /* istanbul ignore else */
      if (gatewayInterval) {
        clearInterval(gatewayInterval)
        gatewayInterval = null
      }

      /* istanbul ignore next */
      if (gatewayRetryIntervalTimer) {
        clearInterval(gatewayRetryIntervalTimer)
        gatewayRetryIntervalTimer = null
      }

      return gateway.close()
    }

    app.decorate('graphqlGateway', gateway)

    const fastifyGraphQl = app.graphql
    const failedMandatoryServices = Object.values(gateway.serviceMap).filter(
      service => !!service.error && service.mandatory
    )
    if (failedMandatoryServices.length) {
      gatewayRetryIntervalTimer = retryServices(retryInterval)
      gatewayRetryIntervalTimer.unref()
    }
    fastifyGraphQl.extendSchema = function () {
      throw new MER_ERR_GQL_GATEWAY(
        'Calling extendSchema method when gateway plugin is running is not allowed'
      )
    }

    fastifyGraphQl.defineResolvers = function () {
      throw new MER_ERR_GQL_GATEWAY(
        'Calling defineResolvers method when gateway plugin is running is not allowed'
      )
    }

    fastifyGraphQl.defineLoaders = function () {
      throw new MER_ERR_GQL_GATEWAY(
        'Calling defineLoaders method when gateway plugin is running is not allowed'
      )
    }

    // eslint-disable-next-line
    if (gatewayOpts.pollingInterval !== undefined) {
      if (typeof gatewayOpts.pollingInterval === 'number') {
        gatewayInterval = setInterval(async () => {
          try {
            const context = assignApplicationLifecycleHooksToContext(
              {},
              gateway[kGatewayHooks]
            )
            const schema = await gateway.refresh()
            if (schema !== null) {
              // Trigger onGatewayReplaceSchema hook
              if (context.onGatewayReplaceSchema !== null) {
                await onGatewayReplaceSchemaHandler(context, {
                  instance: app,
                  schema
                })
              }

              /* istanbul ignore else */
              if (lruGatewayResolvers) {
                lruGatewayResolvers.clear()
              }
              fastifyGraphQl.replaceSchema(schema)
            }
          } catch (error) {
            app.log.error(error)
          }
        }, gatewayOpts.pollingInterval)
      } else {
        app.log.warn(
          `Expected a number for 'gateway.pollingInterval', received: ${typeof gatewayOpts.pollingInterval}`
        )
      }
    }

    app.onClose((fastify, next) => {
      gatewayClose().then(() => setImmediate(next))
    })

    // eslint-disable-next-line no-inner-declarations
    function retryServices (interval) {
      let retryCount = 0
      let isRetry = true

      return setInterval(async () => {
        try {
          if (retryCount === retryServicesCount) {
            /* istanbul ignore else */
            if (gatewayRetryIntervalTimer) {
              clearInterval(gatewayRetryIntervalTimer)
              gatewayRetryIntervalTimer = null
            }
            isRetry = false
          }
          retryCount++

          const context = assignApplicationLifecycleHooksToContext(
            {},
            gateway[kGatewayHooks]
          )

          const schema = await gateway.refresh(isRetry)
          /* istanbul ignore next */
          if (schema !== null) {
            if (gatewayRetryIntervalTimer) {
              clearInterval(gatewayRetryIntervalTimer)
              gatewayRetryIntervalTimer = null
            }
            // Trigger onGatewayReplaceSchema hook
            if (context.onGatewayReplaceSchema !== null) {
              await onGatewayReplaceSchemaHandler(context, {
                instance: app,
                schema
              })
            }
            /* istanbul ignore else */
            if (lruGatewayResolvers) {
              lruGatewayResolvers.clear()
            }
            fastifyGraphQl.replaceSchema(schema)
          }
        } catch (error) {
          app.log.error(error)
        }
      }, interval)
    }

    fastifyGraphQl.addHook('preExecution', async (schema, document, context) => {
      context.gateway = assignApplicationLifecycleHooksToContext(assignLifeCycleHooksToContext(gateway, gateway[kGatewayHooks]), gateway[kGatewayHooks])
    })

    fastifyGraphQl.addHook('preSubscriptionExecution', async (schema, document, context) => {
      context.gateway = assignApplicationLifecycleHooksToContext(assignLifeCycleHooksToContext(gateway, gateway[kGatewayHooks]), gateway[kGatewayHooks])
    })

    fastifyGraphQl.addHook('onSubscriptionEnd', async (context, id) => {
      if (!id || !gateway.subscriptionMap.has(id)) {
        return
      }

      const { serviceName, subscriptionId } = gateway.subscriptionMap.get(id)
      const service = gateway.serviceMap[serviceName]
      service.unsubscribe(subscriptionId)

      gateway.subscriptionMap.delete(id)
    })

    return gateway
  } catch (e) {
    for (const service of Object.values(serviceMap)) {
      /* istanbul ignore next */
      if (service.close) {
        await service.close()
      }
    }
    throw e
  }
}

module.exports = {
  validateGateway,
  createGateway
}
