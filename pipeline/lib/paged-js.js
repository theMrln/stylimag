const fs = require('node:fs/promises')
const fsSync = require('node:fs')
const path = require('node:path')
const puppeteer = require('puppeteer-core')

const PAGEDJS_CDN = 'https://unpkg.com/pagedjs/dist/paged.polyfill.js'

function injectPagedJS(html) {
  if (html.includes('paged.polyfill.js') || html.includes('pagedjs')) {
    return html
  }
  const headClose = html.indexOf('</head>')
  if (headClose === -1) {
    return `<script src="${PAGEDJS_CDN}"></script>\n${html}`
  }
  return (
    html.slice(0, headClose) +
    `\n  <script src="${PAGEDJS_CDN}"></script>` +
    html.slice(headClose)
  )
}

function parsePageConfig(html) {
  let topMargin = '80pt'
  let bottomMargin = '160pt'
  let leftMargin = '112pt'
  let rightMargin = '112pt'
  let pageWidth = '7in'
  let pageHeight = '10in'

  const printMediaMatch = html.match(/@media\s+print\s*\{([\s\S]*?)\}/)
  if (printMediaMatch) {
    const printCSS = printMediaMatch[1]
    const basePageMatch = printCSS.match(/@page\s+(?!:)[^{]*\{([^}]+)\}/)
    if (basePageMatch) {
      const rules = basePageMatch[1]
      const sizeMatch = rules.match(/size:\s*([^;]+);/)
      if (sizeMatch) {
        const size = sizeMatch[1].trim().split(/\s+/)
        if (size.length === 2) {
          pageWidth = size[0].trim()
          pageHeight = size[1].trim()
        }
      }
      const t = rules.match(/margin-top:\s*([^;]+);/)
      const b = rules.match(/margin-bottom:\s*([^;]+);/)
      const l = rules.match(/margin-left:\s*([^;]+);/)
      const r = rules.match(/margin-right:\s*([^;]+);/)
      const m = rules.match(/margin:\s*([^;@]+);/)
      if (t) topMargin = t[1].trim()
      if (b) bottomMargin = b[1].trim()
      if (l) leftMargin = l[1].trim()
      if (r) rightMargin = r[1].trim()
      if (m && !m[1].includes('@')) {
        const parts = m[1].trim().split(/\s+/).filter(Boolean)
        if (parts.length === 2) {
          topMargin = bottomMargin = parts[0]
          leftMargin = rightMargin = parts[1]
        } else if (parts.length === 4) {
          topMargin = parts[0]
          rightMargin = parts[1]
          bottomMargin = parts[2]
          leftMargin = parts[3]
        }
      }
    }
  }

  const toInches = (v) => {
    const m = v.match(/([\d.]+)(pt|in|mm|cm|px)?/)
    if (!m) return v
    const num = parseFloat(m[1])
    const unit = m[2] || 'pt'
    switch (unit) {
      case 'pt':
        return (num / 72).toFixed(3) + 'in'
      case 'in':
        return num.toFixed(3) + 'in'
      case 'mm':
        return (num / 25.4).toFixed(3) + 'in'
      case 'cm':
        return (num / 2.54).toFixed(3) + 'in'
      case 'px':
        return (num / 96).toFixed(3) + 'in'
      default:
        return v
    }
  }
  return {
    width: toInches(pageWidth),
    height: toInches(pageHeight),
  }
}

/**
 * Render one or more HTML files to a single PDF using headless Chromium + Paged.js.
 * @param {object} args
 * @param {string[]} args.htmlPaths
 * @param {string} args.pdfPath
 * @param {(msg: string) => void} [args.log]
 */
async function htmlToPdf({ htmlPaths, pdfPath, log }) {
  const exe = process.env.PUPPETEER_EXECUTABLE_PATH
  if (!exe || !fsSync.existsSync(exe)) {
    throw new Error(
      `PUPPETEER_EXECUTABLE_PATH (${exe || 'unset'}) does not point to a Chromium binary`
    )
  }

  log?.(`Headless Chrome + Paged.js → ${path.basename(pdfPath)}`)

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: exe,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  })

  let combinedHTML = ''
  try {
    if (htmlPaths.length === 1) {
      combinedHTML = injectPagedJS(await fs.readFile(htmlPaths[0], 'utf8'))
    } else {
      // Multi-file merge: keep first file's <head>, concat <body> contents.
      const first = injectPagedJS(await fs.readFile(htmlPaths[0], 'utf8'))
      const headMatch = first.match(/<head[^>]*>([\s\S]*)<\/head>/i)
      const bodyMatch = first.match(/<body[^>]*>([\s\S]*)<\/body>/i)
      if (!headMatch || !bodyMatch) {
        throw new Error('First HTML file has no <head>/<body>')
      }
      let head = headMatch[1]
      let body = bodyMatch[1]
      for (let i = 1; i < htmlPaths.length; i++) {
        const html = injectPagedJS(await fs.readFile(htmlPaths[i], 'utf8'))
        const bm = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)
        if (bm) body += bm[1]
      }
      combinedHTML = `<!DOCTYPE html><html lang="en"><head>${head}</head><body>${body}</body></html>`
    }

    const tmp = path.join(
      path.dirname(pdfPath),
      `.pagedjs-temp-${Date.now()}.html`
    )
    await fs.writeFile(tmp, combinedHTML, 'utf8')

    const page = await browser.newPage()
    await page.goto(`file://${path.resolve(tmp)}`, {
      waitUntil: 'networkidle0',
      timeout: 60_000,
    })

    await page.evaluate(() => {
      return new Promise((resolve) => {
        if (!window.PagedPolyfill) {
          setTimeout(resolve, 2000)
          return
        }
        const check = () => {
          const pp = window.PagedPolyfill
          if (pp?.previewer?.pages?.length > 0) {
            resolve()
          } else {
            setTimeout(check, 100)
          }
        }
        setTimeout(check, 500)
        setTimeout(resolve, 10_000) // hard ceiling
      })
    })

    const pageConfig = parsePageConfig(combinedHTML)
    await page.setViewport({
      width: Math.round(parseFloat(pageConfig.width) * 96),
      height: Math.round(parseFloat(pageConfig.height) * 96),
    })

    await page.pdf({
      path: pdfPath,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    })

    await fs.rm(tmp, { force: true })
  } finally {
    await browser.close()
  }
}

module.exports = { htmlToPdf, injectPagedJS }
