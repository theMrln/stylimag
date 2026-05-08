const paged = require('./paged-js')
const prince = require('./prince')

/**
 * Engine-aware HTML → PDF dispatcher. Every artefact runner calls this
 * instead of the per-engine modules so engine selection lives in one
 * place. Defaults to paged when an unknown / missing engine is supplied
 * so callers never silently fall through to nothing.
 *
 * @param {object} args
 * @param {'paged' | 'prince'} [args.engine='paged']
 * @param {string[]} args.htmlPaths
 * @param {string} args.pdfPath
 * @param {(msg: string) => void} [args.log]
 */
async function htmlToPdf({ engine, htmlPaths, pdfPath, log }) {
  const e = engine === 'prince' ? 'prince' : 'paged'
  log?.(`pdf engine: ${e}`)
  if (e === 'prince') {
    return prince.htmlToPdf({ htmlPaths, pdfPath, log })
  }
  return paged.htmlToPdf({ htmlPaths, pdfPath, log })
}

async function isEngineAvailable(engine) {
  if (engine === 'prince') return prince.isAvailable()
  return true // paged.js + Chromium are always present in the image
}

module.exports = { htmlToPdf, isEngineAvailable }
