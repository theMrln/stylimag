const { describe, test } = require('node:test')
const assert = require('node:assert')
const {
  mapMetadataToPublicationUpdate,
  mergeMultilingualPatch,
  backfillMissingOjsLocales,
  getAcceptedOjsLocales,
  restrictToAcceptedLocales,
} = require('./ojsMetadataMapper.js')

describe('ojsMetadataMapper', () => {
  describe('mergeMultilingualPatch', () => {
    test('applies non-empty patch locales over existing', () => {
      const merged = mergeMultilingualPatch(
        { en_US: 'Old EN', fr_CA: 'FR intact' },
        { en_US: 'New EN' }
      )
      assert.deepEqual(merged, {
        en_US: 'New EN',
        fr_CA: 'FR intact',
      })
    })

    test('builds from patch only when existing is null', () => {
      assert.deepEqual(mergeMultilingualPatch(null, { en_US: 'Only EN' }), {
        en_US: 'Only EN',
      })
    })
  })

  describe('backfillMissingOjsLocales', () => {
    test('fills blank fr_CA from en_US (defaults to en_US/fr_CA)', () => {
      assert.deepEqual(
        backfillMissingOjsLocales(
          { en_US: 'Hello', fr_CA: '' },
          new Set()
        ),
        { en_US: 'Hello', fr_CA: 'Hello' }
      )
    })

    test('only fills locales in accepted set when provided', () => {
      assert.deepEqual(
        backfillMissingOjsLocales({ en_US: 'T' }, new Set(['fr_CA'])),
        { en_US: 'T', fr_CA: 'T' }
      )
    })

    test('does not invent en_US when not accepted', () => {
      assert.deepEqual(
        backfillMissingOjsLocales(
          { fr_CA: 'Bonjour' },
          new Set(['fr_CA'])
        ),
        { fr_CA: 'Bonjour' }
      )
    })
  })

  describe('getAcceptedOjsLocales', () => {
    test('infers locales from publication title and abstract keys', () => {
      const accepted = getAcceptedOjsLocales({
        title: { fr_CA: 'T' },
        abstract: { fr_CA: 'A' },
        locale: 'fr_CA',
      })
      assert.deepEqual([...accepted].sort(), ['fr_CA'])
    })

    test('union across multilingual fields and primary locale', () => {
      const accepted = getAcceptedOjsLocales({
        title: { en_US: 'T' },
        subtitle: { fr_CA: 'S' },
        locale: 'fr_CA',
      })
      assert.deepEqual([...accepted].sort(), ['en_US', 'fr_CA'])
    })

    test('empty when publication has no hints', () => {
      assert.equal(getAcceptedOjsLocales(null).size, 0)
      assert.equal(getAcceptedOjsLocales({}).size, 0)
    })
  })

  describe('restrictToAcceptedLocales', () => {
    test('drops keys not in accepted set', () => {
      assert.deepEqual(
        restrictToAcceptedLocales(
          { en_US: 'X', fr_CA: 'Y', es_ES: 'Z' },
          new Set(['fr_CA'])
        ),
        { fr_CA: 'Y' }
      )
    })

    test('no-op when accepted set is empty', () => {
      assert.deepEqual(
        restrictToAcceptedLocales(
          { en_US: 'X', fr_CA: 'Y' },
          new Set()
        ),
        { en_US: 'X', fr_CA: 'Y' }
      )
    })
  })

  describe('mapMetadataToPublicationUpdate', () => {
    test('merges title and abstract with existing publication', () => {
      const body = mapMetadataToPublicationUpdate(
        {
          title: { en_US: 'Edited' },
          abstract: { en_US: 'Abs EN' },
          start_page: 12,
        },
        {
          title: { en_US: 'Was', fr_CA: 'Était' },
          abstract: { fr_CA: 'Résumé', en_US: 'Was abs' },
        }
      )
      assert.deepEqual(body, {
        title: { en_US: 'Edited', fr_CA: 'Était' },
        abstract: { en_US: 'Abs EN', fr_CA: 'Résumé' },
        pages: '12',
      })
    })

    test('omits pages when start_page is not a number or numeric string', () => {
      const body = mapMetadataToPublicationUpdate(
        { title: { en_US: 'T' }, start_page: { x: 1 } },
        null
      )
      assert.deepEqual(body, { title: { en_US: 'T', fr_CA: 'T' } })
    })

    test('backfills fr_CA on title when GET shows fr_CA but is empty', () => {
      const body = mapMetadataToPublicationUpdate(
        { title: { en_US: 'Only EN' }, abstract: { en_US: 'A' } },
        {
          title: { en_US: 'Old', fr_CA: '' },
          abstract: { en_US: 'Old abs', fr_CA: '' },
        }
      )
      assert.deepEqual(body, {
        title: { en_US: 'Only EN', fr_CA: 'Only EN' },
        abstract: { en_US: 'A', fr_CA: 'A' },
      })
    })

    test('drops en_US when journal only accepts fr_CA, preserves existing fr_CA', () => {
      // Safe default: if the user only edits in en_US but the journal only
      // accepts fr_CA, we do NOT overwrite the existing French text with
      // English. The user must add a fr_CA value to actually change it.
      const body = mapMetadataToPublicationUpdate(
        {
          title: { en_US: 'English only in panel' },
          abstract: { en_US: 'Abs EN' },
        },
        {
          title: { fr_CA: 'Ancien titre' },
          abstract: { fr_CA: 'Résumé existant' },
          locale: 'fr_CA',
        }
      )
      assert.deepEqual(body, {
        title: { fr_CA: 'Ancien titre' },
        abstract: { fr_CA: 'Résumé existant' },
      })
    })

    test('promotes en_US text to fr_CA when journal only accepts fr_CA and existing fr_CA is empty', () => {
      // Best-effort: if OJS has fr_CA as a key but it is blank, fill it from
      // the en_US value rather than push an empty PUT (which would still 400).
      const body = mapMetadataToPublicationUpdate(
        {
          title: { en_US: 'English only in panel' },
          abstract: { en_US: 'Abs EN' },
        },
        {
          title: { fr_CA: '' },
          abstract: { fr_CA: '' },
          locale: 'fr_CA',
        }
      )
      assert.deepEqual(body, {
        title: { fr_CA: 'English only in panel' },
        abstract: { fr_CA: 'Abs EN' },
      })
    })
  })
})
