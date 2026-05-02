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

// PKPSubmission submission.status (pkp-lib): Published and Scheduled are both
// assigned to an issue for the public/future TOC. Queued (1) is in-workflow.
const OJS_SUBMISSION_STATUS_PUBLISHED = 3
const OJS_SUBMISSION_STATUS_SCHEDULED = 5

function ojsSubmissionIsImportableForIssue(status) {
  const n = Number(status)
  return (
    n === OJS_SUBMISSION_STATUS_PUBLISHED ||
    n === OJS_SUBMISSION_STATUS_SCHEDULED
  )
}

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
        issueId,
        { issueData: issueMetadata }
      )

      logger.info(
        `OJS issueMetadata top-level keys: ${Object.keys(issueMetadata || {}).join(', ')}`
      )
      // Log first submission structure for debugging
      if (submissions.length > 0) {
        logger.info(
          `OJS first submission FULL: ${JSON.stringify(submissions[0], null, 2)}`
        )
      }

      // Per-issue section order. OJS lets editors override the journal-wide
      // section seq for an individual issue (custom_issue_orders table), so
      // /sections/:id is wrong as a section-ordering source — it gives the
      // journal-global seq, not the per-issue one.
      //
      // Preferred sources, in order:
      //   1. issueMetadata.sections — newer OJS responses include the
      //      per-issue section list with the right seq baked in.
      //   2. First-appearance order in issue.articles. OJS pre-sorts the
      //      `articles` array by (custom section order, publication.seq),
      //      so the order in which a section's first article shows up
      //      reproduces the editorial section order. Note that this uses
      //      the *array* order, NOT submission-id/creation order — which
      //      is what we were warned off of last round.
      //   3. /sections/:id seq (journal-global) — last-resort fallback.
      const issueSectionSeqById = new Map()
      if (Array.isArray(issueMetadata?.sections)) {
        // Dump the full sections array so we can audit the field shape if
        // the per-issue order ever drifts from what readers see on OJS.
        logger.info(
          `OJS issueMetadata.sections (full): ${JSON.stringify(issueMetadata.sections)}`
        )
        // OJS exposes the section's display position as `sequence` (with
        // gaps that reflect its position among ALL journal sections).
        // Some OJS versions also carry `seq` (a compacted 1..N value).
        // Either drives the right ordering; we prefer `sequence` because
        // that's the semantic OJS field, and fall back to `seq`, then to
        // the array index as a last resort.
        for (let i = 0; i < issueMetadata.sections.length; i++) {
          const s = issueMetadata.sections[i]
          if (s?.id != null) {
            const sortKey =
              typeof s.sequence === 'number'
                ? s.sequence
                : typeof s.seq === 'number'
                  ? s.seq
                  : i
            issueSectionSeqById.set(String(s.id), sortKey)
          }
        }
        logger.info(
          `OJS per-issue section sort keys (id → sectionSeq): ${JSON.stringify(
            [...issueSectionSeqById.entries()]
          )}`
        )
      }
      const firstAppearanceSeqById = new Map()

      // 4a. Skip in-workflow / non-TOC submissions. OJS' /issues/:id endpoint,
      // when called with an editor-level API token, returns ALL submissions
      // assigned to the issue, including queued drafts (status=1) that
      // readers never see on the public issue page. Importing those is
      // what causes phantom sections (e.g. a draft tied to a section that
      // isn't in issueMetadata.sections) and what looks like a "duplicate"
      // article when a published submission has a parallel draft attached
      // to the same issue. We import STATUS_PUBLISHED (3) and
      // STATUS_SCHEDULED (5): the latter is used for articles in a future
      // issue before it goes live; without it, a "future issue" import would
      // create an empty corpus.
      const importableSubmissions = []
      for (const submission of submissions) {
        const status = submission?.status
        if (ojsSubmissionIsImportableForIssue(status)) {
          importableSubmissions.push(submission)
        } else {
          logger.warn(
            `OJS import: skipping submission ${submission?.id} (status=${status}, label=${submission?.statusLabel ?? 'unknown'}); only Published (3) and Scheduled (5) are imported`
          )
        }
      }

      // 4b. Dedupe submissions by submission id BEFORE creating articles.
      // The issue.articles array can list multiple publications of the same
      // submission (e.g. a draft alongside the published version when an
      // editor never cleaned up the staged version). We keep the publication
      // that matches the submission's `currentPublicationId` if present,
      // otherwise the first one we see — and log both ids so you can find
      // the rogue draft in OJS.
      const seenSubmissionIds = new Map()
      const dedupedSubmissions = []
      for (const submission of importableSubmissions) {
        const subId =
          submission?.id ??
          submission?.submissionId ??
          submission?.publications?.[0]?.submissionId
        if (subId == null) {
          dedupedSubmissions.push(submission)
          continue
        }
        const key = String(subId)
        // The publication id OF THIS entry — not the submission's canonical
        // currentPublicationId, which we compare against separately to
        // decide which duplicate to keep.
        const incomingPubId = submission?.publications?.[0]?.id ?? null
        const existing = seenSubmissionIds.get(key)
        if (!existing) {
          seenSubmissionIds.set(key, {
            index: dedupedSubmissions.length,
            submission,
            publicationId: incomingPubId,
          })
          dedupedSubmissions.push(submission)
          continue
        }
        // Duplicate: prefer the entry whose publicationId matches the
        // submission's currentPublicationId (OJS' canonical published one).
        const currentPubId = submission?.currentPublicationId ?? null
        const incomingMatchesCurrent =
          currentPubId != null && incomingPubId === currentPubId
        const existingMatchesCurrent =
          currentPubId != null && existing.publicationId === currentPubId
        if (incomingMatchesCurrent && !existingMatchesCurrent) {
          logger.warn(
            `OJS import dedup: replacing duplicate of submission ${subId}: kept publication ${incomingPubId}, dropped ${existing.publicationId}`
          )
          dedupedSubmissions[existing.index] = submission
          seenSubmissionIds.set(key, {
            index: existing.index,
            submission,
            publicationId: incomingPubId,
          })
        } else {
          logger.warn(
            `OJS import dedup: skipping duplicate of submission ${subId}: kept publication ${existing.publicationId}, dropped ${incomingPubId}`
          )
        }
      }

      // 5. Enrich every submission with its full publication BEFORE we start
      // creating articles. We need section/seq from the full publication to
      // sort the list, and OJS' /issues/:id pre-sort isn't available on the
      // /submissions fallback path used for unpublished/future issues.
      const enrichedSubmissions = await Promise.all(
        dedupedSubmissions.map((submission) =>
          ojsHelper.getSubmissionWithFullPublication(instance, submission)
        )
      )

      // 5b. Sort by (per-issue sectionSeq, publication.seq, submission id).
      // This mirrors how OJS pre-sorts the /issues/:id articles array, so
      // the corpus order matches the editor's TOC even when we got the
      // submissions list via /submissions?issueIds[] (future issues).
      // Number(...) coerces string seq values some OJS versions emit; the
      // PUB_SEQ_MISSING sentinel pushes anything without a usable seq to
      // the end of the section.
      const PUB_SEQ_MISSING = Number.MAX_SAFE_INTEGER
      const toFiniteNumber = (v) => {
        if (typeof v === 'number') return Number.isFinite(v) ? v : null
        if (typeof v === 'string') {
          const n = Number(v)
          return Number.isFinite(n) ? n : null
        }
        return null
      }
      const sortKeyFor = (s) => {
        const pub = s?.publications?.[0]
        const sectionObj = pub?.section
        const sectionId =
          pub?.sectionId ??
          (typeof sectionObj === 'object' && sectionObj !== null
            ? sectionObj.id
            : sectionObj)
        const sectionKey = sectionId != null ? String(sectionId) : ''
        const sectionSeq =
          sectionKey && issueSectionSeqById.has(sectionKey)
            ? issueSectionSeqById.get(sectionKey)
            : Number.MAX_SAFE_INTEGER
        const pubSeqNum = toFiniteNumber(pub?.seq)
        const pubSeq = pubSeqNum != null ? pubSeqNum : PUB_SEQ_MISSING
        const subId =
          toFiniteNumber(s?.id) ?? Number.MAX_SAFE_INTEGER
        return [sectionSeq, pubSeq, subId]
      }

      // Pre-sort dump: useful when TOC order doesn't match what we expect.
      // Includes raw publication.seq (so we can see if OJS even returned it),
      // dateSubmitted (a defensible fallback), and the sectionId.
      logger.info(
        `OJS import: enriched submissions BEFORE sort (n=${enrichedSubmissions.length}): ${JSON.stringify(
          enrichedSubmissions.map((s) => {
            const pub = s?.publications?.[0]
            return {
              submissionId: s?.id,
              currentPublicationId: s?.currentPublicationId,
              publicationId: pub?.id,
              pubSeq: pub?.seq ?? null,
              pubSeqType: pub?.seq != null ? typeof pub.seq : null,
              sectionId: pub?.sectionId ?? null,
              dateSubmitted: s?.dateSubmitted ?? null,
              datePublished: pub?.datePublished ?? s?.datePublished ?? null,
              status: s?.status,
            }
          })
        )}`
      )

      enrichedSubmissions.sort((a, b) => {
        const ka = sortKeyFor(a)
        const kb = sortKeyFor(b)
        return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]
      })

      logger.info(
        `OJS import: sort order AFTER sort: ${JSON.stringify(
          enrichedSubmissions.map((s) => ({
            submissionId: s?.id,
            sortKey: sortKeyFor(s),
            title: extractArticleTitle(s),
          }))
        )}`
      )

      // 5c. Create Articles. We do NOT seed `order` here: that field is
      // reserved for the user's manual drag-and-drop reorders. The corpus
      // `seq` is the within-section index after the sort above (0..N-1).
      // Using a per-section counter (instead of trusting publication.seq
      // verbatim) is what makes the future-issue path correct: scheduled
      // publications often all report seq=0, which would tie every article
      // together at display time. The values still round-trip cleanly when
      // pushed back via pushCorpusArticleOrderToOJS, which recomputes
      // 0..N-1 per section from display order.
      const seqBySection = new Map()
      const sectionMetaCache = new Map()
      for (const submissionWithPublication of enrichedSubmissions) {
        const submission = submissionWithPublication

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

        // Fetch the section once per id so we get both its title and its
        // display seq. Either may already be present on the publication
        // payload; only fall back to /sections/:id when something is missing.
        let sectionMeta = null
        if (section != null) {
          const cacheKey = String(section)
          if (!sectionMetaCache.has(cacheKey)) {
            sectionMetaCache.set(
              cacheKey,
              await ojsHelper.getOjsSection(instance, section)
            )
          }
          sectionMeta = sectionMetaCache.get(cacheKey)
        }

        let sectionTitle =
          typeof sectionObj === 'object' && sectionObj?.title != null
            ? extractLocalizedText(sectionObj.title)
            : publication?.sectionTitle != null
              ? extractLocalizedText(publication.sectionTitle)
              : undefined
        if (!sectionTitle?.trim() && sectionMeta) {
          sectionTitle =
            typeof sectionMeta.title === 'string'
              ? sectionMeta.title
              : extractLocalizedText(sectionMeta.title)
        }

        // Section display order: per-issue order, with fallbacks.
        const sectionKey = section != null ? String(section) : ''
        if (sectionKey && !firstAppearanceSeqById.has(sectionKey)) {
          firstAppearanceSeqById.set(sectionKey, firstAppearanceSeqById.size)
        }
        const sectionSeq = sectionKey
          ? issueSectionSeqById.has(sectionKey)
            ? issueSectionSeqById.get(sectionKey)
            : firstAppearanceSeqById.get(sectionKey)
          : null

        const seqKey = sectionKey || ''
        const seq = seqBySection.get(seqKey) ?? 0
        seqBySection.set(seqKey, seq + 1)

        // Prominently log the (submission, publication, section, title)
        // tuple so duplicates and section-order issues are easy to chase
        // from the logs and matched up to the UI.
        logger.info(
          `OJS import: corpus article submission=${submission?.id} publication=${publication?.id} title="${articleTitle ?? ''}" section=${section} sectionSeq=${sectionSeq} seq=${seq}`
        )

        newCorpus.articles.push({
          article: newArticle,
          section: section != null ? section : undefined,
          sectionTitle: sectionTitle?.trim() ? sectionTitle : undefined,
          sectionSeq: sectionSeq != null ? sectionSeq : undefined,
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

      // Sort the corpus articles the same way the corpus page does, so
      // the OJS push matches what the user sees. Sections by `sectionSeq`
      // (per-issue custom order captured at import); within a section,
      // manual `order` wins over publication `seq`.
      const sorted = [...corpus.articles].sort((a, b) => {
        const ssa = a.sectionSeq
        const ssb = b.sectionSeq
        if (ssa != null && ssb != null && ssa !== ssb) return ssa - ssb
        if (ssa != null && ssb == null) return -1
        if (ssa == null && ssb != null) return 1
        if (ssa == null && ssb == null) {
          const sa = String(a.section ?? '')
          const sb = String(b.section ?? '')
          if (sa !== sb) return sa.localeCompare(sb)
        }
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
