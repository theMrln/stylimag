const { Storage } = require('@google-cloud/storage')
const { getObjectBuffer } = require('../storage')

const NAME = 'gcs'

/**
 * Real Google Cloud Storage adapter. Mirrors the s3 adapter contract.
 *
 * config: {
 *   bucket: string,                   // required
 *   projectId?: string,               // optional; derived from credentials
 *   prefix?: string,                  // remote object-name prefix
 *   predefinedAcl?: string,           // e.g. 'publicRead' | 'private' | 'projectPrivate'
 *   cacheControl?: string,            // forwarded onto every uploaded object
 *   apiEndpoint?: string,             // for GCS-emulator / fake-gcs-server
 * }
 *
 * credentials:
 *   The full service-account JSON object (the file you download from
 *   GCP IAM). At minimum: { client_email, private_key }. The library
 *   accepts the rest of the JSON unchanged.
 *
 *   In dev / test you may instead pass `{ keyFilename: "/path/in/container" }`,
 *   but storing a path is meaningless across deploys, so the structured
 *   service-account-JSON shape is the recommended one.
 */

function makeStorage(target) {
  const { config = {}, credentials = {} } = target
  if (!config.bucket) throw new Error('gcs deploy: config.bucket is required')

  const opts = {}
  if (config.projectId) opts.projectId = config.projectId
  if (config.apiEndpoint) opts.apiEndpoint = config.apiEndpoint

  // Two valid credential shapes: service-account JSON, or keyFilename.
  if (credentials.keyFilename) {
    opts.keyFilename = credentials.keyFilename
  } else if (credentials.client_email && credentials.private_key) {
    opts.credentials = {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    }
    if (!opts.projectId && credentials.project_id) {
      opts.projectId = credentials.project_id
    }
  } else {
    throw new Error(
      'gcs deploy: credentials must include service-account fields ' +
        '(client_email, private_key) or a keyFilename'
    )
  }

  return new Storage(opts)
}

function guessContentType(key) {
  if (key.endsWith('.pdf')) return 'application/pdf'
  if (key.endsWith('.html')) return 'text/html; charset=utf-8'
  if (key.endsWith('.css')) return 'text/css; charset=utf-8'
  if (key.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

async function deploy({ target, items, log, throwIfCancelled }) {
  const storage = makeStorage(target)
  const bucketName = target.config.bucket
  const prefix = (target.config.prefix || '').replace(/^\/+|\/+$/g, '')
  const predefinedAcl = target.config.predefinedAcl || undefined
  const cacheControl = target.config.cacheControl || undefined

  // Fail fast on missing/inaccessible bucket so the per-item summary
  // doesn't echo the same error N times.
  const bucket = storage.bucket(bucketName)
  const [exists] = await bucket.exists()
  if (!exists) {
    throw new Error(`gcs deploy: bucket "${bucketName}" not found or unreachable`)
  }

  const summary = { applied: 0, dryRun: false, items: [] }
  for (const item of items) {
    if (throwIfCancelled) throwIfCancelled()
    if (!item.storageKey) {
      summary.items.push({ ...item, ok: false, error: 'missing-storageKey' })
      continue
    }
    try {
      const buf = await getObjectBuffer(item.storageKey)
      const objectName = prefix
        ? `${prefix}/${item.relativePath}`
        : item.relativePath
      const file = bucket.file(objectName)
      await file.save(buf, {
        contentType: item.mimeType || guessContentType(objectName),
        resumable: false, // small artefacts; one HTTP roundtrip per file
        predefinedAcl,
        metadata: cacheControl ? { cacheControl } : undefined,
      })
      log?.(`gcs PUT gs://${bucketName}/${objectName} (${buf.length} bytes)`)
      summary.items.push({ ...item, ok: true, key: objectName })
      summary.applied += 1
    } catch (err) {
      log?.(`gcs PUT ${item.relativePath} FAILED: ${err.message}`)
      summary.items.push({ ...item, ok: false, error: err.message })
    }
  }
  return summary
}

module.exports = { name: NAME, deploy }
