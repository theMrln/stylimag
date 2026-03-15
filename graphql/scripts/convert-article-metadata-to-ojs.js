#!/usr/bin/env node
/**
 * Standalone script to convert article and version metadata from Stylo (legacy)
 * shape to OJS shape. Uses DATABASE_URL from environment (.env recommended).
 *
 * Usage (from repo root):
 *   DOTENV_CONFIG_PATH=.env node -r dotenv/config graphql/scripts/convert-article-metadata-to-ojs.js
 *
 * Or from graphql directory:
 *   DOTENV_CONFIG_PATH=../.env node -r dotenv/config scripts/convert-article-metadata-to-ojs.js
 *
 * Dry run (no writes):
 *   DRY_RUN=1 DOTENV_CONFIG_PATH=.env node -r dotenv/config graphql/scripts/convert-article-metadata-to-ojs.js
 */
const path = require('path')

// Load .env from repo root if not already loaded
if (!process.env.DATABASE_URL && process.env.DOTENV_CONFIG_PATH) {
  require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH })
}
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, '../../.env')
  require('dotenv').config({ path: envPath })
}

const { MongoClient } = require('mongodb')
const { isOjsShape, styloToOjsShape } = require('../helpers/metadata')

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

async function run() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is not set. Set it in .env or the environment.')
    process.exit(1)
  }

  const client = new MongoClient(url)
  try {
    await client.connect()
    const db = client.db()
    const articles = db.collection('articles')
    const versions = db.collection('versions')

    let articleCount = 0
    const articlesCursor = articles.find({
      'workingVersion.metadata': { $exists: true, $ne: null },
    })
    while (await articlesCursor.hasNext()) {
      const article = await articlesCursor.next()
      const metadata = article.workingVersion?.metadata
      if (metadata && !isOjsShape(metadata)) {
        const converted = styloToOjsShape(metadata)
        if (!DRY_RUN) {
          await articles.updateOne(
            { _id: article._id },
            { $set: { 'workingVersion.metadata': converted } },
            { upsert: false }
          )
        }
        articleCount++
        if (DRY_RUN && articleCount <= 3) {
          console.log(`[dry run] Would convert article ${article._id} (title: ${metadata.title ?? 'n/a'})`)
        }
      }
    }
    await articlesCursor.close()

    let versionCount = 0
    const versionsCursor = versions.find({
      metadata: { $exists: true, $ne: null },
    })
    while (await versionsCursor.hasNext()) {
      const version = await versionsCursor.next()
      const metadata = version.metadata
      if (metadata && !isOjsShape(metadata)) {
        const converted = styloToOjsShape(metadata)
        if (!DRY_RUN) {
          await versions.updateOne(
            { _id: version._id },
            { $set: { metadata: converted } },
            { upsert: false }
          )
        }
        versionCount++
        if (DRY_RUN && versionCount <= 3) {
          console.log(`[dry run] Would convert version ${version._id}`)
        }
      }
    }
    await versionsCursor.close()

    if (DRY_RUN) {
      console.log(`[dry run] Would convert ${articleCount} article(s) and ${versionCount} version(s). Run without DRY_RUN to apply.`)
    } else {
      console.log(`Converted ${articleCount} article(s) and ${versionCount} version(s) metadata to OJS shape.`)
    }
  } finally {
    await client.close()
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
