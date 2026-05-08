const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const { promisify } = require('node:util')
const { logger } = require('./logger')
const { isStorageConfigured } = require('./storage')

const execFileP = promisify(execFile)

async function probeBinary(name, args = ['--version']) {
  try {
    const { stdout } = await execFileP(name, args, { timeout: 5_000 })
    return { ok: true, version: stdout.split('\n')[0]?.trim() ?? '' }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

async function probeChromium() {
  const exe = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
  try {
    await fs.access(exe)
  } catch {
    return { ok: false, error: `Chromium not found at ${exe}` }
  }
  return probeBinary(exe, ['--version'])
}

async function runHealth() {
  const [pandoc, chromium] = await Promise.all([
    probeBinary('pandoc'),
    probeChromium(),
  ])
  const storage = { ok: isStorageConfigured() }
  if (!storage.ok) {
    storage.error =
      'Missing STORAGE_ENDPOINT / STORAGE_BUCKET / STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY'
  }
  const ok = pandoc.ok && chromium.ok && storage.ok
  return {
    ok,
    node: { ok: true, version: process.version },
    pandoc,
    chromium,
    storage,
  }
}

function validateArticleJobParams(params) {
  const errors = []
  if (!params || typeof params !== 'object') {
    errors.push('Job params missing.')
    return errors
  }
  if (!params.articleId) errors.push('articleId is required.')
  if (!params.corpusId) errors.push('corpusId is required.')
  if (typeof params.markdown !== 'string' || params.markdown.length === 0) {
    errors.push('markdown is required and must be a non-empty string.')
  }
  if (params.markdown && !/^---\s*\n[\s\S]*?\n---\s*/.test(params.markdown)) {
    errors.push(
      'Markdown is missing a YAML frontmatter block (---\\n...\\n---).'
    )
  }
  return errors
}

async function logHealthOnStart() {
  const h = await runHealth()
  if (h.ok) {
    logger.info(
      { pandoc: h.pandoc.version, chromium: h.chromium.version },
      'Pipeline preflight OK'
    )
  } else {
    logger.warn({ health: h }, 'Pipeline preflight reports degraded state')
  }
  return h
}

module.exports = {
  runHealth,
  logHealthOnStart,
  validateArticleJobParams,
}
