/**
 * Convert article and version metadata from Stylo (legacy) shape to OJS shape.
 * - workingVersion.metadata on articles
 * - metadata on versions
 * Skips documents that are already in OJS shape.
 */
const { isOjsShape, styloToOjsShape } = require('../helpers/metadata')

exports.up = async function (db) {
  const mongo = db._getDbInstance()
  const articles = mongo.collection('articles')
  let articleCount = 0
  const articlesCursor = articles.find({
    'workingVersion.metadata': { $exists: true, $ne: null },
  })
  while (await articlesCursor.hasNext()) {
    const article = await articlesCursor.next()
    const metadata = article.workingVersion?.metadata
    if (metadata && !isOjsShape(metadata)) {
      try {
        const converted = styloToOjsShape(metadata)
        await articles.updateOne(
          { _id: article._id },
          { $set: { 'workingVersion.metadata': converted } },
          { upsert: false }
        )
        articleCount++
      } catch (err) {
        console.error(
          `[migration] Failed to convert article ${article._id}: ${err.message}`
        )
      }
    }
  }
  await articlesCursor.close()

  const versions = mongo.collection('versions')
  let versionCount = 0
  const versionsCursor = versions.find({
    metadata: { $exists: true, $ne: null },
  })
  while (await versionsCursor.hasNext()) {
    const version = await versionsCursor.next()
    const metadata = version.metadata
    if (metadata && !isOjsShape(metadata)) {
      try {
        const converted = styloToOjsShape(metadata)
        await versions.updateOne(
          { _id: version._id },
          { $set: { metadata: converted } },
          { upsert: false }
        )
        versionCount++
      } catch (err) {
        console.error(
          `[migration] Failed to convert version ${version._id}: ${err.message}`
        )
      }
    }
  }
  await versionsCursor.close()

  if (articleCount > 0 || versionCount > 0) {
    console.log(
      `[migration] Converted ${articleCount} article(s) and ${versionCount} version(s) metadata to OJS shape.`
    )
  }
}

exports.down = function () {
  return null
}
