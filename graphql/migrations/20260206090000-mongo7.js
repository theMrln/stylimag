exports.up = async function (db) {
  const adminDb = db._getDbInstance().admin()
  try {
    // MongoDB 7.0+ requires confirm: true; MongoDB 6.x rejects it
    await adminDb.command({
      setFeatureCompatibilityVersion: '7.0',
      confirm: true,
    })
  } catch (err) {
    const msg = String(err?.message ?? err)
    // MongoDB 6.x rejects confirm option; skip FCV 7.0 upgrade
    if (msg.includes('confirm') || msg.includes('unknown field')) {
      return
    }
    throw err
  }
}

exports.down = async function (db) {
  const adminDb = db._getDbInstance().admin()
  await adminDb.command({
    setFeatureCompatibilityVersion: '6.0',
  })
}
