const mongoose = require('mongoose')
const Schema = mongoose.Schema

const CorpusArticleSchema = new Schema({
  article: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Article',
  },
  order: Number,
  /** Section id or key for grouping (e.g. from OJS sectionId). Optional. */
  section: Schema.Types.Mixed,
  /** Section display title (e.g. from OJS section title). Optional. */
  sectionTitle: String,
  /**
   * Display sequence of the section itself (from OJS `/sections/:id` seq).
   * The OJS issue endpoint returns submissions in creation order, not
   * display order, so we record each section's own seq at import time
   * and sort sections by it. Optional.
   */
  sectionSeq: Number,
  /** Sequence within section (from OJS publication.seq). Optional. */
  seq: Number,
})

/**
 * Per-issue editorial board entry. Mirrors the snake_case shape used by
 * imaginations-issue-template's local issue_XXXX.json files but normalised
 * to camelCase here. An empty array is valid (issues without explicit
 * editor lists fall back to OJS-derived data).
 */
const CorpusEditorSchema = new Schema(
  {
    familyName: { type: String, default: '' },
    givenName: { type: String, default: '' },
    email: { type: String, default: '' },
    ORCID: { type: String, default: '' },
    affiliation: { type: String, default: '' },
    bio: { type: String, default: '' },
  },
  { _id: false }
)

/**
 * Locale-keyed cover-image credit line. Keys mirror the OJS locale codes
 * used elsewhere in the project (en, en_US, fr_CA, …); empty object is
 * valid.
 */
const CorpusImageCreditSchema = new Schema({}, { _id: false, strict: false })

/**
 * Per-corpus configuration that drives the publishing pipeline:
 *  - which template + CSS to use (refs into MinIO when overridden)
 *  - which OJS instance to push to
 *  - which static-deploy target to publish to
 * Defaults are filled in lazily by the pipeline runner if the field is
 * empty, so existing corpora keep working without an explicit migration.
 */
const PipelineSettingsSchema = new Schema(
  {
    templateId: { type: String, default: '' },
    cssOverrideRef: { type: String, default: '' },
    ojsTargetId: { type: String, default: '' },
    staticDeployTargetId: { type: String, default: '' },
    princeEnabled: { type: Boolean, default: false },
  },
  { _id: false }
)

const corpusSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      default: 'neutral',
      required: true,
    },
    articles: [CorpusArticleSchema],
    description: {
      type: String,
      default: '',
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
      get: (metadata) => metadata ?? {},
    },
    /**
     * Editorial board for the issue. Local-only — not pushed back to OJS.
     */
    editors: {
      type: [CorpusEditorSchema],
      default: [],
    },
    /**
     * Locale-keyed cover image credit line.
     */
    imageCredit: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    pipelineSettings: {
      type: PipelineSettingsSchema,
      default: () => ({}),
    },
    workspace: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
    },
    creator: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
)

/**
 * Retrieves corpuses owned by a given user in a given workspace.
 *
 * @param {object} params
 * @param {import('./user')} params.user
 * @param {import('./workspace')} [params.workspace]
 * @returns {mongoose.Collection<import('./corpus')>} corpuses
 */
corpusSchema.statics.findByUser = function findCorpusByUser({
  user,
  workspace = null,
}) {
  return this.find({ creator: user._id, workspace }).sort([['updatedAt', -1]])
}

/**
 * Removes an article from all corpuses where it appears.
 *
 * @param articleId article unique identifier
 * @returns {Promise<import('mongodb').UpdateResult<import('./corpus')>>}
 */
corpusSchema.statics.removeArticle = function removeArticle(articleId) {
  return this.updateMany(
    { 'articles.article': articleId },
    {
      $pull: {
        articles: {
          article: articleId,
        },
      },
    },
    { timestamps: true }
  )
}

module.exports = mongoose.model('Corpus', corpusSchema)
