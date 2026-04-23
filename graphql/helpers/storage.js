const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const config = require('../config.js')
const { logger } = require('../logger')

let clientSingleton = null
let bucketEnsuredP = null

/**
 * Returns true when object storage is configured and usable.
 */
function isStorageConfigured() {
  return Boolean(
    config.get('storage.endpoint') &&
      config.get('storage.bucket') &&
      config.get('storage.accessKey') &&
      config.get('storage.secretKey')
  )
}

/**
 * Lazily build an S3 client for the configured endpoint.
 * @returns {S3Client}
 */
function getClient() {
  if (clientSingleton) {
    return clientSingleton
  }
  if (!isStorageConfigured()) {
    throw new Error(
      'Object storage is not configured (STORAGE_ENDPOINT/STORAGE_BUCKET/STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY)'
    )
  }
  clientSingleton = new S3Client({
    endpoint: config.get('storage.endpoint'),
    region: config.get('storage.region'),
    forcePathStyle: config.get('storage.forcePathStyle'),
    credentials: {
      accessKeyId: config.get('storage.accessKey'),
      secretAccessKey: config.get('storage.secretKey'),
    },
  })
  return clientSingleton
}

/**
 * Ensure the configured bucket exists; safe to call multiple times.
 */
async function ensureBucket() {
  if (!bucketEnsuredP) {
    const bucket = config.get('storage.bucket')
    const client = getClient()
    bucketEnsuredP = (async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }))
      } catch (err) {
        const status = err?.$metadata?.httpStatusCode
        if (status === 404 || err?.name === 'NotFound') {
          logger.info({ bucket }, 'Creating object storage bucket')
          await client.send(new CreateBucketCommand({ Bucket: bucket }))
        } else {
          logger.warn(
            { err, bucket },
            'Object storage bucket head check failed'
          )
          throw err
        }
      }
    })().catch((err) => {
      bucketEnsuredP = null
      throw err
    })
  }
  return bucketEnsuredP
}

/**
 * Upload an object to the configured bucket.
 * @param {object} args
 * @param {string} args.key - object key in the bucket
 * @param {Buffer} args.body
 * @param {string} args.contentType
 */
async function putObject({ key, body, contentType }) {
  await ensureBucket()
  const client = getClient()
  await client.send(
    new PutObjectCommand({
      Bucket: config.get('storage.bucket'),
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
}

/**
 * Retrieve an object from storage. Returns a GetObjectCommand response
 * whose `Body` is a readable stream (Node).
 * @param {string} key
 */
async function getObject(key) {
  const client = getClient()
  return client.send(
    new GetObjectCommand({
      Bucket: config.get('storage.bucket'),
      Key: key,
    })
  )
}

/**
 * Remove an object from storage.
 * @param {string} key
 */
async function deleteObject(key) {
  const client = getClient()
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.get('storage.bucket'),
      Key: key,
    })
  )
}

/**
 * Build a pre-signed GET URL for an object. Useful for out-of-band
 * consumers (e.g. export pipelines) that cannot hit the backend directly.
 * @param {string} key
 * @param {number} [expiresInSeconds=300]
 */
async function getPresignedGetUrl(key, expiresInSeconds = 300) {
  const client = getClient()
  return getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: config.get('storage.bucket'),
      Key: key,
    }),
    { expiresIn: expiresInSeconds }
  )
}

module.exports = {
  isStorageConfigured,
  ensureBucket,
  putObject,
  getObject,
  deleteObject,
  getPresignedGetUrl,
}
