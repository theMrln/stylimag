const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')
const { getObjectBuffer } = require('./storage')

const execFileP = promisify(execFile)

const APP_DIR = path.resolve(__dirname, '..')
const TEMPLATES_DIR = path.join(APP_DIR, 'templates')
const LUA_DIR = path.join(APP_DIR, 'lua')
const STATIC_DIR = path.join(APP_DIR, 'static')

async function fileExists(p) {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/**
 * Resolve the pandoc HTML5 template for a given engine. Falls back to the
 * generic article_template.html5 when the engine-specific file is absent.
 *
 * If `pipelineSettings.templateId` is set, it's treated as a MinIO object
 * key and downloaded into the workdir before being returned. The pipeline
 * accepts only a single template override per corpus; layout-style cascades
 * are out of scope until Phase 5+ matures.
 */
async function resolveTemplate(engine, { workDir, pipelineSettings } = {}) {
  const overrideKey = pipelineSettings?.templateId
  if (overrideKey && workDir) {
    try {
      const buf = await getObjectBuffer(overrideKey)
      const target = path.join(workDir, 'corpus-template.html5')
      await fs.writeFile(target, buf)
      return target
    } catch {
      // fall through to bundled defaults if the override is unreachable
    }
  }
  const candidate =
    engine === 'prince'
      ? 'article_template_prince.html5'
      : 'article_template_paged.html5'
  const enginePath = path.join(TEMPLATES_DIR, candidate)
  if (await fileExists(enginePath)) return enginePath
  return path.join(TEMPLATES_DIR, 'article_template.html5')
}

/**
 * Resolve a per-corpus CSS override into a workdir-local file. Returns the
 * absolute path or null if no override is configured / reachable.
 */
async function resolveCssOverride({ workDir, pipelineSettings } = {}) {
  const overrideKey = pipelineSettings?.cssOverrideRef
  if (!overrideKey || !workDir) return null
  try {
    const buf = await getObjectBuffer(overrideKey)
    const target = path.join(workDir, 'corpus-override.css')
    await fs.writeFile(target, buf)
    return target
  } catch {
    return null
  }
}

/**
 * Run pandoc to convert markdown → standalone HTML. Honours per-corpus
 * template + CSS overrides if `pipelineSettings.{templateId,cssOverrideRef}`
 * resolve to MinIO keys.
 *
 * @param {object} args
 * @param {string} args.mdPath
 * @param {string} args.htmlPath
 * @param {string} args.workDir - cwd for pandoc; resource-path is built relative to this
 * @param {string} args.engine - 'paged' | 'prince'
 * @param {object} [args.pipelineSettings]
 * @param {(msg: string) => void} args.log
 */
async function mdToHtml({
  mdPath,
  htmlPath,
  workDir,
  engine,
  pipelineSettings,
  log,
}) {
  const templatePath = await resolveTemplate(engine, {
    workDir,
    pipelineSettings,
  })
  const cssOverridePath = await resolveCssOverride({
    workDir,
    pipelineSettings,
  })
  const luaFilter = path.join(LUA_DIR, 'remove_special_chars.lua')

  const args = [
    mdPath,
    '-f',
    'markdown',
    '-t',
    'html',
    '--wrap=none',
    `--resource-path=.:${STATIC_DIR}:${workDir}`,
    '--embed-resources',
    '--standalone',
    `--template=${templatePath}`,
  ]
  if (cssOverridePath) {
    // Pandoc --css → linked stylesheet inside the standalone HTML; combined
    // with --embed-resources the file is inlined for the headless render.
    args.push(`--css=${cssOverridePath}`)
  }
  if (await fileExists(luaFilter)) {
    args.push(`--lua-filter=${luaFilter}`)
  }
  args.push('-o', htmlPath)

  log?.(
    `pandoc ${path.basename(mdPath)} → ${path.basename(htmlPath)} (engine=${engine}, template=${path.basename(templatePath)}${cssOverridePath ? `, css=${path.basename(cssOverridePath)}` : ''})`
  )
  const { stderr } = await execFileP('pandoc', args, {
    cwd: workDir,
    timeout: 120_000,
  })
  if (stderr?.trim()) log?.(`pandoc warning: ${stderr.trim()}`)
}

module.exports = {
  mdToHtml,
  resolveTemplate,
  TEMPLATES_DIR,
  LUA_DIR,
  STATIC_DIR,
}
