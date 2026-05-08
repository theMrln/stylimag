const DeployTarget = require('../models/deployTarget.js')
const Workspace = require('../models/workspace.js')
const Corpus = require('../models/corpus.js')
const PipelineJob = require('../models/pipelineJob.js')
const ExportArtifact = require('../models/exportArtifact.js')
const { encrypt, decrypt } = require('../helpers/credentials.js')
const pipelineClient = require('../helpers/pipelineClient.js')
const {
  NotAuthenticatedError,
  NotFoundError,
  NotAuthorizedError,
  BadRequestError,
} = require('../helpers/errors.js')
const { logger } = require('../logger.js')

const KINDS = ['s3', 'ftp', 'gcs', 'netlify']

async function ensureWorkspaceMembership(workspaceId, user) {
  if (!workspaceId) return null
  const ws = await Workspace.findOne({
    _id: workspaceId,
    'members.user': user._id,
  })
  if (!ws) {
    throw new NotAuthorizedError(
      'You are not a member of the requested workspace'
    )
  }
  return ws
}

async function loadTargetForUser(targetId, user) {
  const target = await DeployTarget.findById(targetId)
  if (!target) throw new NotFoundError('DeployTarget', targetId)
  if (target.workspace) {
    await ensureWorkspaceMembership(target.workspace, user)
  } else if (
    target.creator &&
    target.creator.toString() !== user._id.toString()
  ) {
    throw new NotAuthorizedError('Not your deploy target')
  }
  return target
}

module.exports = {
  Query: {
    async deployTargets(_, { workspaceId }, { user }) {
      if (!user) throw new NotAuthenticatedError()
      if (workspaceId) {
        await ensureWorkspaceMembership(workspaceId, user)
        return DeployTarget.findByWorkspace(workspaceId)
      }
      return DeployTarget.find({ creator: user._id }).sort({ updatedAt: -1 })
    },

    async deployTarget(_, { id }, { user }) {
      if (!user) throw new NotAuthenticatedError()
      return loadTargetForUser(id, user)
    },
  },

  Mutation: {
    async createDeployTarget(_, { input }, { user }) {
      if (!user) throw new NotAuthenticatedError()
      if (!KINDS.includes(input.kind)) {
        throw new BadRequestError(`kind must be one of ${KINDS.join(', ')}`)
      }
      if (input.workspaceId) {
        await ensureWorkspaceMembership(input.workspaceId, user)
      }
      const target = await DeployTarget.create({
        name: input.name,
        kind: input.kind,
        workspace: input.workspaceId || undefined,
        creator: user._id,
        config: input.config || {},
        secret: encrypt(input.credentials || null),
      })
      return target
    },

    async updateDeployTarget(_, { id, input }, { user }) {
      if (!user) throw new NotAuthenticatedError()
      const target = await loadTargetForUser(id, user)
      if (input.name !== undefined) target.name = input.name
      if (input.config !== undefined) target.config = input.config
      if (input.credentials !== undefined) {
        target.secret = encrypt(input.credentials)
      }
      await target.save()
      return target
    },

    async deleteDeployTarget(_, { id }, { user }) {
      if (!user) throw new NotAuthenticatedError()
      const target = await loadTargetForUser(id, user)
      await target.deleteOne()
      return true
    },

    /**
     * Kick off a static-deploy job. Gathers every "ready" ExportArtifact
     * the corpus has produced and pushes them via the configured target.
     */
    async startStaticDeploy(_, { corpusId, targetId, dryRun = false }, { user }) {
      if (!user) throw new NotAuthenticatedError()
      if (!(await pipelineClient.isConfigured())) {
        throw new BadRequestError('Pipeline service is not configured')
      }
      const corpus = await Corpus.findById(corpusId)
      if (!corpus) throw new NotFoundError('Corpus', corpusId)
      const targetIdToUse =
        targetId || corpus.pipelineSettings?.staticDeployTargetId || null
      if (!targetIdToUse) {
        throw new BadRequestError(
          'No deploy target supplied and corpus has no default'
        )
      }
      const target = await loadTargetForUser(targetIdToUse, user)

      const artefacts = await ExportArtifact.find({
        corpus: corpus._id,
        status: 'ready',
      })
        .sort({ createdAt: -1 })
        .lean()
      if (artefacts.length === 0) {
        throw new BadRequestError(
          'Corpus has no ready artefacts to deploy. Build first.'
        )
      }

      // Best-effort de-dupe by storageKey (latest wins after the
      // createdAt-desc sort above).
      const seen = new Set()
      const items = []
      for (const a of artefacts) {
        if (!a.storageKey || seen.has(a.storageKey)) continue
        seen.add(a.storageKey)
        items.push({
          storageKey: a.storageKey,
          kind: a.kind,
          mimeType: a.mimeType,
          relativePath: deriveRelativePath(a),
        })
      }

      const job = await PipelineJob.create({
        type: 'static-deploy',
        status: 'queued',
        corpus: corpus._id,
        workspace: corpus.workspace || undefined,
        triggeredBy: user._id,
        params: {
          corpusId: corpus._id.toString(),
          targetId: target._id.toString(),
          targetName: target.name,
          targetKind: target.kind,
          itemCount: items.length,
          dryRun: Boolean(dryRun),
        },
      })
      try {
        const remote = await pipelineClient.startJob({
          type: 'static-deploy',
          params: {
            corpusId: corpus._id.toString(),
            target: {
              kind: target.kind,
              config: target.config || {},
              credentials: decrypt(target.secret),
            },
            items,
            dryRun: Boolean(dryRun),
          },
        })
        job.remoteJobId = remote.id
        job.status = remote.status || 'queued'
        await job.save()
      } catch (err) {
        logger.warn(
          { err, corpusId, targetId: target._id?.toString() },
          'startStaticDeploy: pipeline rejected'
        )
        job.status = 'failed'
        job.error = err.message
        await job.save()
        throw err
      }
      return job
    },
  },

  DeployTarget: {
    /**
     * Surface whether credentials are present without leaking them.
     */
    hasCredentials(target) {
      return Boolean(target?.secret && target.secret.length > 0)
    },
  },
}

function deriveRelativePath(artefact) {
  const ext =
    artefact.format ||
    (artefact.mimeType && artefact.mimeType.includes('html') ? 'html' : 'pdf')
  if (artefact.kind === 'article-pdf' || artefact.kind === 'article-html') {
    return `articles/${artefact.article || 'unknown'}.${ext}`
  }
  if (artefact.kind === 'article-cover') {
    return `covers/${artefact.article || 'unknown'}.${ext}`
  }
  if (artefact.kind === 'toc') return `toc.${ext}`
  if (artefact.kind === 'front-page') return `front-page.${ext}`
  if (artefact.kind === 'complete-issue') return `issue.${ext}`
  return `assets/${artefact._id}.${ext}`
}
