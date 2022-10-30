'use strict'

const buildGateway = require('./gateway/build-gateway')
const {
  MER_ERR_INVALID_OPTS,
  MER_ERR_GQL_GATEWAY,
  MER_ERR_GQL_GATEWAY_INIT
} = require('./errors')
const { kHooks } = require('mercurius/lib/symbols')
const {
  onGatewayReplaceSchemaHandler,
  assignApplicationLifecycleHooksToContext
} = require('./handlers')
const { buildCache } = require('./util')

function validateGateway(opts) {
  const gateway = opts

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

async function createGateway(gatewayOpts, app) {
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

    let isModuleInitialized = false
    app.addHook('onRegister', () => {
      if (app.graphql && !isModuleInitialized) {
        isModuleInitialized = true
        onAppRegister(app.graphql)
      }
    })

    let gatewayInterval
    let gatewayRetryIntervalTimer

    // eslint-disable-next-line
    function gatewayClose() {
      /* istanbul ignore else */
      if (gatewayInterval) {
        console.log('CLEAR INTERVAL 0 , gatewayInterval')
        clearInterval(gatewayInterval)
        gatewayInterval = null
      }

      /* istanbul ignore next*/
      if (gatewayRetryIntervalTimer) {
        console.log('CLEAR INTERVAL 0 , gatewayRetryIntervalTimer')
        clearInterval(gatewayRetryIntervalTimer)
        gatewayRetryIntervalTimer = null
      }

      return gateway.close()
    }

    // eslint-disable-next-line
    function onAppRegister(fastifyGraphQl) {
      fastifyGraphQl.gateway = gateway
      const serviceMap = Object.values(gateway.serviceMap)
      const failedMandatoryServices = serviceMap.filter(
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

      if (gatewayOpts.pollingInterval !== undefined) {
        if (typeof gatewayOpts.pollingInterval === 'number') {
          console.log('----------- SET INTERVAL, gatewayInterval ------------')
          gatewayInterval = setInterval(async () => {
            try {
              const context = assignApplicationLifecycleHooksToContext(
                {},
                fastifyGraphQl[kHooks]
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

      app.onClose(async (fastify, next) => {
        await gatewayClose()
        setImmediate(next)
      })

      function retryServices(interval) {
        let retryCount = 0
        let isRetry = true

        console.log(
          '----------- SET INTERVAL, gatewayRetryIntervalTimer -------------'
        )
        return setInterval(async () => {
          try {
            if (retryCount === retryServicesCount) {
              console.log('CLEAR INTERVAL 1, gatewayRetryIntervalTimer')
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
              fastifyGraphQl[kHooks]
            )

            const schema = await gateway.refresh(isRetry)
            /* istanbul ignore next */
            if (schema !== null) {
              console.log('CLEAR INTERVAL 2, gatewayRetryIntervalTimer')
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
    }

    return {
      ...gateway,
      close: gatewayClose
    }
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
