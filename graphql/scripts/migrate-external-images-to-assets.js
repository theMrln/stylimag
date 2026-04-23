#!/usr/bin/env node
/**
 * Migrate external image links (e.g. Imgur) found in article markdown to
 * backend-managed assets persisted in object storage.
 *
 * For each article, scans `workingVersion.md` for Markdown images with
 * absolute http(s) URLs, downloads them, uploads them to the configured
 * object store, creates an `Asset` document, and rewrites the markdown to
 * reference the stable platform URL `/assets/images/<id>`.
 *
 * Usage (from repo root):
 *   DOTENV_CONFIG_PATH=.env node -r dotenv/config \
 *     graphql/scripts/migrate-external-images-to-assets.js
 *
 * Or from graphql directory:
 *   DOTENV_CONFIG_PATH=../.env node -r dotenv/config \
 *     scripts/migrate-external-images-to-assets.js
 *
 * Flags (via environment):
 *   DRY_RUN=1          do not write to Mongo or object storage
 *   ARTICLE_IDS=a,b,c  limit to specific article ids (comma separated)
 *   HOSTS=i.imgur.com,imgur.com
 *                      only rewrite images whose URL host matches this list
 *                      (default: any http(s) host)
 *   MAX_BYTES=20971520 skip images larger than N bytes (default 20 MiB)
 */
const path = require('node:path')
const crypto = require('node:crypto')

if (!process.env.DATABASE_URL && process.env.DOTENV_CONFIG_PATH) {
  require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH })
}
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, '../../.env')
  require('dotenv').config({ path: envPath })
}

const mongoose = require('mongoose')

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
const ARTICLE_IDS = (process.env.ARTICLE_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const HOSTS = (process.env.HOSTS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const MAX_BYTES = Number(process.env.MAX_BYTES) || 20 * 1024 * 1024

const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
}

const MD_IMAGE_RE = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)(\s+"[^"]*")?\)/g

function inferMime(url, upstreamHeader) {
  if (upstreamHeader) {
    return upstreamHeader.split(';')[0].trim().toLowerCase()
  }
  const ext = url.split('?')[0].split('.').pop().toLowerCase()
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
    }[ext] || 'application/octet-stream'
  )
}

async function run() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error(
      'DATABASE_URL is not set. Set it in .env or the environment.'
    )
    process.exit(1)
  }

  const storage = require('../helpers/storage.js')
  if (!storage.isStorageConfigured()) {
    console.error(
      'Object storage is not configured. Set STORAGE_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY.'
    )
    process.exit(1)
  }

  await mongoose.connect(databaseUrl)
  const Article = require('../models/article.js')
  const Asset = require('../models/asset.js')

  const query = ARTICLE_IDS.length
    ? { _id: { $in: ARTICLE_IDS.map((id) => new mongoose.Types.ObjectId(id)) } }
    : { 'workingVersion.md': { $regex: /!\[[^\]]*\]\(https?:\/\//, $options: 'i' } }

  const cursor = Article.find(query).cursor()

  let articleCount = 0
  let imageCount = 0
  let rewrittenCount = 0
  let skipped = 0
  let failed = 0

  for (
    let article = await cursor.next();
    article !== null;
    article = await cursor.next()
  ) {
    articleCount++
    const md = article.workingVersion?.md || ''
    if (!md) continue

    const replacements = []
    const matches = [...md.matchAll(MD_IMAGE_RE)]
    for (const m of matches) {
      imageCount++
      const original = m[0]
      const alt = m[1]
      const url = m[2]
      const title = m[3] || ''

      let host = ''
      try {
        host = new URL(url).host.toLowerCase()
      } catch {
        skipped++
        continue
      }
      if (HOSTS.length && !HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
        skipped++
        continue
      }

      // Already a platform URL? skip
      if (url.includes('/assets/images/')) {
        skipped++
        continue
      }

      try {
        const upstream = await fetch(url, { redirect: 'follow' })
        if (!upstream.ok) {
          console.warn(`  [${article._id}] ${url} -> HTTP ${upstream.status}`)
          failed++
          continue
        }
        const contentLength = Number(upstream.headers.get('content-length')) || 0
        if (contentLength && contentLength > MAX_BYTES) {
          console.warn(
            `  [${article._id}] ${url} -> ${contentLength} bytes exceeds MAX_BYTES`
          )
          skipped++
          continue
        }
        const ab = await upstream.arrayBuffer()
        const buffer = Buffer.from(ab)
        if (buffer.length > MAX_BYTES) {
          console.warn(
            `  [${article._id}] ${url} -> ${buffer.length} bytes exceeds MAX_BYTES`
          )
          skipped++
          continue
        }
        const mimeType = inferMime(url, upstream.headers.get('content-type'))
        const sha256 = crypto.createHash('sha256').update(buffer).digest('hex')
        const ownerId = article.owner?.toString() || ''
        const ext = EXT_BY_MIME[mimeType] || 'bin'
        const key = `images/${ownerId || 'unbound'}/${article._id}/${sha256}.${ext}`

        let asset = await Asset.findOne({
          owner: article.owner,
          article: article._id,
          sha256,
          deletedAt: null,
        })
        if (!asset) {
          if (!DRY_RUN) {
            await storage.putObject({
              key,
              body: buffer,
              contentType: mimeType,
            })
            asset = await Asset.create({
              owner: article.owner,
              article: article._id,
              storageKey: key,
              mimeType,
              size: buffer.length,
              sha256,
              originalFilename: decodeURIComponent(
                url.split('/').pop().split('?')[0] || ''
              ),
            })
          } else {
            asset = { _id: `dryrun-${sha256.slice(0, 12)}` }
          }
        }
        const platformUrl = `/assets/images/${asset._id.toString()}`
        replacements.push({
          from: original,
          to: `![${alt}](${platformUrl}${title})`,
        })
        rewrittenCount++
      } catch (err) {
        console.warn(`  [${article._id}] ${url} -> error: ${err.message}`)
        failed++
      }
    }

    if (replacements.length) {
      let nextMd = md
      for (const r of replacements) {
        nextMd = nextMd.split(r.from).join(r.to)
      }
      console.log(
        `Article ${article._id}: rewriting ${replacements.length}/${matches.length} image link(s)`
      )
      if (!DRY_RUN) {
        await Article.updateOne(
          { _id: article._id },
          { $set: { 'workingVersion.md': nextMd, updatedAt: new Date() } }
        )
      }
    }
  }

  console.log('')
  console.log(`Articles scanned    : ${articleCount}`)
  console.log(`Images found        : ${imageCount}`)
  console.log(`Rewritten to /assets: ${rewrittenCount}${DRY_RUN ? ' (dry-run)' : ''}`)
  console.log(`Skipped             : ${skipped}`)
  console.log(`Failed              : ${failed}`)

  await mongoose.disconnect()
}

run().catch(async (err) => {
  console.error(err)
  try {
    await mongoose.disconnect()
  } catch {
    // ignore
  }
  process.exit(1)
})
