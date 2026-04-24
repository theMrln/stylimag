import { describe, expect, test } from 'vitest'

import { renderLitePreviewHtml, __testables__ } from './litePreview.js'

describe('renderLitePreviewHtml', () => {
  test('returns empty string for empty or missing input', () => {
    expect(renderLitePreviewHtml()).toEqual('')
    expect(renderLitePreviewHtml({})).toEqual('')
    expect(renderLitePreviewHtml({ md_content: '' })).toEqual('')
    expect(renderLitePreviewHtml({ md_content: undefined })).toEqual('')
  })

  test('renders basic markdown to HTML', () => {
    const html = renderLitePreviewHtml({ md_content: '# Title\n\nHello *world*.' })
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toMatch(/<em>world<\/em>/)
  })

  test('renders footnotes via markdown-it-footnote', () => {
    const md = 'Claim[^1].\n\n[^1]: Evidence here.'
    const html = renderLitePreviewHtml({ md_content: md })
    expect(html).toMatch(/footnote-ref/)
    expect(html).toContain('Evidence here.')
  })

  test('strips a leading YAML front matter block', () => {
    const md = '---\ntitle: X\n---\n\n# Body'
    const html = renderLitePreviewHtml({ md_content: md })
    expect(html).not.toContain('title: X')
    expect(html).toContain('<h1>Body</h1>')
  })

  test('sanitizes dangerous HTML (script tags, event handlers)', () => {
    const md = '<script>alert(1)</script>\n\nok'
    const html = renderLitePreviewHtml({ md_content: md })
    expect(html).not.toMatch(/<script/i)

    const md2 = '[click](javascript:alert(1))'
    const html2 = renderLitePreviewHtml({ md_content: md2 })
    expect(html2).not.toMatch(/javascript:/i)
  })

  test('leaves Pandoc-style citations literal (no citeproc in lite mode)', () => {
    const html = renderLitePreviewHtml({
      md_content: 'See [@doe2020] for more.',
    })
    expect(html).toContain('[@doe2020]')
  })

  test('stripFrontMatter is a no-op when there is no front matter', () => {
    const { stripFrontMatter } = __testables__
    expect(stripFrontMatter('# Hello')).toEqual('# Hello')
    expect(stripFrontMatter('')).toEqual('')
  })
})
