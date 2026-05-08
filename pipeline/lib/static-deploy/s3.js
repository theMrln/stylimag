const {
  S3Client,
  PutObjectCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3')
const { getObjectBuffer } = require('../storage')

/**
 * Real S3 adapter. The corpus's deploy-time bucket is unrelated to the
 * MinIO bucket we read intermediate artefacts from — config tells us where
 * to push the public-facing copies.
 *
 * config: {
 *   endpoint?: string,    // omit for AWS S3
 *   region: string,
 *   bucket: string,
 *   prefix?: string,      // optional path prefix, e.g. "issues/2026-05/"
 *   forcePathStyle?: boolean,
 *   acl?: 'public-read' | 'private',
 * }
 * credentials: {
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   sessionToken?: string,
 * }
 */

const NAME = 's3'

function makeClient(target) {
  const { config = {}, credentials = {} } = target
  if (!config.bucket) throw new Error('s3 deploy: config.bucket is required')
  if (!credentials.accessKeyId || !credentials.secretAccessKey) {
    throw new Error(
      's3 deploy: credentials.accessKeyId / secretAccessKey are required'
    )
  }
  return new S3Client({
    endpoint: config.endpoint || undefined,
    region: config.region || 'us-east-1',
    forcePathStyle: Boolean(config.forcePathStyle),
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
      sessionToken: credentials.sessionToken,
    },
  })
}

async function deploy({ target, items, log, throwIfCancelled }) {
  const client = makeClient(target)
  const bucket = target.config.bucket
  const prefix = (target.config.prefix || '').replace(/^\/+|\/+$/g, '')
  const acl = target.config.acl || undefined

  // Surfacing 'bucket missing' as a clear error rather than per-object failure.
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }))
  } catch (err) {
    throw new Error(
      `s3 deploy: cannot reach bucket "${bucket}" (${err.message})`
    )
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
      const key = prefix
        ? `${prefix}/${item.relativePath}`
        : item.relativePath
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buf,
          ContentType: item.mimeType || guessContentType(key),
          ACL: acl,
        })
      )
      log?.(`s3 PUT ${key} (${buf.length} bytes)`)
      summary.items.push({ ...item, ok: true, key })
      summary.applied += 1
    } catch (err) {
      log?.(`s3 PUT ${item.relativePath} FAILED: ${err.message}`)
      summary.items.push({ ...item, ok: false, error: err.message })
    }
  }
  return summary
}

function guessContentType(key) {
  if (key.endsWith('.pdf')) return 'application/pdf'
  if (key.endsWith('.html')) return 'text/html; charset=utf-8'
  if (key.endsWith('.css')) return 'text/css; charset=utf-8'
  if (key.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

module.exports = { name: NAME, deploy }
