# Stylimag Docker Architecture Notes

## Purpose

This document turns the architecture comparison work into a durable reference for Stylimag. It explains how Stylimag currently differs from Stylo in Docker terms, why those differences likely emerged, what those differences imply in practice, and what should happen next if Stylimag is to become easier to develop, deploy, and maintain.

This document is based on the current repository state in Stylimag and Stylo, especially the active and legacy compose files, service Dockerfiles, nginx configuration, and the supporting project notes already present in the repository.

## Related Diagrams

- [docker-architectures-publication.md](./docker-architectures-publication.md)
- [stylimag-stylo-comparison.md](./stylimag-stylo-comparison.md)
- [stylimag-legacy-full-stack.md](./stylimag-legacy-full-stack.md)

## Executive Summary

Stylimag is currently in a transitional Docker state.

Stylo still presents a canonical full-stack Docker architecture with:

- frontend
- GraphQL API
- MongoDB
- export service
- pandoc conversion service
- host reverse proxy assumptions

Stylimag's active compose file now presents a smaller application-focused architecture with:

- frontend
- GraphQL API
- MongoDB
- same-origin proxying from frontend nginx to GraphQL
- image self-build for the frontend inside Docker
- no export or pandoc containers in the active stack

At the same time, Stylimag still contains:

- a legacy full-stack compose file that is very close to Stylo
- CI workflow references that still assume the old compose naming and old service targets
- README instructions that still describe the old stack
- a local compose override that references an old Mongo service name and no longer matches the active compose file

The practical conclusion is that Stylimag currently has two competing Docker stories:

- an active, simplified runtime architecture for the branch's current application needs
- an older, canonical deployment architecture inherited from Stylo and still reflected in some docs and workflow files

That is workable in the short term, but it creates ambiguity for developers, deployers, and maintainers.

## The Three Relevant Architectures

There are really three architectures to keep in mind.

### 1. Stylo canonical architecture

This is the full production-oriented model still represented in Stylo.

Characteristics:

- frontend container serves the UI
- GraphQL container provides API and collaboration services
- MongoDB container is healthchecked before GraphQL starts
- export service handles document export orchestration
- pandoc-api handles document conversion
- services bind to loopback on the host
- deployment assumes a host-level reverse proxy for public access

This architecture is broader and more deployment-oriented.

### 2. Stylimag active architecture

This is the currently active Docker path in Stylimag.

Characteristics:

- only frontend, GraphQL, and Mongo are present in the active compose file
- frontend image builds its static assets inside Docker using a multi-stage Dockerfile
- nginx in the frontend container proxies GraphQL and auth-related routes to the API container
- Mongo uses a named Docker volume rather than a repository bind mount
- GraphQL mounts `./config` read-only for instance-specific configuration such as OJS
- services are published directly rather than loopback-bound only

This architecture is narrower and more application-focused.

### 3. Stylimag legacy architecture

Stylimag also keeps a legacy compose file that is almost the same as Stylo's canonical full stack.

Characteristics:

- service names match the Stylo naming convention
- export and pandoc remain included
- Mongo uses a bind mount
- host loopback binding is used
- image references and CI assumptions align more closely with Stylo

This architecture seems to be retained as a compatibility snapshot or fallback reference.

## Why Stylimag Likely Diverged

The divergence is technically coherent.

### Same-origin and cookie simplicity

Stylimag's frontend nginx explicitly proxies GraphQL and auth-related routes to the backend. That reduces the need to manage browser CORS and cookie edge cases between separate frontend and backend origins.

That change is not arbitrary. It matches the project's own notes about learning around cookies, CORS, and proxying. The simplified active architecture appears to prefer one browser-facing origin and internal container-to-container routing.

### Branch-specific focus

The Imaginations work added OJS integration, additional metadata handling, and frontend/application changes. The active Stylimag stack looks optimized for that application work rather than for maintaining the entire Stylo editorial deployment chain.

In other words, the active compose looks like a branch-oriented runtime environment, not a final platform statement.

### Better container self-sufficiency for the frontend

Stylimag's frontend Dockerfile now builds the application inside the image. That makes the frontend image more self-contained and less dependent on host-side build output. Stylo still expects host-built frontend artifacts to be mounted into nginx.

This is generally a sound modernization move.

### Separation from export concerns

The absence of `export-stylo` and `pandoc-api` in Stylimag's active compose suggests one of three intentions:

- export is temporarily out of scope for current branch work
- export is expected to be externalized or run separately
- export support is unfinished in the new active stack

At the moment, the repository state does not make that decision explicit.

## Detailed Differences

### Service inventory

Stylo canonical stack includes five services.

- frontend
- GraphQL
- MongoDB
- export
- pandoc-api

Stylimag active stack includes three services.

- frontend
- GraphQL
- MongoDB

Impact:

- the active Stylimag stack is not a full replacement for the Stylo deployment model
- any export-dependent workflow either does not exist in the active stack or depends on separate infrastructure

### Frontend image strategy

Stylo frontend container is a runtime nginx image that expects build output to be mounted from the host.

Stylimag frontend container performs a multi-stage build and ships the built frontend inside the image.

Impact:

- Stylimag's frontend container is easier to reproduce in isolation
- CI and deployment become simpler if Docker is the source of truth
- host-side artifact management becomes less important

### Proxy and browser-facing behavior

Stylo's frontend nginx config is minimal and mainly serves static files.

Stylimag's frontend nginx config proxies:

- `/graphql`
- login and auth-related routes
- websocket routes
- events routes

Impact:

- Stylimag reduces cross-origin complexity
- frontend and API are presented as one origin to the browser
- cookies and session flows should be more predictable

### Mongo persistence model

Stylo uses a repository bind mount for Mongo data.

Stylimag uses a named Docker volume.

Impact:

- named volumes are cleaner for container lifecycle management
- bind mounts are easier to inspect manually from the repository directory
- the team should choose based on backup, portability, and local debug needs

### Startup coordination

Stylo waits for MongoDB health before GraphQL starts.

Stylimag active compose uses simple dependency ordering only.

Impact:

- Stylimag startup is more fragile if GraphQL initializes before Mongo is ready
- healthchecks and service conditions should probably return unless startup is deliberately tolerant

### Network exposure

Stylo binds service ports to `127.0.0.1`.

Stylimag publishes ports more broadly.

Impact:

- Stylimag is looser by default on host exposure
- that may be convenient for local development
- it is a weaker default for production or shared hosts

### GraphQL runtime command

Stylo's GraphQL container runs the `prod` script.

Stylimag's GraphQL container runs the `start` script.

Impact:

- this may be intentional if the active stack is treated as a simpler runtime
- or it may indicate drift from production expectations
- if Stylimag is to become a real deployment target, this should be resolved deliberately

## Current Inconsistencies in Stylimag

These are the most important improvement points because they create confusion today.

### Documentation drift

Stylimag README Docker instructions still describe the old full-stack service names and startup commands rather than the active compose file.

Result:

- a new contributor may run the wrong services
- the README can no longer be treated as a reliable operational guide

### CI and workflow drift

Stylimag's Docker GitHub workflow still references `docker-compose.yaml` and old build targets aligned with the Stylo naming conventions, while the active compose file is `docker-compose.yml` and no longer describes the same service inventory.

Result:

- CI is not obviously aligned with the active runtime architecture
- image publishing intent is unclear

### Local override drift

Stylimag's `docker-compose.local.yaml` still targets `mongodb-stylo`, which no longer exists in the active compose where the service is now named `mongo`.

Result:

- local overrides are structurally stale
- anyone expecting override-based local behavior may get broken or misleading results

### Active versus legacy ambiguity

Stylimag now has both an active compose file and a legacy compose file, but no single authoritative document explains:

- which one is canonical
- which one is deprecated
- which one should be used for local dev
- which one should be used for deployment
- whether export is intentionally absent or merely deferred

Result:

- maintainers have to infer architectural intent from file contents

## Assessment of the Active Stylimag Direction

The active Stylimag direction is not wrong. In several respects it is stronger than the inherited model.

### What is better

- same-origin proxying is operationally simpler for browser auth and sessions
- frontend image self-build is cleaner and more reproducible
- named volumes reduce repository pollution for database persistence
- config mounting supports instance-specific integration work such as OJS cleanly

### What is weaker or incomplete

- export and pandoc are no longer represented in the active stack
- startup orchestration is less robust without healthchecks
- docs and CI do not match the active architecture
- broader port exposure is not a great default if the stack is reused outside local development

The real issue is not that Stylimag changed architecture. The issue is that the repository has not yet fully committed to the consequences of that change.

## Recommendations for Further Development

The most important recommendation is to choose and document a target operating model.

### Recommendation 1: Declare a target architecture explicitly

Stylimag should define one of the following paths.

Option A: Stylimag becomes a simplified application-focused stack.

- active compose remains front + GraphQL + Mongo
- export is external or out of scope
- same-origin frontend proxy remains central
- deployment docs are rewritten around that model

Option B: Stylimag remains a full Stylo-derived platform.

- export and pandoc return to the active compose
- legacy and active paths are merged
- the stack remains deployment-complete

Option C: Stylimag supports both modes intentionally.

- app-only mode for local dev and feature work
- full-stack mode for deployment and export workflows
- compose profiles or multiple explicitly documented compose entrypoints are used

If no explicit choice is made, architectural drift will continue.

### Recommendation 2: Replace ambiguity with compose profiles or named entrypoints

If Stylimag needs both a lightweight and a full-stack mode, do not rely on `docker-compose.old.yaml` as an implicit historical fallback.

Better options:

- one compose file with profiles such as `app`, `export`, and `full`
- or two clearly named files such as `compose.app.yml` and `compose.full.yml`

That would make the intent obvious and remove the awkward status of the current `docker-compose.old.yaml` file.

### Recommendation 3: Align docs with reality

At minimum, update:

- README Docker instructions
- LOCAL-DEV guide
- deployment notes
- diagram index page if one is added later

The repository should answer, without ambiguity:

- how to run Stylimag locally with Docker
- whether export is supported in Docker right now
- whether the active stack is intended for deployment or only for development

### Recommendation 4: Align CI with the chosen path

If Stylimag is going to publish images or validate Docker builds, the workflow must point at the actual compose files and service targets in use.

Actions:

- update compose filename references
- update service names and targets
- remove obsolete assumptions if export is no longer built here
- or reintroduce missing services intentionally if they remain part of the product

### Recommendation 5: Restore startup robustness

If the active stack remains in use, add back:

- Mongo healthcheck
- health-based GraphQL startup dependency

This is a low-cost improvement with a clear reliability payoff.

### Recommendation 6: Decide on a port exposure policy

For local developer convenience, broad port publication may be acceptable.

For anything deployment-like, prefer:

- loopback binding
- or no direct publication for internal services behind a reverse proxy

Stylimag should make that distinction explicit rather than accidental.

### Recommendation 7: Decide whether GraphQL container should run `start` or `prod`

This should be policy, not drift.

Questions to answer:

- Is the active compose strictly for development-like runtime use?
- Is it a lightweight production path?
- Are production hardening flags in `prod` required for Stylimag deployments?

Once answered, use one script intentionally and document why.

### Recommendation 8: Clarify export strategy

If export is meant to remain part of Stylimag, then the active stack is incomplete and should be expanded.

If export is meant to be externalized, then Stylimag should document:

- what service it expects externally
- what environment variables or endpoints it depends on
- what features degrade when export is absent

This is currently one of the biggest unanswered architecture questions.

### Recommendation 9: Add a small architecture decision record

Stylimag would benefit from one short ADR-style note explaining:

- why same-origin proxying was adopted
- why export is or is not included in the active stack
- why frontend assets are now built inside Docker
- which deployment modes are officially supported

That would prevent future contributors from reverse-engineering intent from compose files.

## Suggested Implementation Roadmap

### Immediate

- update README to match the active compose file
- mark `docker-compose.old.yaml` as legacy or replace it with a clearer name
- fix `docker-compose.local.yaml` so it matches the active service names
- add one paragraph explaining whether export is intentionally excluded

### Near-term

- choose either one canonical compose path or a profiles-based multi-mode structure
- align GitHub workflow Docker references with the chosen compose path
- restore healthchecks and startup dependency conditions where needed
- review port bindings for least-surprise behavior

### Medium-term

- decide whether Stylimag should own a full deployment story or only an application story
- if full deployment remains a goal, reintroduce export and pandoc coherently
- if not, document external service dependencies and boundaries clearly
- add an ADR or architecture note linked from the README

## Suggested Quality Checks

After the architecture is clarified, validate the resulting model with a small checklist.

- fresh local startup from the README works as written
- compose override files still apply correctly
- frontend login and session flows work through same-origin proxying
- GraphQL starts reliably even on a slow machine
- export behavior is either supported and tested or explicitly unavailable
- CI builds the same services that developers are told to run

## Final Position

Stylimag's active Docker direction is reasonable and in some respects better than the inherited Stylo pattern. The main problem is not the new architecture itself. The main problem is incomplete consolidation.

Stylimag should now do one of two things:

- fully embrace the simplified architecture and update everything around it
- or formalize a dual-mode architecture so that both lightweight and full-stack operation are intentional, documented, and testable

Either choice is defensible. The current ambiguous middle state is not.