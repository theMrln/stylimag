/**
 * GCS deploy adapter — stub. Same shape as s3.js. Real implementation
 * would import @google-cloud/storage, instantiate Storage with a service
 * account JSON in credentials, then upload each item to
 * `bucket.file(prefix + item.relativePath)`.
 */

const NAME = 'gcs'

async function deploy({ items }) {
  return {
    applied: 0,
    dryRun: false,
    items: items.map((item) => ({
      ...item,
      ok: false,
      error: 'gcs adapter not yet implemented in this build',
    })),
  }
}

module.exports = { name: NAME, deploy }
