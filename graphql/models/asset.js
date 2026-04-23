const mongoose = require('mongoose')
const Schema = mongoose.Schema

/**
 * An `Asset` is a binary referenced from article markdown (typically an image)
 * that lives in object storage. Mongo holds the metadata + access-control
 * bindings; the actual bytes live under `storageKey` in the configured bucket.
 */
const assetSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    article: {
      type: Schema.Types.ObjectId,
      ref: 'Article',
      index: true,
    },
    workspace: {
      type: Schema.Types.ObjectId,
      ref: 'Workspace',
      index: true,
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    sha256: {
      type: String,
      index: true,
    },
    originalFilename: {
      type: String,
    },
    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },
  },
  { timestamps: true }
)

module.exports = mongoose.model('Asset', assetSchema)
