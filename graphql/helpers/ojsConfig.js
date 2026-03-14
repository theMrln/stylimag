const path = require('path')
const fs = require('fs')
const { logger } = require('../logger')

const CONFIG_PATH = path.resolve(process.cwd(), 'config', 'ojs.json')

let cachedConfig = null

/**
 * Load OJS instance config from config/ojs.json (staging and production).
 * File should not be committed; use config/ojs.example.json as template.
 * @returns {{ staging?: { api_endpoint: string, api_token: string }, production?: { api_endpoint: string, api_token: string } }}
 */
function loadOjsConfig() {
  if (cachedConfig != null) {
    return cachedConfig
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    cachedConfig = JSON.parse(raw)
    return cachedConfig
  } catch (err) {
    if (err.code === 'ENOENT') {
      logger.warn(
        'OJS config not found at config/ojs.json; copy from config/ojs.example.json'
      )
    } else {
      logger.warn({ err }, 'Failed to load OJS config')
    }
    cachedConfig = {}
    return cachedConfig
  }
}

/**
 * Get config for a single OJS instance.
 * @param {'staging'|'production'} instance
 * @returns {{ api_endpoint: string, api_token: string }|null}
 */
const OJS_INSTANCES = ['staging', 'production']

function getOjsInstanceConfig(instance) {
  if (!OJS_INSTANCES.includes(instance)) return null
  const fullConfig = loadOjsConfig()
  const instanceConfig =
    instance === 'staging' ? fullConfig.staging : fullConfig.production
  if (!instanceConfig?.api_endpoint || !instanceConfig?.api_token) {
    return null
  }
  return {
    api_endpoint: instanceConfig.api_endpoint.replace(/\/$/, ''),
    api_token: instanceConfig.api_token,
  }
}

/**
 * List available OJS instance names that have valid config.
 * @returns {('staging'|'production')[]}
 */
function getAvailableOjsInstances() {
  const instances = []
  if (getOjsInstanceConfig('staging')) instances.push('staging')
  if (getOjsInstanceConfig('production')) instances.push('production')
  return instances
}

module.exports = {
  loadOjsConfig,
  getOjsInstanceConfig,
  getAvailableOjsInstances,
}
