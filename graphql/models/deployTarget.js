const mongoose = require('mongoose')
const Schema = mongoose.Schema

/**
 * A static-deploy destination for built publishing artefacts.
 *
 * Targets are workspace-scoped (so editors can share them across the
 * journals in their workspace) but a single corpus pins the one it deploys
 * to via `corpus.pipelineSettings.staticDeployTargetId`.
 *
 * Credentials are stored opaquely in `secret` after passing through
 * helpers/credentials.js encrypt() — never read this field directly; use
 * the helpers/deployTargets.js wrappers to load+decrypt.
 */
const deployTargetSchema = new Schema(
  {
    name: { type: String, required: true },
    kind: {
      type: String,
      required: true,
      enum: ['s3', 'ftp', 'gcs', 'netlify'],
      index: true,
    },
    workspace: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      index: true,
    },
    creator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    /**
     * Public, non-secret config (bucket name, host, region, prefix, …).
     * Schema is deliberately loose — each adapter validates its own shape.
     */
    config: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    /**
     * Opaque encrypted blob from helpers/credentials.js. Contents depend on
     * the kind (e.g. {accessKey, secretKey} for s3, {user, password} for
     * ftp, {token} for netlify). Never returned to GraphQL clients.
     */
    secret: { type: String, default: '' },
  },
  { timestamps: true }
)

deployTargetSchema.statics.findByWorkspace = function findByWorkspace(
  workspaceId
) {
  return this.find({ workspace: workspaceId }).sort({ updatedAt: -1 })
}

module.exports = mongoose.model('DeployTarget', deployTargetSchema)
