const ojsHelper = require('../helpers/ojs')
const Corpus = require('../models/corpus')
const Article = require('../models/article')
const Workspace = require('../models/workspace')
const { NotAuthenticatedError, NotFoundError, NotAuthorizedError } = require('../helpers/errors')
const Y = require('yjs')
const { logger } = require('../logger')

/**
 * Extract localized text from an OJS localized object
 * OJS can return titles/abstracts in various formats:
 * - { fr_CA: "...", en_US: "..." }
 * - { en: "...", fr: "..." }
 * - Just a string
 */
function extractLocalizedText(obj, fallback = '') {
  if (!obj) return fallback
  if (typeof obj === 'string') return obj
  
  // Try common locale keys
  return obj.fr_CA || obj.en_US || obj.fr || obj.en || 
         obj['fr-CA'] || obj['en-US'] ||
         // Get first available value
         Object.values(obj).find(v => typeof v === 'string' && v.trim()) ||
         fallback
}

module.exports = {
  Query: {
    async ojsIssues(_, args, { user }) {
      if (!user) {
        throw new NotAuthenticatedError()
      }
      return ojsHelper.getOjsIssues()
    },
  },

  Mutation: {
    async importCorpusFromOJS(_, { issueId, workspaceId }, { user }) {
      if (!user) {
        throw new NotAuthenticatedError()
      }

      // Check workspace access (if workspaceId provided)
      let workspace = null
      if (workspaceId) {
        workspace = await Workspace.getWorkspaceById(workspaceId, user)
        if (!workspace) {
          throw new NotFoundError('Workspace', workspaceId)
        }
      }

      // 1. Fetch Issue Metadata
      const issueMetadata = await ojsHelper.getOjsIssueMetadata(issueId)
      logger.info(`OJS Issue metadata keys: ${Object.keys(issueMetadata || {}).join(', ')}`)
      
      // Extract title from localizations (e.g. en_US or fr_CA)
      const title = extractLocalizedText(issueMetadata?.title) || 
                    extractLocalizedText(issueMetadata?.name) ||
                    `Issue ${issueId}`

      // 2. Create Corpus
      const newCorpus = new Corpus({
        name: title,
        type: 'journal', // Defaulting to journal for OJS imports
        description: extractLocalizedText(issueMetadata?.description),
        articles: [],
        metadata: {
            // Store original OJS metadata for reference
            ojs: issueMetadata
        },
        workspace: workspaceId,
        creator: user._id,
      })
      await newCorpus.save()

      // 3. Fetch Submissions/Publications
      // The issue metadata might have "articles" array which contains the submissions
      const submissions = await ojsHelper.getOjsIssueSubmissions(issueId)
      
      // Log first submission structure for debugging
      if (submissions.length > 0) {
        logger.info(`OJS first submission FULL: ${JSON.stringify(submissions[0], null, 2)}`)
      }

      // 4. Create Articles
        let order = 0
      for (const submission of submissions) {
          // In some OJS API versions, the issue article list is minimal, might need to fetch full publication
          // But usually it contains enough info.
          // The structure in "articles" from issue endpoint is usually:
          // { id: 123, title: {...}, ... }
          // But for full metadata (abstract, authors, etc) we might need the publication endpoint
          // However, let's start with what we have or fetch if needed.
          // Based on `c_get_article_update_from_ojs.sh`, it fetches `/submissions/$submission_id/publications/$publication_id`
          // The issue article list usually has `submissionId` or `id`.

          // Wait, the issue list items are usually publications? Or submissions?
          // Let's assume they are items we can iterate.

          const submissionId = submission.submissionId || submission.id
          // We assume the current published version is what we want.
          // If we need publication ID, we might need to find it.
          // But let's check one individual publication fetch to be sure of metadata.
          // Since we don't know the publication ID easily without fetching submission first...
          // Actually, let's try to trust the data in the issue list first if possible, or fetch.
          // To follow `c_get_article_update_from_ojs.sh`, we need `submissionId` and `publicationId`.

          // If the issue article entry has `publicationId`, we use it.
          // Otherwise we might need to list publications for the submission?
          // For now, let's assume we can get detailed info.

          // Optimization: Fetch details in parallel or sequentially if rate limiting is concern.

          // Log submission structure for debugging
          logger.info(`OJS submission keys: ${Object.keys(submission || {}).join(', ')}`)
          
          // OJS 3.x: titles are nested inside publications array
          // Get the current/first publication
          const publication = submission?.publications?.[0]
          
          // Create Stylo Article - try multiple possible title fields
          // First try publication titles (OJS 3.x structure), then fallback to submission-level
          const articleTitle = extractLocalizedText(publication?.fullTitle) ||
                               extractLocalizedText(publication?.title) ||
                               extractLocalizedText(submission?.fullTitle) ||
                               extractLocalizedText(submission?.title) ||
                               extractLocalizedText(submission?.name) ||
                               'Untitled'

          // Create Yjs doc
          const yDoc = new Y.Doc({ gc: false })
          const yText = yDoc.getText('main')
          const initialContent = extractLocalizedText(publication?.abstract) || 
                                  extractLocalizedText(submission?.abstract) || ''
          yText.insert(0, initialContent) // Put abstract in content? Or just empty?
          // User request says "pulling the metadata ... and recreate them for stylo"
          // Maybe abstract should be in metadata, not body.
          // Let's keep body empty or with title.
          // Let's leave body empty for now as per "editor" usually starts empty.

          const documentState = Y.encodeStateAsUpdate(yDoc)

          // Map OJS metadata to Stylo metadata
          // Stylo uses a flat metadata structure or specific keys.
          // We can put all OJS data into a specialized key or map to standard fields.
          // standard fields: title, abstract, authors (contributors), etc.

          const newArticle = new Article({
              title: articleTitle,
              owner: user,
              workingVersion: {
                  md: '',
                  bib: '',
                  metadata: {
                      abstract: extractLocalizedText(publication?.abstract) || extractLocalizedText(submission?.abstract),
                      ojs: submission // Store full object for reference
                  },
                  ydoc: Buffer.from(documentState).toString('base64'),
              }
          })
          await newArticle.save()

          // Add to Corpus
          newCorpus.articles.push({ article: newArticle, order: order++ })

          // Add to Workspace (if in a workspace)
          if (workspace) {
            workspace.articles.push(newArticle)
          }

          // Add to User's articles
          user.articles.push(newArticle)

      }

      const savePromises = [newCorpus.save(), user.save()]
      if (workspace) {
        savePromises.push(workspace.save())
      }
      await Promise.all(savePromises)

      return newCorpus
    },
  },
}
