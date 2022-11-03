const plugin = require('./lib/plugin')
const buildFederationSchema = require('./lib/federation')

plugin.buildFederationSchema = buildFederationSchema

module.exports = plugin
