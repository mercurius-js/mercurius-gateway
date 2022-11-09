'use strict'

const path = require('path')

module.exports = {
  app: {
    port: 3001
  },
  log: { pretty: true },
  autoload: [{ path: path.join(__dirname, './plugins') }],
  graphql: { graphiql: true }
}
