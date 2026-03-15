# Imaginations Branch: Change Report & Merge Guide

**Branch:** `imaginations`  
**Baseline:** `main` (or upstream default)  
**Scope:** 87 files changed, ~4,721 insertions, ~308 deletions

This document summarizes all changes since the branch diverged, where the two branches differ, and how to merge safely going forward.

---

## 1. Executive Summary

The **imaginations** branch adds:

- **OJS (Open Journal Systems) integration**: Import journal issues as Stylo corpora with articles and OJS-shaped metadata.
- **Imaginations-themed UI**: Light header, signature red (#e9362c), Merriweather/Mulish typography, info bars and version UI aligned to red.
- **Branding**: “stylo” (lowercase) everywhere; stylo SVG logo in red in header and home hero; Imaginations logo asset added but not currently used in UI.
- **Corpus and article enhancements**: Sectioned article lists, authors on cards, delete-corpus-with-articles option, OJS metadata forms and conversion.
- **Markdown import**: Drop/paste markdown files with replace/insert in the editor.
- **Config and dev experience**: OJS config via `config/ojs.json`, LOCAL-DEV.md, nodemon for GraphQL.

Main and imaginations now diverge across **config**, **frontend (styles, components, routes, i18n)**, **GraphQL (schema, resolvers, helpers, migrations)**, and **tooling**. Several areas are merge-sensitive and need care.

---

## 2. Changes Implemented (by area)

### 2.1 Configuration & environment

| Change | Purpose |
|--------|---------|
| **`.gitignore`** | Added `/config/ojs.json`, `.DS_Store`, `deployment_plan.md` |
| **`config/ojs.example.json`** | Example OJS config (staging/production `api_endpoint`, `api_token`) |
| **`config/README.md`** | Documents OJS config; notes `ojs.json` is not committed |
| **`infrastructure/templates/.env`** | Template env updates (if any for OJS) |

**Merge note:** Main may add other env or config entries; merge both and keep OJS entries.

---

### 2.2 GraphQL backend

#### New files

- **`graphql/helpers/ojs.js`** — OJS API client: `fetchOjs`, `getOjsIssues`, `getOjsIssueMetadata`, `getOjsPublication`.
- **`graphql/helpers/ojsConfig.js`** — Reads `config/ojs.json`; returns endpoints/tokens per instance (staging/production).
- **`graphql/helpers/ojsMetadataMapper.js`** — Maps OJS submission/publication to Stylo article metadata (OJS shape).
- **`graphql/helpers/ojs.test.js`** — Tests for `ojs.js`.
- **`graphql/helpers/metadata.js`** — Shared metadata helpers (used by OJS mapping and article/corpus).
- **`graphql/resolvers/ojsResolver.js`** — `Query.ojsIssues(instance)`, `Mutation.importCorpusFromOjs(issueId, instance, workspaceId)`.
- **`graphql/resolvers/ojsResolver.test.js`** — Resolver tests (mocked OJS).
- **`graphql/scripts/convert-article-metadata-to-ojs.js`** — One-off script to convert existing article metadata to OJS shape.
- **`graphql/migrations/20250307180000-article-metadata-to-ojs-shape.js`** — Migration to normalize article metadata to OJS shape.

#### Modified files

- **`graphql/schema.js`** — New `OjsInstance` enum; `OjsIssue` type; `Query.ojsIssues(instance: OjsInstance)`; `Mutation.importCorpusFromOjs(...)`.
- **`graphql/resolvers/index.js`** — Registers `OjsQuery` and `OjsMutation`.
- **`graphql/resolvers/corpusResolver.js`** — Corpus queries support `includeArticleMetadata`, article sorting (section, seq); delete corpus optionally deletes articles.
- **`graphql/models/corpus.js`** — Model changes if any for article ordering/sections.
- **`graphql/resolvers/articleResolver.js`** — Minor hook for metadata (e.g. OJS).
- **`graphql/migrations/`** — Existing migrations touched (e.g. 20230504080000, 20251127213000, 20260206090000) for compatibility or indexes.

**Merge note:** Schema and resolver changes are additive (new types and fields). If main adds different Query/Mutation or changes Corpus/Article, merge conflicts are likely in `schema.js` and `resolvers/index.js`. Resolve by merging both feature sets.

---

### 2.3 Frontend — styling and theme

| File | Change |
|------|--------|
| **`front/src/styles/variables.scss`** | `$imaginations-red`, header/info-bar variables, `$font-serif` / `$font-sans` (Merriweather/Mulish). |
| **`front/src/styles/general.scss`** | Body `line-height: 1.6`; headings use `$font-sans`; h1/h2 use `$imaginations-red`; body/controls use `$font-serif` / `$font-sans`. |
| **`front/index.html`** | Title/meta “stylo”; Google Fonts (Merriweather, Mulish). |
| **`front/src/components/organisms/header/header.module.scss`** | Light header (`$header-background`), red accents, logo img height and red filter, sans-serif nav. |
| **`front/src/components/organisms/header/Header.jsx`** | Stylo SVG logo (red) in nav; link to home. |
| **`front/src/components/organisms/header/UserMenu.module.scss`** | Light dropdown (was dark). |
| **`front/src/components/molecules/Alert.module.scss`** | `.info` uses info-bar variables and red left accent. |
| **`front/src/components/molecules/Version.module.scss`** | Selected/separator/indicator/automated/workingCopy use info-bar/red. |
| **`front/src/components/organisms/textEditor/CollaborativeEditorWebSocketStatus.module.scss`** | Status bar uses info-bar styling and red. |
| **`front/src/components/atoms/Button.module.scss`** | Disabled text uses `$main-color`. |
| **`front/src/components/molecules/Toggle.module.scss`** | Border uses `$main-color`. |
| **`front/src/components/organisms/corpus/CorpusItem.module.scss`** | `.primaryAction` uses `$imaginations-red`; delete-articles checkbox styling. |
| **`front/src/components/organisms/textEditor/CollaborativeTextEditor.module.scss`** | Footnote target outline uses `$imaginations-red`. |
| **`front/src/layout.module.scss`** | `.heroLogoWrap`, `.heroLogoStylo` (red filter); removed Imaginations hero logo. |

**Merge note:** If main changes the same SCSS files (e.g. header, buttons, alerts), expect conflicts. Prefer keeping Imaginations variables and components, then re-applying any main-only tweaks.

---

### 2.4 Frontend — components and pages

#### New components

- **`front/src/components/corpus/Corpus.jsx`** (page-level) — Corpus list, create corpus, OJS import buttons (staging/production), modals.
- **`front/src/components/organisms/corpus/OjsImportModal.jsx`** — Issue picker and import from OJS.
- **`front/src/components/organisms/corpus/ojsImportModal.module.scss`**
- **`front/src/components/organisms/MarkdownImportModal.jsx`** — Replace/insert markdown in editor.
- **`front/src/components/organisms/markdownImportModal.module.scss`**
- **`front/src/components/pages/Corpus.jsx`** — Route page that renders the corpus section (with workspace).
- **`front/src/components/pages/Corpus.module.scss`**

#### Modified components

- **`front/src/components/pages/Home.jsx`** — Hero: single stylo SVG logo (red); removed Imaginations logo; aria-labels use “stylo”.
- **`front/src/components/organisms/corpus/CorpusItem.jsx`** — Delete corpus with optional “delete articles”; metadata form uses `normalizeCorpusMetadataForForm`.
- **`front/src/components/organisms/corpus/CorpusItem.module.scss`** — Delete-articles option, primary action red.
- **`front/src/components/organisms/corpus/CorpusArticleCard.jsx`** — Authors on card; `firstLocaleValue` / `formatAuthors` for OJS and legacy metadata.
- **`front/src/components/organisms/corpus/corpusArticleCard.module.scss`** — Article info and authors styling.
- **`front/src/components/organisms/corpus/CorpusArticleItems.jsx`** — Section headers, ordered by section then seq; uses `CorpusArticleItems.module.scss`.
- **`front/src/components/organisms/corpus/CorpusArticleItems.module.scss`** (new) — Section list layout.
- **`front/src/components/organisms/corpus/CorpusArticles.jsx`** — Fetches with `includeArticleMetadata`; sorts by section and seq.
- **`front/src/components/organisms/metadata/ArticleEditorMetadataForm.jsx`** — OJS metadata support; schema/ui-schema for OJS; `normalizeMetadataToOjsShape`, `mapOjsToOjsMetadata`, `hasOjsData`.
- **`front/src/components/organisms/metadata/ArticleEditorMetadataForm.module.scss`** — Extra styles for OJS form.
- **`front/src/components/organisms/textEditor/CollaborativeTextEditor.jsx`** — Markdown drop opens MarkdownImportModal; `onDropIntoEditor(editor, { onMarkdownFile })`; preview class `stylo-preview-imaginations`.
- **`front/src/components/organisms/bibliography/support.js`** — `onDropIntoEditor(editor, options)`; markdown vs image handling; `importMarkdownContent`, `readFileAsText`, `isMarkdownFile`, `isImageFile`.
- **`front/src/components/organisms/footer/Footer.jsx`** — “stylo” (lowercase) + version.

**Merge note:** Routing and new pages (Corpus) may conflict if main adds or moves routes. Article metadata and editor changes are dense; merge with tests and manual checks.

---

### 2.5 Frontend — data, hooks, helpers

#### New

- **`front/src/helpers/ojsMapper.js`** — OJS metadata shape: `normalizeCorpusMetadataForForm`, `normalizeMetadataToOjsShape`, `mapOjsToOjsMetadata`, `hasOjsData`, locale/author helpers.
- **`front/src/helpers/previewMetadata.js`** — Preview metadata handling (e.g. for OJS/Imaginations).
- **`front/src/hooks/ojs.js`** — `useOjsInstances()`, `useOjsIssues(instance)`, `useOjsImport()` (calls `importCorpusFromOjs`).
- **`front/src/hooks/Ojs.graphql`** — `ojsIssues`, `importCorpusFromOjs` GraphQL ops.

#### Modified

- **`front/src/hooks/corpus.js`** — Uses updated corpus API (e.g. workspace-scoped).
- **`front/src/hooks/Article.graphql`**** / **`front/src/hooks/Corpus.graphql`** — New variables or fragments for metadata and ordering.
- **`front/src/hooks/Version.graphql`** / **`front/src/hooks/Versions.graphql`** — Align with backend version schema if changed.
- **`front/src/schemas/schemas.js`** — OJS article schema registration; **`front/src/schemas/article-ojs-metadata.schema.json`** and **`front/src/schemas/article-ojs-ui-schema.json`** (new).

**Merge note:** If main changes the same hooks or GraphQL operations, merge both and ensure all call sites (corpus page, editor, metadata form) still work.

---

### 2.6 Frontend — i18n and assets

- **`front/src/locales/{en,fr,es}/corpus.json`** — New or updated corpus/OJS strings.
- **`front/src/locales/{en,fr}/translation.json`** — New keys (e.g. OJS import, delete articles, markdown import).
- **`front/src/index.jsx`** — Helmet default title “stylo”, titleTemplate “%s - stylo”.
- **`front/public/images/Imaginations-logo.svg`** — Added; not used in UI currently.

**Merge note:** Translation files often conflict when both branches add keys; merge keys from both and fix duplicates.

---

### 2.7 Preview and editor styling

- **`front/src/styles/preview-imaginations.css`** — Imaginations-specific preview styling (e.g. for PDF/HTML export).
- **`front/vite.config.js`** — Any alias or config for preview/static assets.

**Merge note:** If main has its own preview or build config, merge both and keep Imaginations preview class and CSS.

---

### 2.8 Tooling and docs

- **`package.json`** / **`package-lock.json`** — Root scripts (e.g. dev with nodemon); front deps (e.g. `@vscode/l10n`).
- **`nodemon.json`** — GraphQL watch config.
- **`LOCAL-DEV.md`** — Local setup, ports, env, troubleshooting.
- **`implementation_plan.md`** — OJS implementation plan.
- **`walkthrough.md`** — OJS integration walkthrough.
- **`schema.graphql`** — Generated or updated GraphQL schema (if present).

**Merge note:** Keep both main’s and imaginations’ script and doc changes; merge `package.json` dependency blocks carefully.

---

## 3. Where the Two Branches Diverge

### 3.1 High-divergence areas (same file, different logic)

- **`graphql/schema.js`** — New OJS types and operations on imaginations; main may add other types.
- **`graphql/resolvers/index.js`** — OjsQuery/OjsMutation added; main may add other resolvers.
- **`graphql/resolvers/corpusResolver.js`** — Delete-with-articles, article metadata and ordering; main may change corpus API.
- **`front/src/components/organisms/header/header.module.scss`** — Full redesign (light + red); main may have other header changes.
- **`front/src/components/organisms/metadata/ArticleEditorMetadataForm.jsx`** — OJS metadata and schemas; main may change metadata form.
- **`front/src/components/organisms/textEditor/CollaborativeTextEditor.jsx`** — Markdown import and preview class; main may change editor behavior.
- **`front/src/components/organisms/bibliography/support.js`** — Extended drop handler; main may change drop behavior.
- **`front/src/styles/variables.scss`** — New theme variables; main may change palette.
- **`front/src/styles/general.scss`** — Typography and line-height; main may change global styles.
- **`front/src/schemas/schemas.js`** — OJS schema registration; main may add other schemas.

### 3.2 New code only on imaginations (low conflict risk if merged carefully)

- All new GraphQL helpers, resolvers, migrations, and scripts under `graphql/`.
- New frontend components: OjsImportModal, MarkdownImportModal, Corpus page, new SCSS modules.
- New helpers: `ojsMapper.js`, `previewMetadata.js`.
- New hooks: `ojs.js`, Ojs.graphql.
- New locales and schema JSONs.
- Config: `config/ojs.example.json`, `config/README.md`.
- Docs: LOCAL-DEV.md, implementation_plan.md, walkthrough.md.

### 3.3 Shared infrastructure

- **`package.json`** / **`package-lock.json`** (root and front) — Both branches may add deps; merge and re-run install.
- **`front/package.json`** — `@vscode/l10n` and script order changes; main may add other deps.
- **`.gitignore`** — Both may add entries; merge both.

---

## 4. Merge Risks and How to Handle Them

### 4.1 GraphQL schema and resolvers

- **Risk:** Main adds new Query/Mutation or types; imaginations adds OJS. Same names or overlapping types can conflict.
- **Mitigation:** Prefer a merge that keeps both feature sets. In `schema.js`, add main’s types and operations alongside OJS. In `resolvers/index.js`, spread both main’s and OjsQuery/OjsMutation.

### 4.2 Corpus and article API

- **Risk:** Main changes corpus resolver (e.g. filter, pagination) or article metadata shape; imaginations adds `includeArticleMetadata`, ordering, delete-articles.
- **Mitigation:** Merge resolver logic so that: (1) main’s API evolution is preserved, (2) imaginations’ options (includeArticleMetadata, delete articles) remain and are backward-compatible where possible.

### 4.3 Theming and global CSS

- **Risk:** Main updates header, buttons, or variables; imaginations replaces header and introduces red theme.
- **Mitigation:** Keep imaginations’ variables and header/component styles as the “theme” and re-apply any main-only fixes (e.g. accessibility or bug fixes) on top.

### 4.4 Article metadata form and schemas

- **Risk:** Main changes metadata form or schema list; imaginations adds OJS schema and normalization.
- **Mitigation:** Merge so both main’s and OJS metadata paths remain; ensure `schemas.js` and schema JSONs include both. Test form with legacy and OJS articles.

### 4.5 Editor and drop behavior

- **Risk:** Main changes editor or drop handling; imaginations adds markdown drop and MarkdownImportModal.
- **Mitigation:** Keep markdown-first handling in `support.js` and modal integration in CollaborativeTextEditor; merge any main changes to other editor behavior (e.g. image upload).

### 4.6 Locales

- **Risk:** Same keys added or changed in both branches.
- **Mitigation:** Merge translation files key-by-key; prefer imaginations’ “stylo” and OJS/markdown strings; keep main’s other new keys.

### 4.7 Migrations and DB shape

- **Risk:** Main adds migrations that touch the same collections or fields (e.g. articles, corpus).
- **Mitigation:** Run both branches’ migrations in order; ensure OJS metadata migration is compatible with main’s article/corpus shape. Test on a copy of production-like data.

---

## 5. Pitfalls to Avoid on the Imaginations Branch

1. **Don’t assume main is frozen.** Periodically merge or rebase main into imaginations to avoid a single huge merge. Resolve conflicts in small chunks (e.g. schema, then resolvers, then frontend).
2. **Don’t remove main-only features.** When resolving conflicts, keep main’s new features and add imaginations’ OJS/theme on top unless you explicitly decide to drop something.
3. **Don’t hardcode OJS config in code.** Keep using `config/ojs.json` (and optional env fallback) so production can point to the right OJS without code changes.
4. **Don’t skip tests after merge.** Run GraphQL tests (`graphql/helpers/ojs.test.js`, `graphql/resolvers/ojsResolver.test.js`) and any frontend tests; run the app and test OJS import, corpus delete-with-articles, and markdown import.
5. **Don’t forget env and config.** After merge, document that OJS needs `config/ojs.json` (or env) and that LOCAL-DEV.md reflects the current setup.
6. **Don’t commit secrets.** `config/ojs.json` is gitignored; keep it that way and use `ojs.example.json` as the template.
7. **Watch for duplicate dependencies.** When merging package.json, deduplicate and run `npm install`; check for version clashes (e.g. React, GraphQL client).
8. **Preview and export.** If main changes HTML/PDF export or preview pipeline, re-apply Imaginations preview styling (`stylo-preview-imaginations`, `preview-imaginations.css`) in the merged pipeline.

---

## 6. Suggested Merge Strategy

1. **Merge main into imaginations** (or rebase imaginations onto main) in a dedicated branch.
2. Resolve in this order: **config/docs → GraphQL (schema, resolvers, helpers, migrations) → frontend styles → frontend components/hooks → i18n → package.json and tooling**.
3. After each conflict block: run GraphQL tests, then start app and smoke-test login, corpus list, OJS import, article edit, metadata form, markdown import, and export/preview.
4. Update LOCAL-DEV.md and implementation_plan.md/walkthrough.md if behavior or config changed.
5. Do a final pass for “stylo” branding, red theme, and logo on header and home.

This report should be treated as a living document: update it when major new features land on either branch or after a successful merge.
