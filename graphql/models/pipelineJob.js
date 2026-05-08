const mongoose = require('mongoose')
const Schema = mongoose.Schema

/**
 * Tracks a single publishing-pipeline job (article-pdf, covers, TOC, …).
 * The actual work runs in the `pipeline` service; this model is the durable
 * state graphql owns: who triggered it, current status, and references to
 * any ExportArtifacts the job produced.
 */
const pipelineJobSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: [
        'article-pdf',
        'article-html',
        'article-cover',
        'toc',
        'front-page',
        'complete-issue',
        'batch',
        'page-numbers',
        'static-deploy',
      ],
      index: true,
    },
    /** Set when the user opted to dry-run rather than apply the deploy. */
    dryRun: { type: Boolean, default: false },
    status: {
      type: String,
      required: true,
      enum: ['queued', 'running', 'succeeded', 'failed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    /** Pipeline-service-side job id (uuid). */
    remoteJobId: {
      type: String,
      index: true,
    },
    article: {
      type: Schema.Types.ObjectId,
      ref: 'Article',
      index: true,
    },
    corpus: {
      type: Schema.Types.ObjectId,
      ref: 'Corpus',
      index: true,
    },
    workspace: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      index: true,
    },
    triggeredBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    params: {
      type: Schema.Types.Mixed,
      default: {},
    },
    progress: {
      type: Number,
      default: 0,
      min: 0,
      max: 1,
    },
    /** Capped tail of pipeline-service logs (~32KB). Live logs stream over SSE. */
    logsTail: {
      type: String,
      default: '',
    },
    artefacts: [
      {
        type: Schema.Types.ObjectId,
        ref: 'ExportArtifact',
      },
    ],
    error: {
      type: String,
      default: null,
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

const MAX_LOG_TAIL_BYTES = 32 * 1024

pipelineJobSchema.methods.appendLogTail = function appendLogTail(chunk) {
  const next = (this.logsTail || '') + chunk
  this.logsTail =
    next.length > MAX_LOG_TAIL_BYTES
      ? next.slice(next.length - MAX_LOG_TAIL_BYTES)
      : next
}

module.exports = mongoose.model('PipelineJob', pipelineJobSchema)
