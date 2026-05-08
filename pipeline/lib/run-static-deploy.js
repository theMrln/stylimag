const { dispatchDeploy } = require('./static-deploy')

/**
 * Static-deploy job runner: pushes the supplied artefact list to the
 * configured target. Job params shape:
 *   { corpusId, target: { kind, config, credentials }, items, dryRun }
 *
 * The summary returned by the adapter is stashed under params.summary so
 * the graphql resolver can tee it onto the local PipelineJob and the UI
 * can render per-item outcome on the dashboard.
 */
async function runStaticDeployJob({ job, jobs }) {
  const { target, items, dryRun } = job.params || {}
  const log = (msg) => jobs.appendLog(job.id, msg)
  jobs.setStatus(job.id, 'running')
  if (!target) {
    jobs.fail(job.id, new Error('params.target is required'))
    return
  }
  log(
    `static-deploy: target=${target.kind}, items=${items?.length ?? 0}, dryRun=${Boolean(dryRun)}`
  )
  let summary
  try {
    summary = await dispatchDeploy({
      target,
      items: items || [],
      dryRun: Boolean(dryRun),
      log,
      throwIfCancelled: () => jobs.throwIfCancelled(job.id),
    })
  } catch (err) {
    if (err?.cancelled) throw err
    jobs.fail(job.id, err)
    return
  }
  log(
    `static-deploy: applied=${summary.applied}/${summary.items.length}` +
      (summary.dryRun ? ' (dry-run)' : '')
  )
  // Drop credentials from the persisted params before reporting upstream —
  // graphql tees params back into Mongo and we never want secrets there.
  const safeParams = { ...job.params }
  if (safeParams.target) {
    safeParams.target = {
      kind: safeParams.target.kind,
      config: safeParams.target.config,
    }
  }
  safeParams.summary = summary
  jobs.setStatus(job.id, 'succeeded', { params: safeParams })
}

module.exports = { runStaticDeployJob }
