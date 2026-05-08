/**
 * Netlify deploy adapter — stub. Real implementation would call
 * https://api.netlify.com/api/v1/sites/{site_id}/deploys with a manifest
 * of files + their SHA1 hashes, then upload missing files. Credentials
 * carry the site_id and a personal-access token.
 */

const NAME = 'netlify'

async function deploy({ items }) {
  return {
    applied: 0,
    dryRun: false,
    items: items.map((item) => ({
      ...item,
      ok: false,
      error: 'netlify adapter not yet implemented in this build',
    })),
  }
}

module.exports = { name: NAME, deploy }
