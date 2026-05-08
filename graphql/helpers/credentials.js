const crypto = require('node:crypto')
const config = require('../config.js')
const { logger } = require('../logger.js')

/**
 * AES-256-GCM symmetric encryption for stored credentials. The key is
 * a base64-encoded 32-byte secret loaded from CREDENTIAL_ENCRYPTION_KEY.
 *
 * Empty key (development default) disables encryption-at-rest: payloads
 * are stored as JSON strings prefixed with `plain:`. The dual mode keeps
 * local docker-compose runs ergonomic while making it trivial to spot any
 * environment that's missing the key in production logs.
 *
 * Encrypted format: base64-encoded `${iv|tag|ciphertext}` with a `enc:`
 * prefix so decode() can route on the prefix without a separate type
 * column on every model.
 */

const PREFIX_PLAIN = 'plain:'
const PREFIX_ENCRYPTED = 'enc:'
const IV_LEN = 12
const TAG_LEN = 16

let cachedKey = null
let warnedNoKey = false

function loadKey() {
  if (cachedKey !== null) return cachedKey
  const raw = config.get('credentials.encryptionKey')
  if (!raw) {
    cachedKey = false
    return false
  }
  const buf = Buffer.from(raw, 'base64')
  if (buf.length !== 32) {
    logger.error(
      `CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes; got ${buf.length}. Falling back to plaintext storage.`
    )
    cachedKey = false
    return false
  }
  cachedKey = buf
  return cachedKey
}

function encrypt(payload) {
  const json = JSON.stringify(payload ?? null)
  const key = loadKey()
  if (!key) {
    if (!warnedNoKey) {
      warnedNoKey = true
      logger.warn(
        'CREDENTIAL_ENCRYPTION_KEY is unset; storing credentials as plaintext (dev mode).'
      )
    }
    return PREFIX_PLAIN + json
  }
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(json, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  const blob = Buffer.concat([iv, tag, ciphertext])
  return PREFIX_ENCRYPTED + blob.toString('base64')
}

function decrypt(value) {
  if (value == null || value === '') return null
  if (typeof value !== 'string') return null
  if (value.startsWith(PREFIX_PLAIN)) {
    try {
      return JSON.parse(value.slice(PREFIX_PLAIN.length))
    } catch {
      return null
    }
  }
  if (value.startsWith(PREFIX_ENCRYPTED)) {
    const key = loadKey()
    if (!key) {
      throw new Error(
        'cannot decrypt: CREDENTIAL_ENCRYPTION_KEY missing'
      )
    }
    const blob = Buffer.from(value.slice(PREFIX_ENCRYPTED.length), 'base64')
    if (blob.length < IV_LEN + TAG_LEN) {
      throw new Error('encrypted credential blob too short')
    }
    const iv = blob.subarray(0, IV_LEN)
    const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN)
    const ciphertext = blob.subarray(IV_LEN + TAG_LEN)
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const json = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8')
    try {
      return JSON.parse(json)
    } catch {
      return null
    }
  }
  // Legacy / unknown encoding — try parsing as raw JSON.
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

module.exports = { encrypt, decrypt }
