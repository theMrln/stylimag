const mongoose = require('mongoose')
const Schema = mongoose.Schema

/**
 * An `ExportArtifact` tracks a generated output (HTML/PDF/...) for a given
 * article/version. The actual file lives in object storage under `storageKey`.
 *
 * This model is a persistence stub: the current export pipeline is handled
 * by an external pandoc service. It will be populated once export outputs
 * are persisted via the backend.
 */
const exportArtifactSchema = new Schema(
  {
    article: {
      type: Schema.Types.ObjectId,
      ref: 'Article',
      required: true,
      index: true,
    },
    version: {
      type: Schema.Types.ObjectId,
      ref: 'Version',
      index: true,
    },
    workspace: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      index: true,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    format: {
      type: String,
      enum: ['html', 'pdf', 'docx', 'tex', 'epub', 'other'],
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'ready', 'failed'],
      default: 'pending',
      index: true,
    },
    storageKey: {
      type: String,
    },
    mimeType: {
      type: String,
    },
    size: {
      type: Number,
    },
    optionsHash: {
      type: String,
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('ExportArtifact', exportArtifactSchema)
