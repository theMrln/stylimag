const fsSync = require('node:fs')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileP = promisify(execFile)

const PRINCE_BIN = process.env.PRINCE_EXECUTABLE_PATH || 'prince'

async function isAvailable() {
  if (PRINCE_BIN.includes(path.sep)) {
    if (!fsSync.existsSync(PRINCE_BIN)) return false
  }
  try {
    await execFileP(PRINCE_BIN, ['--version'], { timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

/**
 * Render one or more HTML files to a single PDF via PrinceXML.
 *
 * Prince eats HTML directly — no Paged.js polyfill, no temp file dance.
 * The caller still passes an array for parity with the paged-js dispatcher;
 * Prince merges them in order via its multi-input mode.
 *
 * @param {object} args
 * @param {string[]} args.htmlPaths
 * @param {string} args.pdfPath
 * @param {(msg: string) => void} [args.log]
 * @param {boolean} [args.pdfUa1=true] - emit a PDF/UA-1 conformant PDF
 */
async function htmlToPdf({ htmlPaths, pdfPath, log, pdfUa1 = true }) {
  if (!htmlPaths || htmlPaths.length === 0) {
    throw new Error('prince htmlToPdf: htmlPaths is empty')
  }
  if (!(await isAvailable())) {
    throw new Error(
      `prince binary not found. Rebuild the pipeline image with --build-arg WITH_PRINCE=true (see Dockerfile).`
    )
  }
  const args = [...htmlPaths, '-o', pdfPath]
  if (pdfUa1) args.push('--pdf-profile=PDF/UA-1')
  log?.(`prince → ${path.basename(pdfPath)}${pdfUa1 ? ' (PDF/UA-1)' : ''}`)
  const { stderr } = await execFileP(PRINCE_BIN, args, {
    timeout: 5 * 60_000,
  })
  if (stderr?.trim()) log?.(`prince warning: ${stderr.trim()}`)
}

module.exports = { htmlToPdf, isAvailable }
