const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')

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
 */
async function resolveTemplate(engine) {
  const candidate =
    engine === 'prince'
      ? 'article_template_prince.html5'
      : 'article_template_paged.html5'
  const enginePath = path.join(TEMPLATES_DIR, candidate)
  if (await fileExists(enginePath)) return enginePath
  return path.join(TEMPLATES_DIR, 'article_template.html5')
}

/**
 * Run pandoc to convert markdown → standalone HTML.
 * @param {object} args
 * @param {string} args.mdPath
 * @param {string} args.htmlPath
 * @param {string} args.workDir - cwd for pandoc; resource-path is built relative to this
 * @param {string} args.engine - 'paged' | 'prince'
 * @param {(msg: string) => void} args.log
 */
async function mdToHtml({ mdPath, htmlPath, workDir, engine, log }) {
  const templatePath = await resolveTemplate(engine)
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
  if (await fileExists(luaFilter)) {
    args.push(`--lua-filter=${luaFilter}`)
  }
  args.push('-o', htmlPath)

  log?.(
    `pandoc ${path.basename(mdPath)} → ${path.basename(htmlPath)} (engine=${engine}, template=${path.basename(templatePath)})`
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
