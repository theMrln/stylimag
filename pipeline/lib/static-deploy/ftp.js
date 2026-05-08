const ftp = require('basic-ftp')
const { Readable } = require('node:stream')
const posix = require('node:path/posix')
const { getObjectBuffer } = require('../storage')

const NAME = 'ftp'

/**
 * Real FTP / FTPS adapter built on basic-ftp. Mirrors the s3 adapter's
 * deploy() contract.
 *
 * config: {
 *   host: string,                   // required
 *   port?: number,                  // default 21
 *   secure?: boolean | 'implicit',  // false (FTP), true (FTPS explicit/AUTH TLS), 'implicit' (FTPS implicit, port usually 990)
 *   prefix?: string,                // remote path prefix (e.g. "uploads/2026")
 * }
 * credentials: {
 *   user: string,
 *   password: string,
 *   rejectUnauthorized?: boolean,   // false to skip TLS cert validation (self-signed). default true.
 * }
 */

function joinPosix(...parts) {
  return parts
    .map((p) => (p || '').replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

async function deploy({ target, items, log, throwIfCancelled }) {
  const { config = {}, credentials = {} } = target
  if (!config.host) throw new Error('ftp deploy: config.host is required')
  if (!credentials.user) {
    throw new Error('ftp deploy: credentials.user is required')
  }
  if (credentials.password == null) {
    throw new Error('ftp deploy: credentials.password is required')
  }

  const client = new ftp.Client(30_000)
  // basic-ftp can be very chatty; route the protocol-level log through ours
  // when present so editors can debug auth / passive-mode failures without
  // turning on a verbose flag globally.
  client.ftp.verbose = false

  const summary = { applied: 0, dryRun: false, items: [] }
  const port = config.port || 21
  try {
    await client.access({
      host: config.host,
      port,
      user: credentials.user,
      password: credentials.password,
      secure: config.secure === undefined ? false : config.secure,
      secureOptions:
        credentials.rejectUnauthorized === false
          ? { rejectUnauthorized: false }
          : undefined,
    })
    log?.(
      `ftp connected: ${credentials.user}@${config.host}:${port}${
        config.secure ? ' (secure)' : ''
      }`
    )

    const prefix = (config.prefix || '').replace(/^\/+|\/+$/g, '')
    const ensuredDirs = new Set()

    for (const item of items) {
      if (throwIfCancelled) throwIfCancelled()
      if (!item.storageKey) {
        summary.items.push({
          ...item,
          ok: false,
          error: 'missing-storageKey',
        })
        continue
      }
      try {
        const buf = await getObjectBuffer(item.storageKey)
        const remotePath = joinPosix(prefix, item.relativePath)
        const remoteDir = posix.dirname(remotePath)

        if (
          remoteDir &&
          remoteDir !== '.' &&
          remoteDir !== '/' &&
          !ensuredDirs.has(remoteDir)
        ) {
          // ensureDir creates intermediate dirs and leaves cwd inside the
          // target. Reset cwd back to root after so the next ensureDir
          // call resolves remoteDir from the same starting point.
          await client.ensureDir(remoteDir)
          await client.cd('/')
          ensuredDirs.add(remoteDir)
        }

        await client.uploadFrom(Readable.from(buf), remotePath)
        log?.(`ftp PUT ${remotePath} (${buf.length} bytes)`)
        summary.items.push({ ...item, ok: true, key: remotePath })
        summary.applied += 1
      } catch (err) {
        log?.(`ftp PUT ${item.relativePath} FAILED: ${err.message}`)
        summary.items.push({ ...item, ok: false, error: err.message })
      }
    }
  } finally {
    try {
      client.close()
    } catch {
      /* ignore */
    }
  }
  return summary
}

module.exports = { name: NAME, deploy }
