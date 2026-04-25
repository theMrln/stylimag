const ojsHelper = require('../helpers/ojs')
const {
  extractLocalizedText,
  mapOjsToOjsMetadata,
  mapOjsIssueToCorpusMetadata,
  mapMetadataToPublicationUpdate,
  extractArticleTitle,
} = require('../helpers/ojsMetadataMapper')
const Corpus = require('../models/corpus')
const Article = require('../models/article')
const Workspace = require('../models/workspace')
const { NotAuthenticatedError, NotFoundError } = require('../helpers/errors')
const Y = require('yjs')
const { logger } = require('../logger')

/**
 * Build name-match keys for an OJS-shaped author. Each returned key is
 * `family|given` with both parts trimmed and lower-cased. We emit the
 * cross-product across all locales present on either side so authors that
 * share a name in any locale match.
 *
 * @param {{givenName?: object|string, familyName?: object|string}} author
 * @returns {string[]}
 */
function authorNameKeys(author) {
  if (!author) return []
  const normalize = (s) =>
    String(s ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
  const collect = (v) => {
    if (v == null) return []
    if (typeof v === 'object') {
      return Object.values(v).map(normalize).filter(Boolean)
    }
    const n = normalize(v)
    return n ? [n] : []
  }
  const givens = collect(author.givenName)
  const families = collect(author.familyName)
  if (givens.length === 0 && families.length === 0) return []
  const keys = new Set()
  const gs = givens.length ? givens : ['']
  const fs = families.length ? families : ['']
  for (const g of gs) for (const f of fs) keys.add(`${f}|${g}`)
  return [...keys]
}

/**
 * Diff the side-panel authors list against the publication's current OJS
 * authors and apply add/update/delete. Matching strategy:
 *
 *   1. Name-based: an existing author whose name matches a desired author
 *      (in any locale) is updated in place. This makes reorders safe — emails,
 *      ORCIDs and affiliations stay attached to the right person.
 *   2. Positional fallback only when the number of leftover desired authors
 *      equals the number of leftover existing authors (i.e. pure renames with
 *      no net add or remove). This preserves OJS metadata when a typo is
 *      fixed but avoids reassigning a deleted author's email to a brand-new
 *      one.
 *   3. Anything still unmatched is created (POST) or deleted (DELETE).
 *
 * Each updated/created author gets `seq: i` so OJS reflects the new order.
 *
 * New authors inherit `userGroupId` from an existing OJS author on the same
 * publication; if the publication has no existing authors, throw — the user
 * must seed at least one author from the OJS UI first so we know which user
 * group to use.
 *
 * @param {'staging'|'production'} instance
 * @param {number|string} submissionId
 * @param {number|string} publicationId
 * @param {Array<{givenName?: object, familyName?: object}>} desiredAuthors
 */
async function syncOjsAuthors(
  instance,
  submissionId,
  publicationId,
  desiredAuthors
) {
  const existing = await ojsHelper.getOjsPublicationAuthors(
    instance,
    submissionId,
    publicationId
  )
  const fallbackUserGroupId = existing[0]?.userGroupId

  const matches = new Array(desiredAuthors.length).fill(null)
  const claimed = new Set()

  // Pass 1: match by name across any locale.
  for (let i = 0; i < desiredAuthors.length; i++) {
    const desiredKeys = authorNameKeys(desiredAuthors[i])
    if (desiredKeys.length === 0) continue
    for (const candidate of existing) {
      if (claimed.has(candidate.id)) continue
      const candKeys = authorNameKeys(candidate)
      if (candKeys.some((k) => desiredKeys.includes(k))) {
        matches[i] = candidate
        claimed.add(candidate.id)
        break
      }
    }
  }

  // Pass 2: positional fallback for the leftovers — but only when the
  // counts on each side match, i.e. pure renames with no net add/remove.
  const unmatchedDesiredIdx = matches
    .map((m, i) => (m ? -1 : i))
    .filter((i) => i >= 0)
  const unclaimedExisting = existing.filter((e) => !claimed.has(e.id))
  if (
    unmatchedDesiredIdx.length > 0 &&
    unmatchedDesiredIdx.length === unclaimedExisting.length
  ) {
    for (let k = 0; k < unmatchedDesiredIdx.length; k++) {
      matches[unmatchedDesiredIdx[k]] = unclaimedExisting[k]
      claimed.add(unclaimedExisting[k].id)
    }
  }

  // Apply: update matched, create unmatched.
  for (let i = 0; i < desiredAuthors.length; i++) {
    const desired = desiredAuthors[i] ?? {}
    const givenName = desired.givenName ?? {}
    const familyName = desired.familyName ?? {}
    const slot = matches[i]

    if (slot) {
      await ojsHelper.updateOjsAuthor(
        instance,
        submissionId,
        publicationId,
        slot.id,
        { givenName, familyName, seq: i }
      )
    } else {
      if (fallbackUserGroupId == null) {
        throw new Error(
          'Cannot create new OJS authors: the publication has no existing authors to copy a userGroupId from. Add at least one author in OJS first.'
        )
      }
      await ojsHelper.createOjsAuthor(
        instance,
        submissionId,
        publicationId,
        {
          givenName,
          familyName,
          userGroupId: fallbackUserGroupId,
          publicationId,
          seq: i,
        }
      )
    }
  }

  // Delete anything still unclaimed.
  for (const candidate of existing) {
    if (claimed.has(candidate.id)) continue
    await ojsHelper.deleteOjsAuthor(
      instance,
      submissionId,
      publicationId,
      candidate.id
    )
  }
}

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
      const corpusMetadata = mapOjsIssueToCorpusMetadata(issueMetadata, instance)
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
          issueMetadata,
          instance
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

    async pushArticleMetadataToOJS(_, { articleId, instance }, { user }) {
      if (!user) {
        throw new NotAuthenticatedError()
      }

      const article = await Article.findById(articleId)
      if (!article) {
        throw new NotFoundError('Article', articleId)
      }

      const metadata = article.workingVersion?.metadata ?? {}
      const ref = metadata.ojs
      if (!ref || typeof ref !== 'object') {
        throw new Error(
          'This article was not imported from OJS — no submission/publication reference is stored.'
        )
      }

      const submissionId = ref.id
      const publicationId =
        ref.currentPublicationId ?? ref.publications?.[0]?.id
      const targetInstance = instance ?? ref._instance

      if (!targetInstance) {
        throw new Error(
          'OJS instance is unknown for this article. Pass `instance` explicitly.'
        )
      }
      if (submissionId == null || publicationId == null) {
        throw new Error(
          'Missing OJS submission or publication id on this article.'
        )
      }

      const body = mapMetadataToPublicationUpdate(metadata)
      if (Object.keys(body).length === 0 && !Array.isArray(metadata.authors)) {
        throw new Error('No pushable fields are set on this article.')
      }

      logger.info(
        `Pushing article ${articleId} metadata to OJS [${targetInstance}] submission=${submissionId} publication=${publicationId}`
      )

      if (Object.keys(body).length > 0) {
        await ojsHelper.updateOjsPublication(
          targetInstance,
          submissionId,
          publicationId,
          body
        )
      }

      if (Array.isArray(metadata.authors)) {
        await syncOjsAuthors(
          targetInstance,
          submissionId,
          publicationId,
          metadata.authors
        )
      }

      return true
    },

    async pushCorpusArticleOrderToOJS(_, { corpusId, instance }, { user }) {
      if (!user) {
        throw new NotAuthenticatedError()
      }

      const corpus = await Corpus.findById(corpusId).populate({
        path: 'articles.article',
        select: 'workingVersion.metadata',
      })
      if (!corpus) {
        throw new NotFoundError('Corpus', corpusId)
      }

      // Default to the instance recorded on the corpus at import; can be
      // overridden by the caller (e.g. when the user picks a target).
      const corpusInstance = corpus.metadata?.ojs?._instance ?? null
      const fallbackInstance = instance ?? corpusInstance

      // Sort the corpus articles using the same key as the corpus page so the
      // OJS push matches what the user sees. Within a section, manual `order`
      // takes precedence over the original `seq`.
      const sorted = [...corpus.articles].sort((a, b) => {
        const sa = String(a.section ?? '')
        const sb = String(b.section ?? '')
        if (sa !== sb) return sa.localeCompare(sb)
        const ka = a.order ?? a.seq ?? 0
        const kb = b.order ?? b.seq ?? 0
        return ka - kb
      })

      // Per-section running counter to compute the new seq.
      const seqBySection = new Map()
      let updated = 0
      const failures = []

      for (const corpusArticle of sorted) {
        const sectionKey = String(corpusArticle.section ?? '')
        const newSeq = seqBySection.get(sectionKey) ?? 0
        seqBySection.set(sectionKey, newSeq + 1)

        const article = corpusArticle.article
        const ref = article?.workingVersion?.metadata?.ojs
        if (!ref || typeof ref !== 'object') continue // not from OJS

        const submissionId = ref.id
        const publicationId =
          ref.currentPublicationId ?? ref.publications?.[0]?.id
        const targetInstance = ref._instance ?? fallbackInstance
        if (
          !targetInstance ||
          submissionId == null ||
          publicationId == null
        ) {
          failures.push(article._id)
          continue
        }

        try {
          await ojsHelper.updateOjsPublication(
            targetInstance,
            submissionId,
            publicationId,
            { seq: newSeq }
          )
          // Mirror the new seq on the corpus row so the local sort stays
          // consistent if `order` is ever cleared.
          corpusArticle.seq = newSeq
          updated++
        } catch (err) {
          logger.warn(
            `Failed to push seq=${newSeq} for article ${article._id} to OJS: ${err.message}`
          )
          failures.push(article._id)
        }
      }

      await corpus.save()

      if (failures.length > 0) {
        logger.warn(
          `pushCorpusArticleOrderToOJS: ${updated} updated, ${failures.length} failed/skipped (corpus ${corpusId})`
        )
      }

      return updated
    },
  },
}
