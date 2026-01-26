exports.up = async function (db) {
  const adminDb = db._getDbInstance().admin()
  try {
    await adminDb.command({
      setFeatureCompatibilityVersion: '6.0',
    })
  } catch (e) {
    console.warn('Unable to set feature compatibility version to 6.0 (likely running newer Mongo version), ignoring:', e.message)
  }
}

exports.down = async function (db) {
  const adminDb = db._getDbInstance().admin()
  await adminDb.command({
    setFeatureCompatibilityVersion: '5.0',
  })
}
