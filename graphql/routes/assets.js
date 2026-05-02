const crypto = require('node:crypto')
const express = require('express')
const multer = require('multer')
const mongoose = require('mongoose')

const config = require('../config.js')
const { logger } = require('../logger')
const storage = require('../helpers/storage.js')
const Asset = require('../models/asset.js')
const Article = require('../models/article.js')
const ExportArtifact = require('../models/exportArtifact.js')

const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
])

const EXTENSION_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

const ALLOWED_EXPORT_FORMATS = new Set([
  'html',
  'pdf',
  'docx',
  'tex',
  'epub',
  'other',
])

const DEFAULT_EXPORT_MIME_BY_FORMAT = {
  html: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  tex: 'application/x-tex',
  epub: 'application/epub+zip',
  other: 'application/octet-stream',
}

function requireAuthenticated(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' })
  }
  return next()
}

function requireStorageConfigured(req, res, next) {
  if (!storage.isStorageConfigured()) {
    return res
      .status(503)
      .json({ error: 'Object storage is not configured on this server' })
  }
  return next()
}

function buildImageKey({ userId, articleId, sha256, mimeType }) {
  const ext = EXTENSION_BY_MIME[mimeType] || 'bin'
  const safeArticle = articleId ? String(articleId) : 'unbound'
  return `images/${userId}/${safeArticle}/${sha256}.${ext}`
}

function buildExportKey({ articleId, versionId, artifactId, format }) {
  const v = versionId ? String(versionId) : 'working'
  return `exports/${articleId}/${v}/${artifactId}/article.${format}`
}

/**
 * Return true when `user` is allowed to create/read exports for `articleId`.
 */
async function canAccessArticle(user, articleId) {
  if (!user || !articleId) {
    return false
  }
  const article = await Article.findById(articleId)
    .select({ owner: 1, contributors: 1 })
    .lean()
  if (!article) {
    return false
  }
  const userId = user._id?.toString() || user.id?.toString()
  if (article.owner?.toString() === userId) {
    return true
  }
  return (
    Array.isArray(article.contributors) &&
    article.contributors.some((c) => c?.user?.toString() === userId)
  )
}

function serializeExport(artifact) {
  return {
    id: artifact._id.toString(),
    url: `/assets/exports/${artifact._id.toString()}`,
    format: artifact.format,
    status: artifact.status,
    mimeType: artifact.mimeType,
    size: artifact.size,
    article: artifact.article ? artifact.article.toString() : null,
    version: artifact.version ? artifact.version.toString() : null,
    requestedBy: artifact.requestedBy
      ? artifact.requestedBy.toString()
      : null,
    optionsHash: artifact.optionsHash,
    expiresAt: artifact.expiresAt,
    createdAt: artifact.createdAt,
  }
}

function createAssetsRouter() {
  const router = express.Router()
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.get('storage.maxUploadBytes'),
      files: 1,
    },
    fileFilter(req, file, cb) {
      if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
        return cb(
          Object.assign(new Error('Unsupported image type'), {
            status: 415,
            code: 'UNSUPPORTED_MIME',
          })
        )
      }
      return cb(null, true)
    },
  })

  router.post(
    '/images',
    requireAuthenticated,
    requireStorageConfigured,
    upload.single('file'),
    async (req, res, next) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file provided' })
        }
        const { buffer, mimetype, size, originalname } = req.file
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
        const userId = req.user._id?.toString() || req.user.id?.toString()
        const articleId =
          typeof req.body?.articleId === 'string' &&
          mongoose.isValidObjectId(req.body.articleId)
            ? req.body.articleId
            : null

        if (articleId) {
          const article = await Article.findById(articleId)
            .select({ owner: 1, contributors: 1 })
            .lean()
          const isOwner = article?.owner?.toString() === userId
          const isContributor =
            Array.isArray(article?.contributors) &&
            article.contributors.some((c) => c?.user?.toString() === userId)
          if (!article || (!isOwner && !isContributor)) {
            return res
              .status(403)
              .json({ error: 'Not allowed to upload to this article' })
          }
        }

        const existing = await Asset.findOne({
          owner: userId,
          sha256,
          deletedAt: null,
          ...(articleId ? { article: articleId } : {}),
        })
        if (existing) {
          return res.status(200).json(serializeAsset(existing))
        }

        const key = buildImageKey({
          userId,
          articleId,
          sha256,
          mimeType: mimetype,
        })
        await storage.putObject({ key, body: buffer, contentType: mimetype })

        const asset = await Asset.create({
          owner: userId,
          article: articleId,
          storageKey: key,
          mimeType: mimetype,
          size,
          sha256,
          originalFilename: originalname,
        })

        return res.status(201).json(serializeAsset(asset))
      } catch (err) {
        return next(err)
      }
    }
  )

  /*
   * Image GET is intentionally unauthenticated.
   *
   * Reason: the resulting URL is embedded in markdown as a plain
   * `![alt](/assets/images/<id>)` and rendered by the browser as a regular
   * `<img>` tag — and `<img>` requests cannot carry an `Authorization`
   * header. Stylo's local-strategy login uses passport with `session: false`
   * (see `graphql/auth/local.js`), so there is no session cookie to ride
   * along either; gating GET behind auth would simply break in-app preview
   * for any local-auth user.
   *
   * Access control is therefore "unguessable URL": the id is a 24-char
   * Mongo ObjectId. This matches the model commonly used by image hosts
   * (Imgur, Google Photos sharing links, etc.). Anyone with the URL — i.e.
   * anyone the article has been shared with via its markdown — can read
   * the image. POST (upload) and DELETE remain authenticated.
   */
  router.get(
    '/images/:id',
    requireStorageConfigured,
    async (req, res, next) => {
      try {
        const { id } = req.params
        if (!mongoose.isValidObjectId(id)) {
          return res.status(404).json({ error: 'Asset not found' })
        }
        const asset = await Asset.findById(id)
        if (!asset || asset.deletedAt) {
          return res.status(404).json({ error: 'Asset not found' })
        }
        const obj = await storage.getObject(asset.storageKey)
        res.setHeader('Content-Type', asset.mimeType)
        if (asset.size) {
          res.setHeader('Content-Length', String(asset.size))
        }
        /* `public` instead of `private` since the endpoint is unauthenticated;
           one hour is a balance between bandwidth on previews and recovery
           after an asset is replaced (currently same id => same bytes thanks
           to sha256 dedup, so caching is safe). */
        res.setHeader('Cache-Control', 'public, max-age=3600')
        if (obj.Body && typeof obj.Body.pipe === 'function') {
          obj.Body.pipe(res)
          obj.Body.on('error', next)
        } else {
          const chunks = []
          for await (const chunk of obj.Body) {
            chunks.push(chunk)
          }
          res.end(Buffer.concat(chunks))
        }
      } catch (err) {
        return next(err)
      }
    }
  )

  router.delete(
    '/images/:id',
    requireAuthenticated,
    requireStorageConfigured,
    async (req, res, next) => {
      try {
        const { id } = req.params
        if (!mongoose.isValidObjectId(id)) {
          return res.status(404).json({ error: 'Asset not found' })
        }
        const asset = await Asset.findById(id)
        if (!asset || asset.deletedAt) {
          return res.status(404).json({ error: 'Asset not found' })
        }
        const userId = req.user._id?.toString() || req.user.id?.toString()
        if (asset.owner?.toString() !== userId) {
          return res.status(403).json({ error: 'Forbidden' })
        }
        asset.deletedAt = new Date()
        await asset.save()
        try {
          await storage.deleteObject(asset.storageKey)
        } catch (err) {
          logger.warn(
            { err, assetId: id },
            'Failed to remove asset object from storage'
          )
        }
        return res.status(204).end()
      } catch (err) {
        return next(err)
      }
    }
  )

  const exportUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: config.get('storage.maxUploadBytes'),
      files: 1,
    },
  })

  router.post(
    '/exports',
    requireAuthenticated,
    requireStorageConfigured,
    exportUpload.single('file'),
    async (req, res, next) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'No file provided' })
        }
        const articleId =
          typeof req.body?.articleId === 'string' &&
          mongoose.isValidObjectId(req.body.articleId)
            ? req.body.articleId
            : null
        if (!articleId) {
          return res
            .status(400)
            .json({ error: 'articleId is required for exports' })
        }
        if (!(await canAccessArticle(req.user, articleId))) {
          return res
            .status(403)
            .json({ error: 'Not allowed to persist exports for this article' })
        }
        const format = String(req.body?.format || '').toLowerCase()
        if (!ALLOWED_EXPORT_FORMATS.has(format)) {
          return res
            .status(400)
            .json({ error: `Unsupported export format: ${format}` })
        }
        const versionId =
          typeof req.body?.versionId === 'string' &&
          mongoose.isValidObjectId(req.body.versionId)
            ? req.body.versionId
            : null
        const optionsHash =
          typeof req.body?.optionsHash === 'string'
            ? req.body.optionsHash.slice(0, 128)
            : undefined

        const artifact = await ExportArtifact.create({
          article: articleId,
          version: versionId,
          requestedBy: req.user._id || req.user.id,
          format,
          status: 'pending',
          mimeType:
            req.file.mimetype ||
            DEFAULT_EXPORT_MIME_BY_FORMAT[format] ||
            'application/octet-stream',
          size: req.file.size,
          optionsHash,
        })
        const key = buildExportKey({
          articleId,
          versionId,
          artifactId: artifact._id.toString(),
          format,
        })
        try {
          await storage.putObject({
            key,
            body: req.file.buffer,
            contentType: artifact.mimeType,
          })
          artifact.storageKey = key
          artifact.status = 'ready'
          await artifact.save()
        } catch (err) {
          artifact.status = 'failed'
          await artifact.save().catch(() => {})
          throw err
        }
        return res.status(201).json(serializeExport(artifact))
      } catch (err) {
        return next(err)
      }
    }
  )

  router.post(
    '/exports/from-url',
    requireAuthenticated,
    requireStorageConfigured,
    express.json({ limit: '16kb' }),
    async (req, res, next) => {
      try {
        const { url, articleId, versionId, format, optionsHash } =
          req.body || {}
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
          return res
            .status(400)
            .json({ error: 'A valid http(s) url is required' })
        }
        if (
          typeof articleId !== 'string' ||
          !mongoose.isValidObjectId(articleId)
        ) {
          return res.status(400).json({ error: 'Valid articleId is required' })
        }
        const fmt = String(format || '').toLowerCase()
        if (!ALLOWED_EXPORT_FORMATS.has(fmt)) {
          return res
            .status(400)
            .json({ error: `Unsupported export format: ${fmt}` })
        }
        if (!(await canAccessArticle(req.user, articleId))) {
          return res
            .status(403)
            .json({ error: 'Not allowed to persist exports for this article' })
        }

        const artifact = await ExportArtifact.create({
          article: articleId,
          version:
            typeof versionId === 'string' &&
            mongoose.isValidObjectId(versionId)
              ? versionId
              : null,
          requestedBy: req.user._id || req.user.id,
          format: fmt,
          status: 'pending',
          mimeType: DEFAULT_EXPORT_MIME_BY_FORMAT[fmt],
          optionsHash:
            typeof optionsHash === 'string'
              ? optionsHash.slice(0, 128)
              : undefined,
        })

        try {
          const upstream = await fetch(url, {
            redirect: 'follow',
          })
          if (!upstream.ok) {
            artifact.status = 'failed'
            await artifact.save().catch(() => {})
            return res
              .status(502)
              .json({ error: `Upstream returned ${upstream.status}` })
          }
          const ab = await upstream.arrayBuffer()
          const buffer = Buffer.from(ab)
          const contentType =
            upstream.headers.get('content-type') ||
            DEFAULT_EXPORT_MIME_BY_FORMAT[fmt] ||
            'application/octet-stream'
          const key = buildExportKey({
            articleId,
            versionId: artifact.version,
            artifactId: artifact._id.toString(),
            format: fmt,
          })
          await storage.putObject({
            key,
            body: buffer,
            contentType,
          })
          artifact.storageKey = key
          artifact.mimeType = contentType
          artifact.size = buffer.length
          artifact.status = 'ready'
          await artifact.save()
          return res.status(201).json(serializeExport(artifact))
        } catch (err) {
          artifact.status = 'failed'
          await artifact.save().catch(() => {})
          throw err
        }
      } catch (err) {
        return next(err)
      }
    }
  )

  router.get(
    '/exports',
    requireAuthenticated,
    async (req, res, next) => {
      try {
        const articleId =
          typeof req.query?.articleId === 'string' &&
          mongoose.isValidObjectId(req.query.articleId)
            ? req.query.articleId
            : null
        if (!articleId) {
          return res
            .status(400)
            .json({ error: 'articleId query parameter is required' })
        }
        if (!(await canAccessArticle(req.user, articleId))) {
          return res.status(403).json({ error: 'Forbidden' })
        }
        const artifacts = await ExportArtifact.find({
          article: articleId,
          status: 'ready',
        })
          .sort({ createdAt: -1 })
          .limit(100)
          .lean()
        return res.json(artifacts.map(serializeExport))
      } catch (err) {
        return next(err)
      }
    }
  )

  router.get(
    '/exports/:id',
    requireAuthenticated,
    requireStorageConfigured,
    async (req, res, next) => {
      try {
        const { id } = req.params
        if (!mongoose.isValidObjectId(id)) {
          return res.status(404).json({ error: 'Export not found' })
        }
        const artifact = await ExportArtifact.findById(id)
        if (!artifact || artifact.status !== 'ready' || !artifact.storageKey) {
          return res.status(404).json({ error: 'Export not found' })
        }
        if (!(await canAccessArticle(req.user, artifact.article))) {
          return res.status(403).json({ error: 'Forbidden' })
        }
        const obj = await storage.getObject(artifact.storageKey)
        if (artifact.mimeType) {
          res.setHeader('Content-Type', artifact.mimeType)
        }
        if (artifact.size) {
          res.setHeader('Content-Length', String(artifact.size))
        }
        res.setHeader('Cache-Control', 'private, max-age=3600')
        if (obj.Body && typeof obj.Body.pipe === 'function') {
          obj.Body.pipe(res)
          obj.Body.on('error', next)
        } else {
          const chunks = []
          for await (const chunk of obj.Body) {
            chunks.push(chunk)
          }
          res.end(Buffer.concat(chunks))
        }
      } catch (err) {
        return next(err)
      }
    }
  )

  router.use((err, req, res, _next) => {
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500)
    if (status >= 500) {
      logger.error({ err }, 'Asset route error')
    }
    res.status(status).json({
      error: err.message || 'Internal Server Error',
      code: err.code,
    })
  })

  return router
}

function serializeAsset(asset) {
  return {
    id: asset._id.toString(),
    url: `/assets/images/${asset._id.toString()}`,
    mimeType: asset.mimeType,
    size: asset.size,
    sha256: asset.sha256,
    originalFilename: asset.originalFilename,
    article: asset.article ? asset.article.toString() : null,
    createdAt: asset.createdAt,
  }
}

module.exports = { createAssetsRouter }
