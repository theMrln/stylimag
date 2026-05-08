/**
 * FTP/FTPS deploy adapter — stub. The shape mirrors the s3 adapter so the
 * dispatcher contract is identical; flipping this on later means dropping
 * in a basic-ftp implementation that opens a Client(), uploads each item,
 * and closes. Marked stub to surface the gap honestly until ported.
 */

const NAME = 'ftp'

async function deploy({ items }) {
  return {
    applied: 0,
    dryRun: false,
    items: items.map((item) => ({
      ...item,
      ok: false,
      error: 'ftp adapter not yet implemented in this build',
    })),
  }
}

module.exports = { name: NAME, deploy }
