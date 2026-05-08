const YAML = require('js-yaml')
const { toLegacyFormat } = require('./metadata.js')

/**
 * Regenerate the YAML frontmatter view of an article from its workingVersion
 * metadata, augmented with editor-supplied corpus-level fields (issue id,
 * editors, imageCredit). Mirrors imaginations-issue-template's
 * `injectArticleYamlFromJson`, but operates on stylimag's data shape: the
 * Article in Mongo is canonical, the OJS-derived bits are merged on top.
 *
 * Returns `{ yaml, markdown }`. Markdown is the rebuilt MD with the new
 * YAML frontmatter spliced in (preserving the body). The caller decides
 * whether to write `markdown` back to `article.workingVersion.md`.
 */
function rebuildArticleYaml({ article, corpus }) {
  const baseMetadata = {
    ...(article.workingVersion?.metadata ?? {}),
  }

  // If the corpus is a journal-issue corpus, prefer the corpus-side fields
  // for issue context; the article-side metadata may still be empty when
  // articles are first imported from OJS.
  if (corpus) {
    if (!baseMetadata.issue && corpus.metadata?.issueId) {
      baseMetadata.issue = corpus.metadata.issueId
    }
    if (!baseMetadata.imageCredit && corpus.imageCredit) {
      baseMetadata.imageCredit = corpus.imageCredit
    }
    if (
      Array.isArray(corpus.editors) &&
      corpus.editors.length > 0 &&
      !Array.isArray(baseMetadata.editors)
    ) {
      baseMetadata.editors = corpus.editors.map((e) => ({
        familyName: e.familyName || '',
        givenName: e.givenName || '',
        email: e.email || '',
        ORCID: e.ORCID || '',
        affiliation: e.affiliation || '',
        bio: e.bio || '',
      }))
    }
  }

  const legacy = toLegacyFormat(baseMetadata)
  const yaml = YAML.dump(legacy)
  const md = article.workingVersion?.md ?? ''

  // Splice the YAML in: replace existing frontmatter if present, otherwise
  // prepend.
  let body = md
  if (body.startsWith('---')) {
    const endIdx = body.indexOf('\n---', 3)
    if (endIdx !== -1) body = body.slice(endIdx + 4).replace(/^\n+/, '')
  }
  const markdown = `---\n${yaml}---\n\n${body}`

  return { yaml, markdown, metadata: baseMetadata }
}

module.exports = { rebuildArticleYaml }
