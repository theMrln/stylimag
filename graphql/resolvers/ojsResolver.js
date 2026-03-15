const ojsHelper = require('../helpers/ojs')
const {
  extractLocalizedText,
  mapOjsToOjsMetadata,
  mapOjsIssueToCorpusMetadata,
  extractArticleTitle,
} = require('../helpers/ojsMetadataMapper')
const Corpus = require('../models/corpus')
const Article = require('../models/article')
const Workspace = require('../models/workspace')
const { NotAuthenticatedError, NotFoundError } = require('../helpers/errors')
const Y = require('yjs')
const { logger } = require('../logger')

module.exports = {
  Query: {
    async ojsInstances(_, _args, { user }) {
      if (!user) {
        throw new NotAuthenticatedError()
      }
      return ojsHelper.getAvailableOjsInstances()
    },

    async ojsIssues(_, { instance }, { user }) {
      if (!user) {
        throw new NotAuthenticatedError()
      }
      return ojsHelper.getOjsIssues(instance)
    },
  },

  Mutation: {
    async importCorpusFromOJS(_, { issueId, workspaceId, instance }, { user }) {
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
      const issueMetadata = await ojsHelper.getOjsIssueMetadata(
        instance,
        issueId
      )
      logger.info(
        `OJS Issue metadata keys: ${Object.keys(issueMetadata || {}).join(', ')}`
      )

      // Extract title from localizations (e.g. en_US or fr_CA)
      const title =
        extractLocalizedText(issueMetadata?.title) ||
        extractLocalizedText(issueMetadata?.name) ||
        `Issue ${issueId}`

      // 2. Create Corpus (metadata in journal schema shape from issue, ojs kept for reference)
      const corpusMetadata = mapOjsIssueToCorpusMetadata(issueMetadata)
      const newCorpus = new Corpus({
        name: title,
        type: 'journal',
        description: extractLocalizedText(issueMetadata?.description),
        articles: [],
        metadata: corpusMetadata,
        workspace: workspaceId,
        creator: user._id,
      })
      await newCorpus.save()

      // 3. Fetch Submissions/Publications
      // The issue metadata might have "articles" array which contains the submissions
      const submissions = await ojsHelper.getOjsIssueSubmissions(
        instance,
        issueId
      )

      // Log first submission structure for debugging
      if (submissions.length > 0) {
        logger.info(
          `OJS first submission FULL: ${JSON.stringify(submissions[0], null, 2)}`
        )
      }

      // 4. Create Articles (each submission enriched with full publication for authors etc.)
      let order = 0
      const sectionTitleCache = new Map()
      for (const submission of submissions) {
        const submissionWithPublication =
          await ojsHelper.getSubmissionWithFullPublication(instance, submission)

        logger.info(
          `OJS submission keys: ${Object.keys(submissionWithPublication || {}).join(', ')}`
        )

        // Extract article title for the Article model
        const articleTitle = extractArticleTitle(submissionWithPublication)

        // Store metadata in OJS-native shape for export and form editing
        const articleMetadata = mapOjsToOjsMetadata(
          submissionWithPublication,
          issueMetadata
        )

        // Create Yjs doc (empty body - content is added by user)
        const yDoc = new Y.Doc({ gc: false })
        yDoc.getText('main') // ensure main text exists
        // Leave body empty - user will add content
        const documentState = Y.encodeStateAsUpdate(yDoc)

        const newArticle = new Article({
          title: articleTitle,
          owner: user,
          workingVersion: {
            md: '',
            bib: '',
            metadata: articleMetadata,
            ydoc: Buffer.from(documentState).toString('base64'),
          },
        })
        await newArticle.save()

        // Add to Corpus (section, sectionTitle, seq from OJS publication for ordering and display)
        const publication = submissionWithPublication?.publications?.[0]
        const sectionObj = publication?.section
        const section =
          publication?.sectionId ??
          (typeof sectionObj === 'object' && sectionObj !== null
            ? sectionObj.id
            : sectionObj)
        let sectionTitle =
          typeof sectionObj === 'object' && sectionObj?.title != null
            ? extractLocalizedText(sectionObj.title)
            : publication?.sectionTitle != null
              ? extractLocalizedText(publication.sectionTitle)
              : undefined
        if (section != null && !sectionTitle?.trim()) {
          const cacheKey = String(section)
          if (!sectionTitleCache.has(cacheKey)) {
            const sectionMeta = await ojsHelper.getOjsSection(instance, section)
            const title = sectionMeta
              ? (typeof sectionMeta.title === 'string'
                  ? sectionMeta.title
                  : extractLocalizedText(sectionMeta.title))
              : ''
            sectionTitleCache.set(cacheKey, title)
          }
          const cached = sectionTitleCache.get(cacheKey)
          sectionTitle = cached?.trim() ? cached : undefined
        }
        const seq =
          typeof publication?.seq === 'number' ? publication.seq : order
        newCorpus.articles.push({
          article: newArticle,
          order: order++,
          section: section != null ? section : undefined,
          sectionTitle: sectionTitle || undefined,
          seq,
        })

        // Add to Workspace (if in a workspace)
        if (workspace?.articles && Array.isArray(workspace.articles)) {
          workspace.articles.push(newArticle)
        }

        // Add to User's articles (if the user model has articles array)
        if (user.articles && Array.isArray(user.articles)) {
          user.articles.push(newArticle)
        }
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
