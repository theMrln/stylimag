const s3Adapter = require('./s3')
const ftpAdapter = require('./ftp')
const gcsAdapter = require('./gcs')
const netlifyAdapter = require('./netlify')

const ADAPTERS = {
  s3: s3Adapter,
  ftp: ftpAdapter,
  gcs: gcsAdapter,
  netlify: netlifyAdapter,
}

/**
 * Dispatch a deploy-job's items to the configured adapter. Each adapter
 * decides how to translate `items` (S3 keys + relative paths) into its
 * destination — uploading objects, PUT-ing files, etc. — and reports a
 * per-item summary.
 *
 * The dispatcher itself is stateless. It is responsible for:
 *  - selecting the adapter
 *  - validating top-level shape
 *  - in dry-run mode: returning the resolved plan without calling the
 *    adapter at all
 *  - delegating credential interpretation to the adapter
 */
async function dispatchDeploy({ target, items, dryRun, log, throwIfCancelled }) {
  if (!target || !target.kind) {
    throw new Error('deploy target is missing or has no kind')
  }
  const adapter = ADAPTERS[target.kind]
  if (!adapter) {
    throw new Error(`unknown deploy-target kind: ${target.kind}`)
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { applied: 0, dryRun: Boolean(dryRun), items: [] }
  }
  if (dryRun) {
    log?.(
      `dry-run: would deploy ${items.length} item(s) via ${target.kind} (${adapter.name || 'adapter'})`
    )
    return {
      applied: 0,
      dryRun: true,
      items: items.map((item) => ({ ...item, ok: true, dryRun: true })),
    }
  }
  log?.(`deploying ${items.length} item(s) via ${target.kind}`)
  return adapter.deploy({ target, items, log, throwIfCancelled })
}

module.exports = { dispatchDeploy }
