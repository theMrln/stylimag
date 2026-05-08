const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} = require('@aws-sdk/client-s3')

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk instanceof Buffer ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { logger } = require('./logger')

const config = {
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION || 'us-east-1',
  bucket: process.env.STORAGE_BUCKET,
  accessKey: process.env.STORAGE_ACCESS_KEY,
  secretKey: process.env.STORAGE_SECRET_KEY,
  forcePathStyle: process.env.STORAGE_FORCE_PATH_STYLE !== 'false',
}

let clientSingleton = null
let bucketEnsuredP = null

function isStorageConfigured() {
  return Boolean(
    config.endpoint && config.bucket && config.accessKey && config.secretKey
  )
}

function getClient() {
  if (clientSingleton) return clientSingleton
  if (!isStorageConfigured()) {
    throw new Error(
      'Object storage is not configured (STORAGE_ENDPOINT/STORAGE_BUCKET/STORAGE_ACCESS_KEY/STORAGE_SECRET_KEY)'
    )
  }
  clientSingleton = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKey,
      secretAccessKey: config.secretKey,
    },
  })
  return clientSingleton
}

async function ensureBucket() {
  if (bucketEnsuredP) return bucketEnsuredP
  const client = getClient()
  bucketEnsuredP = (async () => {
    try {
      await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
    } catch (err) {
      const status = err?.$metadata?.httpStatusCode
      if (status === 404 || err?.name === 'NotFound') {
        logger.info({ bucket: config.bucket }, 'Creating object storage bucket')
        await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
      } else {
        throw err
      }
    }
  })().catch((err) => {
    bucketEnsuredP = null
    throw err
  })
  return bucketEnsuredP
}

async function putObject({ key, body, contentType }) {
  await ensureBucket()
  const client = getClient()
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
  return { key, bucket: config.bucket }
}

async function getObjectBuffer(key) {
  const client = getClient()
  const res = await client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key })
  )
  return streamToBuffer(res.Body)
}

async function getPresignedGetUrl(key, expiresInSeconds = 600) {
  const client = getClient()
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: expiresInSeconds }
  )
}

module.exports = {
  isStorageConfigured,
  ensureBucket,
  putObject,
  getObjectBuffer,
  getPresignedGetUrl,
  bucket: () => config.bucket,
}
