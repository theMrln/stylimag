# Architecture Decision Record: Stylimag Docker Architecture Direction

## Status

Proposed

## Date

2026-03-18

## Decision Owners

Stylimag maintainers

## Context

Stylimag currently contains two practical Docker paths:

- an active simplified stack in `docker-compose.yml` with frontend, GraphQL, and Mongo
- a legacy full-stack snapshot in `docker-compose.old.yaml` that remains close to Stylo's canonical deployment stack

The active stack introduces several modernization choices:

- frontend assets are built inside the Docker image (multi-stage build)
- frontend nginx proxies GraphQL and auth-related routes for a same-origin browser model
- Mongo persistence uses a named volume

At the same time, Stylimag still shows operational drift:

- README Docker instructions still describe older full-stack service names and startup paths
- Docker workflow references still reflect old compose assumptions
- local compose override targets an old Mongo service name

This creates ambiguity for developers and maintainers about the intended operating model.

## Decision Drivers

- reduce cross-origin complexity for sessions and auth
- keep local and CI workflows reproducible through Docker
- minimize contributor confusion about which compose model is canonical
- preserve a path for full-stack features (including export) where required
- avoid long-term architecture drift between docs, CI, and runtime files

## Decision

Stylimag will adopt an explicitly dual-mode Docker architecture, documented as first-class and intentional:

- App mode: frontend + GraphQL + Mongo, optimized for application development and branch-focused work
- Full mode: app mode plus export and pandoc services for export-complete validation and deployment-oriented scenarios

The repository will stop using the term "old" for operational compose paths. Instead, compose intent will be made explicit using either:

- profiles in one compose file, or
- clearly named compose entrypoints such as `compose.app.yml` and `compose.full.yml`

Same-origin proxying in frontend nginx remains a core design choice.

## Considered Options

### Option A: Keep only simplified app stack

Pros:

- lower complexity
- faster onboarding
- easier local operation

Cons:

- incomplete for export workflows
- unclear production/deployment story

### Option B: Revert fully to canonical full-stack only

Pros:

- closer to Stylo deployment model
- one operational path

Cons:

- heavier local stack for feature work
- loses benefits of current same-origin and image-build simplifications unless carefully retained

### Option C: Dual-mode architecture (chosen)

Pros:

- explicit support for both lightweight development and full-stack validation
- preserves current app-focused gains
- provides a clear route for export-dependent use cases

Cons:

- requires stronger documentation discipline
- requires CI and compose maintenance across two declared modes

## Consequences

### Positive

- contributors can choose a documented mode that matches their task
- architecture intent becomes explicit and reviewable
- same-origin proxy model stays intact for browser simplicity

### Negative

- extra maintenance overhead in docs and CI
- risk of mode drift if tests and checks are not mode-aware

### Neutral but important

- naming and structure changes are required for compose files
- old references to implicit legacy paths must be removed or redirected

## Implementation Plan

### Phase 1: Clarify structure

- replace implicit legacy naming with explicit mode naming
- ensure local override files match active service names
- choose one of: profiles-based or multi-file mode structure

### Phase 2: Align docs

- update README Docker section with mode selection instructions
- update LOCAL-DEV with mode-specific commands and expected services
- document export availability by mode

### Phase 3: Align CI

- update Docker workflow compose filename and target references
- add explicit CI checks for app mode
- add explicit CI checks for full mode if export remains in-scope

### Phase 4: Reliability hardening

- restore Mongo healthcheck and health-based GraphQL startup dependency
- verify port exposure policy by mode (local convenience versus deployment safety)
- decide and document GraphQL container runtime script policy (`start` versus `prod`) per mode

## Validation Checklist

- app mode starts cleanly from documented commands
- full mode starts cleanly from documented commands
- same-origin login/session flow works in app mode
- export and pandoc integration work in full mode
- CI pipelines test the same mode commands that docs prescribe
- no remaining docs reference undeclared or legacy-only service names without context

## Out of Scope

- non-Docker production infrastructure design beyond declared compose modes
- complete redesign of Stylo canonical deployment architecture
- feature-level product decisions not tied to Docker operation

## Related Documents

- [stylimag-docker-architecture-notes.md](./stylimag-docker-architecture-notes.md)
- [stylimag-docker-architecture-notes.fr.md](./stylimag-docker-architecture-notes.fr.md)
- [docker-architectures-publication.md](./docker-architectures-publication.md)
- [stylimag-stylo-comparison.md](./stylimag-stylo-comparison.md)
- [stylimag-legacy-full-stack.md](./stylimag-legacy-full-stack.md)
