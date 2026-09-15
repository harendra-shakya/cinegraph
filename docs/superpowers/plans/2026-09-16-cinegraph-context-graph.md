# CineGraph Production Context Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-grade CineGraph knowledge core that preserves creative knowledge as immutable, bitemporal, content-addressed events; serves canonical RDF/JSON-LD projections and explainable retrieval; and publishes governed projections through OriginTrail DKG.

**Architecture:** Use PostgreSQL as the transactional materialization of an append-only knowledge event log. Canonical JSON-LD is normalized to deterministic n-quads and content hashes; RDF, lexical/vector retrieval, analytics, and DKG Knowledge Assets are derived projections with checkpoints. Governed object storage holds media/evidence bytes, while a durable outbox handles DKG writes, retries, reconciliation, and explicit public promotion.

**Tech Stack:** Node.js, Express, React, PostgreSQL, `pg`, SQL migrations, JSON-LD, `rdf-canonize`, RDF/SPARQL-compatible projection/query layer, object storage with immutable manifests, durable worker processes, OriginTrail DKG Edge/Core Node adapter, existing Livepeer Agent integration, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-16-cinegraph-context-graph-design.md` and `docs/superpowers/specs/2026-09-16-cinegraph-architecture-selection.md`

## Global Constraints

- The canonical record is an append-only event plus a content-addressed payload; derived indexes and DKG assets are projections.
- PostgreSQL is required for production persistence; JSONL or in-memory stores are fixture-only.
- Facts carry both valid time and transaction time; historical retrieval must be reproducible.
- JSON-LD is expanded and normalized to deterministic n-quads before hashing.
- Raw media bytes, secrets, private paths, and unapproved prompts never enter shared/public assertions.
- Every DKG write is an idempotent durable outbox operation with receipt reconciliation.
- Every retrieval result must resolve to canonical event IDs, evidence manifests, and a projection checkpoint.
- All APIs enforce tenant/project scope before retrieval, ranking, or DKG access.
- Public publication requires explicit approval, policy validation, and a publication receipt.
- Development adapters may be deterministic fixtures but must expose the same contract and be labelled non-production.
- Every projection and migration must be replayable, checkpointed, and drift-detectable.

---

## Task 1: Establish the production CineGraph service boundary

**Files:**
- Modify: `apps/openmanga/package.json`
- Create: `apps/openmanga/server/services/cinegraph/index.js`
- Create: `apps/openmanga/server/services/cinegraph/config.js`
- Modify: `apps/openmanga/server/config.js`
- Test: `apps/openmanga/tests/cinegraph-config.test.js`

**Interfaces:**
- `createCineGraphRuntime({ config, pool, clock, ids })` returns injected `eventStore`, `projectionRunner`, `retrieval`, `outbox`, `policy`, and `dkgAdapter` dependencies.
- Configuration includes `CINEGRAPH_DATABASE_URL`, `CINEGRAPH_OBJECT_STORE_*`, `CINEGRAPH_DKG_ENDPOINT`, `CINEGRAPH_DKG_NETWORK`, and `CINEGRAPH_SCHEMA_VERSION`; secrets are never returned by public settings.

- [ ] Add production dependencies for PostgreSQL access and deterministic JSON-LD canonicalization.
- [ ] Write configuration tests for required production variables, safe development defaults, and secret redaction.
- [ ] Run `npm test -- --test-name-pattern=cinegraph-config` and confirm it fails before implementation.
- [ ] Implement configuration parsing and runtime dependency injection without opening a database connection at module import time.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit with `git add apps/openmanga/package.json apps/openmanga/server/config.js apps/openmanga/server/services/cinegraph apps/openmanga/tests/cinegraph-config.test.js && git commit -m "feat: establish CineGraph production boundary"`.

## Task 2: Create PostgreSQL migrations for the canonical knowledge core

**Files:**
- Create: `apps/openmanga/server/db/migrations/001_cinegraph_core.sql`
- Create: `apps/openmanga/server/db/migrations/002_cinegraph_indexes.sql`
- Create: `apps/openmanga/server/db/migrate.js`
- Test: `apps/openmanga/tests/cinegraph-migrations.test.js`

**Interfaces:**
- Tables: `knowledge_events`, `knowledge_entities`, `knowledge_facts`, `evidence_manifests`, `projection_checkpoints`, `retrieval_receipts`, `outbox_operations`, `publication_receipts`, `consent_and_policy_decisions`, and `audit_log`.
- Every tenant/project-scoped table has tenant and project keys, created/updated transaction timestamps, and appropriate foreign keys.

- [ ] Write migration tests against a disposable PostgreSQL database or a CI service container, including a second migration run for idempotency.
- [ ] Define event uniqueness on `(tenant_id, idempotency_key)`, immutable event payload hashes, bitemporal fact range indexes, outbox leases, and projection checkpoint uniqueness.
- [ ] Define database roles with least privilege for API reads/writes, projection workers, and migration execution.
- [ ] Implement migration execution with an advisory lock and recorded schema version.
- [ ] Run migration tests, including rollback validation for the latest migration in a disposable database.
- [ ] Commit with `git add apps/openmanga/server/db apps/openmanga/tests/cinegraph-migrations.test.js && git commit -m "feat: add CineGraph production schema"`.

## Task 3: Implement canonical JSON-LD, n-quads, and content addressing

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/canonicalize.js`
- Create: `apps/openmanga/server/services/cinegraph/content-address.js`
- Create: `apps/openmanga/server/services/cinegraph/ontology.js`
- Test: `apps/openmanga/tests/cinegraph-canonicalization.test.js`

**Interfaces:**
- `canonicalizeJsonLd(document)` returns `{ expanded, normalizedNQuads, canonicalizationAlgorithm, hashAlgorithm, contentHash }`.
- `hashPayload({ normalizedNQuads, metadata })` returns a stable `sha256` digest that excludes volatile transport fields.
- `createSemanticId({ tenantId, type, stableKey })` returns an opaque, deterministic ID that contains no prompt, path, or personal data.

- [ ] Write tests proving property order, whitespace, and JSON-LD input ordering do not change the normalized hash.
- [ ] Write tests proving timestamps/request IDs are excluded from semantic hashes and changing a semantic value changes the hash.
- [ ] Write tests for malformed JSON-LD, unsupported context, hash algorithm metadata, and stable ID privacy rules.
- [ ] Run focused canonicalization tests and confirm they fail before implementation.
- [ ] Implement normalization using a standards-compliant JSON-LD/RDF canonicalization library and record algorithm versions.
- [ ] Run focused tests and a fixture round trip from JSON-LD to n-quads to JSON-LD.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/canonicalize.js apps/openmanga/server/services/cinegraph/content-address.js apps/openmanga/server/services/cinegraph/ontology.js apps/openmanga/tests/cinegraph-canonicalization.test.js && git commit -m "feat: canonicalize CineGraph assertions"`.

## Task 4: Implement append-only event commands and idempotency

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/event-store.js`
- Create: `apps/openmanga/server/services/cinegraph/commands.js`
- Test: `apps/openmanga/tests/cinegraph-event-store.test.js`

**Interfaces:**
- `createEventStore({ pool, canonicalizer, clock })` exposes `appendEvent({ tenantId, projectId, aggregateId, type, payload, actor, idempotencyKey })`, `readEvents({ aggregateId, fromSequence, toSequence })`, and `readStream({ projectId, afterSequence })`.
- `appendEvent` returns `{ eventId, sequence, payloadHash, transactionTime, duplicate }` and never mutates a prior event.

- [ ] Write tests for transaction commit, duplicate idempotency, conflicting duplicate payloads, optimistic aggregate revision, tenant isolation, and rollback on failed projection enqueue.
- [ ] Run event-store tests and confirm they fail before implementation.
- [ ] Implement append-only transactions that canonicalize payloads before insert and persist the event hash and sequence.
- [ ] Implement aggregate revision checks so concurrent commands fail with a typed conflict rather than overwrite state.
- [ ] Run the focused database tests and verify duplicate requests return the original event receipt.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/event-store.js apps/openmanga/server/services/cinegraph/commands.js apps/openmanga/tests/cinegraph-event-store.test.js && git commit -m "feat: add CineGraph event store"`.

## Task 5: Add bitemporal fact materialization and replay

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/fact-projector.js`
- Create: `apps/openmanga/server/services/cinegraph/replay.js`
- Test: `apps/openmanga/tests/cinegraph-temporal.test.js`

**Interfaces:**
- `applyFactEvent({ event, transaction })` materializes `knowledge_facts` with `validFrom`, `validTo`, `recordedAt`, `supersededBy`, and source event ID.
- `replayProjection({ projectId, fromSequence, toSequence, projectionVersion })` rebuilds a projection into an isolated checkpoint and returns its materialization hash.
- `readAsOf({ projectId, validAt, recordedAt })` returns the historical fact view eligible at both times.

- [ ] Write tests for correction/supersession, valid-time queries, transaction-time queries, out-of-order valid times, and historical retrieval of a prior attempt.
- [ ] Write a replay determinism test asserting identical event ranges produce identical fact hashes.
- [ ] Run focused temporal tests and confirm they fail before implementation.
- [ ] Implement range-safe fact updates inside the same transaction as event append or projection processing.
- [ ] Implement isolated replay with checkpoint commit only after hash verification.
- [ ] Run temporal and replay tests against PostgreSQL.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/fact-projector.js apps/openmanga/server/services/cinegraph/replay.js apps/openmanga/tests/cinegraph-temporal.test.js && git commit -m "feat: add bitemporal CineGraph projections"`.

## Task 6: Add governed evidence manifests and object-storage integration

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/evidence-store.js`
- Create: `apps/openmanga/server/services/cinegraph/evidence-policy.js`
- Modify: `apps/openmanga/server/services/asset-store.js`
- Test: `apps/openmanga/tests/cinegraph-evidence.test.js`

**Interfaces:**
- `createEvidenceManifest({ tenantId, projectId, objectKey, contentHash, mediaType, byteSize, retentionClass, encryptionKeyRef, sourceEventId })` returns an immutable manifest record.
- `readEvidence({ manifestId, actor })` enforces tenant/project policy before issuing a signed object reference.
- `checkEvidencePolicy({ manifest, targetScope })` returns `{ allowed, reasons }`.

- [ ] Write tests for content-hash verification, immutable manifest fields, tenant isolation, signed-reference expiry, prohibited public media, legal holds, and secret/path redaction.
- [ ] Run focused evidence tests and confirm they fail before implementation.
- [ ] Implement object-storage upload/read adapters with injected clients and transactional manifest creation.
- [ ] Connect generated artifact persistence to evidence manifests without moving bulk bytes into RDF or DKG.
- [ ] Run focused tests and a local object-storage integration test.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/evidence-store.js apps/openmanga/server/services/cinegraph/evidence-policy.js apps/openmanga/server/services/asset-store.js apps/openmanga/tests/cinegraph-evidence.test.js && git commit -m "feat: govern CineGraph evidence storage"`.

## Task 7: Define and validate the creative ontology

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/ontology-v1.jsonld`
- Create: `apps/openmanga/server/services/cinegraph/validation.js`
- Create: `apps/openmanga/server/services/cinegraph/assertions.js`
- Test: `apps/openmanga/tests/cinegraph-ontology.test.js`

**Interfaces:**
- `buildLessonAssertion`, `buildAttemptAssertion`, `buildEvaluationAssertion`, `buildRetrievalReceiptAssertion`, and `buildProvenanceAssertion` return versioned JSON-LD documents.
- `validateAssertion({ document, type, scope })` returns `{ valid, errors, normalized }` and rejects incomplete provenance or invalid scope transitions.

- [ ] Write fixtures for CreativeProject, ScenePlan, PanelPlan, CharacterIdentity, StyleIdentity, GenerationAttempt, Artifact, Evaluation, ImprovementLesson, ModelObservation, RetrievalReceipt, and Remix.
- [ ] Write tests for required relationships, provenance minimums, evidence references, confidence, applicability constraints, valid-time fields, and supersession.
- [ ] Run ontology tests and confirm they fail before implementation.
- [ ] Implement the versioned context, JSON-LD builders, validation rules, and additive-extension checks.
- [ ] Run ontology tests plus canonicalization tests to verify each assertion has a stable hash.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/ontology-v1.jsonld apps/openmanga/server/services/cinegraph/validation.js apps/openmanga/server/services/cinegraph/assertions.js apps/openmanga/tests/cinegraph-ontology.test.js && git commit -m "feat: define CineGraph ontology v1"`.

## Task 8: Build semantic, lexical, and vector projection workers

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/rdf-projector.js`
- Create: `apps/openmanga/server/services/cinegraph/search-projector.js`
- Create: `apps/openmanga/server/services/cinegraph/projection-worker.js`
- Create: `apps/openmanga/server/db/migrations/003_cinegraph_projection_indexes.sql`
- Test: `apps/openmanga/tests/cinegraph-projections.test.js`

**Interfaces:**
- `projectEvent({ event, projectionVersion })` updates RDF facts and search/vector records and returns `{ checkpointSequence, projectionHash }`.
- `rebuildProjection({ projectId, projectionVersion })` replays canonical events into isolated projection tables before activation.
- Search records include source event IDs, assertion hash, projection version, tenant/project, and eligibility status.

- [ ] Write tests for RDF projection determinism, checkpoint advancement, replay isolation, projection lag, drift detection, and removal of superseded facts from eligible search results.
- [ ] Write retrieval-index tests for exact filters, lexical matching, embedding version, and source-event resolution.
- [ ] Run focused projection tests and confirm they fail before implementation.
- [ ] Implement leased worker processing with checkpoint transactions and a dead-letter path.
- [ ] Implement vector embeddings as a derived index with recorded embedding model/version and a re-embedding path.
- [ ] Run projection tests and a replay/rebuild test from a known event fixture.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/rdf-projector.js apps/openmanga/server/services/cinegraph/search-projector.js apps/openmanga/server/services/cinegraph/projection-worker.js apps/openmanga/server/db/migrations/003_cinegraph_projection_indexes.sql apps/openmanga/tests/cinegraph-projections.test.js && git commit -m "feat: build CineGraph semantic projections"`.

## Task 9: Implement scope policy, consent, and tenant authorization

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/access-policy.js`
- Create: `apps/openmanga/server/services/cinegraph/redaction.js`
- Test: `apps/openmanga/tests/cinegraph-access-policy.test.js`

**Interfaces:**
- `authorize({ actor, tenantId, projectId, action, knowledgeId })` returns a typed decision and audit metadata.
- `redactForScope({ assertion, targetScope, policy })` returns a minimized assertion or a rejection with field-level reasons.
- Scope transitions are `private -> shared -> public_pending -> verified`; rejection returns to the prior approved scope.

- [ ] Write tests for tenant isolation, project membership, actor roles, consent expiry, private/shared/public transitions, field redaction, and audit records.
- [ ] Write tests proving secrets, raw prompts, absolute paths, personal data, and media bytes cannot cross the public boundary.
- [ ] Run focused access-policy tests and confirm they fail before implementation.
- [ ] Implement policy evaluation before projection or DKG enqueue and persist every decision in `consent_and_policy_decisions` and `audit_log`.
- [ ] Run security-focused tests and inspect serialized assertions for prohibited data.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/access-policy.js apps/openmanga/server/services/cinegraph/redaction.js apps/openmanga/tests/cinegraph-access-policy.test.js && git commit -m "feat: enforce CineGraph scope policy"`.

## Task 10: Implement durable DKG outbox and adapter conformance

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/dkg-adapter.js`
- Create: `apps/openmanga/server/services/cinegraph/dkg-outbox.js`
- Create: `apps/openmanga/server/services/cinegraph/local-dkg-fixture.js`
- Test: `apps/openmanga/tests/cinegraph-dkg-adapter.test.js`

**Interfaces:**
- `createDkgAdapter({ fetch, endpoint, credentials, graphResolver })` exposes `ensureContextGraph`, `createAssertion`, `readAssertion`, `queryAssertions`, `updateAssertion`, and `verifyReceipt`.
- `createDkgOutbox({ pool, adapter, policy, clock })` exposes `enqueue`, `claim`, `process`, `reconcile`, `deadLetter`, and `status`.
- Normalized receipts include `operationId`, `knowledgeId`, `ual`, `network`, `assertionHash`, `status`, `attemptCount`, `adapterVersion`, and `sourceEventRange`.

- [ ] Write adapter contract tests against the deterministic fixture for create, read, query, supersede/update, duplicate idempotency, and verification.
- [ ] Write outbox tests for lease expiry, worker crash, timeout reconciliation, duplicate remote operation, retryable failure, permanent failure, and dead-letter recovery.
- [ ] Run focused tests and confirm they fail before implementation.
- [ ] Implement the fixture and real adapter behind the same port; keep credentials server-side and never put them in assertions.
- [ ] Implement transactional enqueue from projection output, remote reconciliation before retry, and receipt checkpointing.
- [ ] Run contract and outbox tests.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/dkg-adapter.js apps/openmanga/server/services/cinegraph/dkg-outbox.js apps/openmanga/server/services/cinegraph/local-dkg-fixture.js apps/openmanga/tests/cinegraph-dkg-adapter.test.js && git commit -m "feat: add durable OriginTrail projection"`.

## Task 11: Implement explainable hybrid retrieval

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/query-builder.js`
- Create: `apps/openmanga/server/services/cinegraph/retrieval.js`
- Test: `apps/openmanga/tests/cinegraph-retrieval.test.js`

**Interfaces:**
- `retrieve({ actor, tenantId, projectId, query, filters, validAt, recordedAt, limit, purpose })` returns `{ results, receipt }`.
- Each result contains `knowledgeId`, `assertionHash`, `sourceEventIds`, `evidenceManifestIds`, `scope`, `relevance`, `confidence`, `applicability`, `projectionCheckpoint`, and bounded recommendation text.
- Receipt contains `receiptId`, `queryHash`, query parser/version, index versions, filters, result order, and actor/purpose.

- [ ] Write tests for exact graph constraints, semantic recall, scope/tenant filtering, bitemporal views, supersession, applicability, confidence ranking, and empty results.
- [ ] Write a test proving no result is eligible when source events or evidence manifests cannot be resolved.
- [ ] Write a benchmark fixture with known relevant/irrelevant lessons and assert precision/recall thresholds before ranking changes are accepted.
- [ ] Run focused retrieval tests and confirm they fail before implementation.
- [ ] Implement exact filtering first, then lexical/vector recall, deterministic tie-breaking, and receipt persistence in the canonical store.
- [ ] Run retrieval tests and the benchmark.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/query-builder.js apps/openmanga/server/services/cinegraph/retrieval.js apps/openmanga/tests/cinegraph-retrieval.test.js && git commit -m "feat: add explainable CineGraph retrieval"`.

## Task 12: Connect evaluation, lessonization, and Director use

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/lessonizer.js`
- Create: `apps/openmanga/server/services/cinegraph/lineage.js`
- Modify: `apps/openmanga/server/services/story-first.js`
- Test: `apps/openmanga/tests/cinegraph-memory-loop.test.js`

**Interfaces:**
- `createLessonFromEvaluation({ actor, tenantId, projectId, attempt, evaluation, requestedScope })` appends evaluation and lesson events, creates an assertion, applies policy, and enqueues eligible projections.
- `reviseScenePlan({ scenePlan, retrievalReceiptId, selectedKnowledgeIds })` returns an immutable plan revision whose `usedKnowledgeIds` are a subset of the receipt’s result IDs.
- `recordAttemptLineage({ attempt, planRevision, artifact, retrievalReceipt })` appends `USED_KNOWLEDGE` and `INFLUENCED` edges.

- [ ] Write an end-to-end fixture for Try 1 evaluation, lesson creation, canonical event commit, local projection, retrieval, revised plan, and Try 2 lineage.
- [ ] Write negative tests for critic access to hidden memory, unapproved lesson sharing, unknown knowledge IDs, stale receipts, and plan revision conflicts.
- [ ] Run focused memory-loop tests and confirm they fail before implementation.
- [ ] Implement the lessonizer and Director integration using canonical commands, not direct table mutation.
- [ ] Persist instruction deltas and selected knowledge IDs as evidence of use.
- [ ] Run the fixture loop and assert independent Try 1/Try 2 artifact hashes and lineage.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/lessonizer.js apps/openmanga/server/services/cinegraph/lineage.js apps/openmanga/server/services/story-first.js apps/openmanga/tests/cinegraph-memory-loop.test.js && git commit -m "feat: connect creative attempts to CineGraph memory"`.

## Task 13: Integrate generation artifacts and Livepeer provenance

**Files:**
- Modify: `apps/openmanga/server/app.js`
- Modify: `apps/openmanga/server/services/generation-history-store.js`
- Modify: `apps/openmanga/server/services/livepeer-agent.js`
- Test: `apps/openmanga/tests/cinegraph-generation-provenance.test.js`

**Interfaces:**
- `recordGenerationAttempt({ projectId, planRevision, providerRequest, providerResponse, evidenceManifest })` appends an immutable attempt, artifact, and provenance event before/after remote work according to job state.
- Provider provenance includes requested capability, served model, job ID, output hash, cost, latency, input hashes, and adapter version.

- [ ] Write tests for attempt creation before expensive work, failed jobs, retry identity, successful Livepeer receipts, artifact hash verification, and separate Try 1/Try 2 records.
- [ ] Run focused provenance tests and confirm they fail before implementation.
- [ ] Implement attempt events and evidence manifests around the existing generation job state machine.
- [ ] Ensure provider secrets and raw prompts remain outside shared/public assertions while their hashes and approved metadata remain linkable.
- [ ] Run focused tests and the existing Livepeer/server suite.
- [ ] Commit with `git add apps/openmanga/server/app.js apps/openmanga/server/services/generation-history-store.js apps/openmanga/server/services/livepeer-agent.js apps/openmanga/tests/cinegraph-generation-provenance.test.js && git commit -m "feat: record creative generation provenance"`.

## Task 14: Expose secure project-scoped APIs and export/import

**Files:**
- Modify: `apps/openmanga/server/app.js`
- Modify: `apps/openmanga/server/services/project-portability.js`
- Modify: `apps/openmanga/src/lib/api.mjs`
- Test: `apps/openmanga/tests/cinegraph-api.test.js`

**Interfaces:**
- Add `POST /api/projects/:id/cinegraph/commands`, `GET /api/projects/:id/cinegraph/events`, `POST /api/projects/:id/cinegraph/query`, `GET /api/projects/:id/cinegraph/receipts/:receiptId`, `GET /api/projects/:id/cinegraph/lineage/:attemptId`, and `POST /api/projects/:id/cinegraph/promotions`.
- Export includes canonical events, hashes, manifests, receipts, projection checkpoints, schema versions, and redacted assertions; import verifies hashes before activation.

- [ ] Write API tests for authorization, request IDs, typed conflicts, idempotent commands, pagination, receipt visibility, and export/import hash verification.
- [ ] Run focused API tests and confirm they fail before implementation.
- [ ] Implement routes through command/query services with tenant/project checks before any database or DKG call.
- [ ] Implement export/import as a signed manifest with version compatibility and explicit handling for public immutable assets that cannot be deleted.
- [ ] Run API, portability, and full server tests.
- [ ] Commit with `git add apps/openmanga/server/app.js apps/openmanga/server/services/project-portability.js apps/openmanga/src/lib/api.mjs apps/openmanga/tests/cinegraph-api.test.js && git commit -m "feat: expose CineGraph production APIs"`.

## Task 15: Add inspector UI for provenance, scope, and projection health

**Files:**
- Create: `apps/openmanga/src/components/CineGraphInspector.jsx`
- Modify: `apps/openmanga/src/components/CreatorView.jsx`
- Modify: `apps/openmanga/src/index.css`
- Test: `apps/openmanga/tests/cinegraph-ui.test.js`

**Interfaces:**
- The inspector consumes API projections and renders source event IDs, lesson/evaluation/attempt lineage, scope, trust state, assertion hash, projection checkpoint/lag, DKG UAL, and knowledge-used IDs.
- UI labels distinguish `local`, `projected`, `shared`, `public_pending`, `verified`, `superseded`, `failed`, and `stale_projection`.

- [ ] Write UI tests for empty memory, pending outbox, projection lag, shared Edge Node, verified UAL, superseded lesson, and policy rejection.
- [ ] Run focused UI tests and confirm they fail before implementation.
- [ ] Implement a compact inspector and lineage rail that never displays secrets or raw assertion payloads by default.
- [ ] Add explicit actions for seal, share approval, promote, retry, and inspect receipt with confirmation for exposure-changing actions.
- [ ] Run UI tests and production build.
- [ ] Commit with `git add apps/openmanga/src/components/CineGraphInspector.jsx apps/openmanga/src/components/CreatorView.jsx apps/openmanga/src/index.css apps/openmanga/tests/cinegraph-ui.test.js && git commit -m "feat: show production CineGraph provenance"`.

## Task 16: Add production operations, observability, and recovery

**Files:**
- Create: `apps/openmanga/server/services/cinegraph/health.js`
- Create: `apps/openmanga/server/services/cinegraph/metrics.js`
- Create: `apps/openmanga/docs/cinegraph-operations-runbook.md`
- Create: `apps/openmanga/docs/cinegraph-disaster-recovery.md`
- Test: `apps/openmanga/tests/cinegraph-operations.test.js`

- [ ] Write tests for readiness checks, projection lag thresholds, dead-letter alerts, hash mismatch alerts, DKG timeout reconciliation, and backup manifest validation.
- [ ] Implement health endpoints for database, projection checkpoints, object storage, DKG adapter, and outbox age.
- [ ] Emit structured metrics for event latency, projection lag, retrieval latency, DKG operation latency, retry counts, policy rejects, and hash mismatches.
- [ ] Document point-in-time database restore, object-store restore, projection rebuild, DKG receipt reconciliation, key rotation, and incident response.
- [ ] Exercise restore into an isolated environment and compare canonical hashes and projection checkpoints.
- [ ] Run operations tests and production build.
- [ ] Commit with `git add apps/openmanga/server/services/cinegraph/health.js apps/openmanga/server/services/cinegraph/metrics.js apps/openmanga/docs/cinegraph-operations-runbook.md apps/openmanga/docs/cinegraph-disaster-recovery.md apps/openmanga/tests/cinegraph-operations.test.js && git commit -m "feat: operate CineGraph in production"`.

## Task 17: Verify real DKG publication and production acceptance

**Files:**
- Create: `apps/openmanga/tests/cinegraph-edge-node-contract.test.js`
- Create: `apps/openmanga/tests/cinegraph-production-acceptance.test.js`
- Modify: `README.md`
- Modify: `apps/openmanga/README.md`
- Modify: `docs/EVIDENCE-FRAME.md`
- Modify: `docs/research/EVIDENCE-LEDGER.md`

- [ ] Add an opt-in Edge Node test that skips when credentials are absent and fails when a configured endpoint violates the adapter contract.
- [ ] Run the real Context Graph create/write/read/query/verify flow and record operation IDs, assertion hashes, network, UAL where available, and projection checkpoints.
- [ ] Run crash/retry and duplicate-idempotency scenarios against a controlled test environment.
- [ ] Run canonical replay, migration, backup/restore, tenant-isolation, privacy, retrieval benchmark, and DKG outbox checks.
- [ ] Add the evidence fields to the repository evidence ledger and state clearly which claims are local fixture evidence, Edge Node evidence, or public-network evidence.
- [ ] Run `npm test` and `npm run build` from `apps/openmanga`.
- [ ] Update README instructions and production limitations based on observed behavior.
- [ ] Commit with `git add README.md apps/openmanga/README.md docs/EVIDENCE-FRAME.md docs/research/EVIDENCE-LEDGER.md apps/openmanga/tests/cinegraph-edge-node-contract.test.js apps/openmanga/tests/cinegraph-production-acceptance.test.js && git commit -m "docs: verify CineGraph production acceptance"`.
