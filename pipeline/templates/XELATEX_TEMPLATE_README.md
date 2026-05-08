# XeLaTeX Template for Imaginations Journal

This directory contains a XeLaTeX pandoc template (`article_template.tex`) that produces PDF output similar to the Prince-generated PDFs from the HTML template.

## Features

The XeLaTeX template includes:

- **Typography**: Linux Libertine O (serif) and Muli (sans-serif) fonts matching the HTML template's print styles
- **Page Layout**: 7" × 10" page size with proper margins (80pt top, 160pt bottom, 112pt inner/outer)
- **Colors**: Imaginations red (#e9362c) for headers, gray tones for accents
- **Font Sizes**: 10pt body text, 8pt abstracts, 9pt references, matching print media queries
- **Bilingual Support**: Two-column layout for English/French abstracts
- **Headers/Footers**: Issue information, page numbers, and running heads (8.5pt font)
- **Typography Elements**: Proper formatting for titles, abstracts, body text, footnotes, references

## Usage

To use this template with pandoc:

```bash
pandoc sample_article.md \
  --template=templates/article_template.tex \
  --pdf-engine=xelatex \
  -o output.pdf
```

## Required Fonts

Make sure you have the following fonts installed:

- **Linux Libertine O** (serif font for body text)
- **Muli** (sans-serif font for headers and UI elements)
- **Courier New** (monospace font for code)

Linux Libertine O can be downloaded from [Libertine Open Fonts Project](http://libertine-fonts.org/).
Muli can be installed from Google Fonts or your system's font manager.

## Template Variables

The template expects these variables in the YAML front matter:

- `title.en_US`: Article title in English
- `authors`: Array of author objects with `givenName.en_US` and `familyName.en_US`
- `abstract.en_US`: English abstract (optional)
- `abstract.fr_CA`: French abstract (optional)
- `short_title`: Short title for running heads
- `short_author`: Short author name for running heads
- `issue`: Issue designation (e.g., "13(2)")
- `start_page`: Starting page number (optional)

## Comparison with HTML Template

This XeLaTeX template reproduces the key design elements from the HTML template:

| Element   | HTML Template (Print)     | XeLaTeX Template        |
| --------- | ------------------------- | ----------------------- |
| Page Size | 7in × 10in                | 7in × 10in              |
| Fonts     | Linux Libertine O, Muli   | Linux Libertine O, Muli |
| Body Text | 10pt                      | 10pt                    |
| Abstract  | 8pt                       | 8pt                     |
| Headers   | 8.5pt                     | 8.5pt                   |
| Colors    | #e9362c red, #999999 gray | Same color values       |
| Margins   | 80pt/160pt/112pt          | Same margins            |
| Layout    | Two-column bilingual      | Two-column bilingual    |

## Sample Output

See `sample_article.md` for a demonstration document that shows all the template features in action.
