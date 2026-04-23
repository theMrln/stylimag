---
name: Asset Export Persistence
overview: Design and phase in durable storage for article images and generated exports using object storage, while keeping Mongo as source of truth for article content and metadata.
todos:
  - id: storage-abstraction
    content: Add backend storage adapter/config for S3-compatible image and export persistence
    status: completed
  - id: asset-flow
    content: Implement asset upload + retrieval APIs and switch frontend drop handler to use them
    status: completed
  - id: export-artifacts
    content: Persist generated HTML/PDF outputs and track metadata in Mongo
    status: in_progress
  - id: docker-dev-storage
    content: Add MinIO local service and environment wiring for development
    status: completed
  - id: docs-and-migration
    content: Document persistence and rollout strategy, including compatibility with existing external image links
    status: completed
isProject: false
---

# Image and Export Persistence Plan

## Goal

Persist source assets (images referenced in markdown) and generated artifacts (HTML/PDF exports) in a way that is reliable across containers, branch workflows, and future scaling.

## Current State (codebase)

- Article markdown is stored in Mongo (`workingVersion.md`) in [`/Users/mrln/github/stylimag/graphql/models/article.js`](/Users/mrln/github/stylimag/graphql/models/article.js).
- Image drop in editor uploads directly to Imgur from the browser and inserts external links in markdown in [`/Users/mrln/github/stylimag/front/src/components/organisms/bibliography/support.js`](/Users/mrln/github/stylimag/front/src/components/organisms/bibliography/support.js).
- Export UI calls an external pandoc-export service in [`/Users/mrln/github/stylimag/front/src/hooks/stylo-export.js`](/Users/mrln/github/stylimag/front/src/hooks/stylo-export.js) and [`/Users/mrln/github/stylimag/front/src/components/organisms/export/Export.jsx`](/Users/mrln/github/stylimag/front/src/components/organisms/export/Export.jsx).
- Docker persistence currently covers Mongo volume + host config mounts (already documented).

## Target Persistence Model

- **Canonical content**
  - Mongo: article text/metadata/version graph (unchanged source of truth).
  - Object storage bucket (S3-compatible): image binaries uploaded for articles.
- **Derived content**
  - Object storage bucket/prefix: generated HTML/PDF artifacts.
  - Mongo: export job metadata and pointers to stored artifacts.

## Storage Layout (proposed)

- Bucket: `stylimag-assets`
  - `images/{workspaceId}/{articleId}/{sha256}.{ext}`
  - `exports/{workspaceId}/{articleId}/{versionId}/{jobId}/article.html`
  - `exports/{workspaceId}/{articleId}/{versionId}/{jobId}/article.pdf`
- Optional second bucket for exports if lifecycle/permissions differ.

## URL Strategy

- Persist markdown references as platform URLs, not raw object URLs:
  - `![caption](/assets/images/{assetId})`
- Backend resolves `assetId` to object storage key and serves/proxies (or redirects with signed URL).
- Export pipeline resolves these asset URLs to local files/authorized URLs before pandoc generation.

## Data Model Additions (Mongo)

- `Asset` collection:
  - `articleId`, `workspaceId`, `ownerId`
  - `storageKey`, `mimeType`, `size`, `sha256`, `originalFilename`
  - `createdAt`, optional `deletedAt`
- `ExportArtifact` collection:
  - `articleId`, `versionId`, `workspaceId`, `requestedBy`
  - `format` (`html`/`pdf`), `storageKey`, `status`, `createdAt`, `expiresAt?`
  - optional `optionsHash` (style/template/export parameters)

## API/Flow Changes

1. **Image upload flow (replace direct Imgur dependency)**
   - Add backend mutation for upload intent + finalize (or direct multipart upload endpoint).
   - Frontend drop handler uploads to backend/object storage and inserts stable `/assets/images/{assetId}` markdown link.
2. **Asset retrieval flow**
   - Add authenticated query/route to fetch asset by id with access checks.
3. **Export flow**
   - Keep current export service integration, but persist generated files in object storage.
   - Return both generated download URL and persisted artifact id.
4. **Garbage collection**
   - Background cleanup policy for orphaned/expired artifacts.

## Docker and Ops Changes

- **Dev/local**: add MinIO service + named volume (`minio_data`) in compose.
- **Env config** for GraphQL/export:
  - endpoint, bucket, region, access key/secret (prefer secrets in deployment).
- Keep containers stateless; object store + Mongo are persistence layers.

## Rollout Phases

1. Add storage abstraction in GraphQL backend (S3-compatible client + config validation).
2. Implement image upload/read endpoints and frontend editor integration.
3. Introduce `Asset` model and markdown link strategy.
4. Persist export outputs and add `ExportArtifact` model.
5. Add migration/compat layer for existing external image links (no forced rewrite initially).
6. Add lifecycle/retention jobs and documentation updates.

## Acceptance Criteria

- New dropped images are stored in object storage and referenced via stable platform URLs.
- Exported HTML/PDF are retrievable after container restarts.
- Rebuilding/redeploying containers does not lose images/exports.
- Access controls prevent cross-workspace unauthorized asset reads.
- Existing markdown with external image URLs continues to render.
