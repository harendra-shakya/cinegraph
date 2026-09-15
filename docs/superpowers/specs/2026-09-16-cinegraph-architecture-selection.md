# CineGraph Production Architecture Selection

**Date:** 2026-09-16

**Decision outcome:** Choose a **content-addressed, event-sourced, bitemporal RDF knowledge core with DKG projections**. The canonical system records immutable knowledge events and their provenance in a production database; RDF/JSON-LD projections serve semantic queries; vector indexes are derived; OriginTrail DKG is the verifiable private/shared/public distribution and publication layer; media remains in governed object storage.

This decision supersedes the earlier prototype-oriented assumption that a file-backed local ledger plus a DKG adapter is sufficient for production. A local adapter remains useful for tests and offline development, but it is not the production architecture.

## 1. Production quality bar

Creative knowledge is unusually difficult to store well because it mixes entities, interpretations, experiments, subjective judgments, media evidence, evolving identity, and private intellectual property. A valid architecture must preserve meaning rather than only text, and it must make every derived conclusion auditable.

The candidates are evaluated against these weighted criteria:

| Criterion | Weight | What “excellent” means |
| --- | ---: | --- |
| Semantic fidelity and interoperability | 15 | RDF/JSON-LD, stable vocabulary, external linking, machine-readable constraints |
| Provenance and causal lineage | 15 | Every assertion has source, agent, method, time, evidence, and derivation |
| Versioning and temporal truth | 12 | Immutable history, valid time, transaction time, supersession, reproducible views |
| Privacy and controlled sharing | 12 | Private, team, and public states without copying sensitive source material into public systems |
| Identity and integrity | 10 | Stable IDs, content hashes, canonical serialization, tamper evidence, deduplication |
| Retrieval quality | 10 | Exact graph queries plus semantic recall, applicability filters, explainable ranking |
| Operational durability | 10 | Transactions, retries, replay, backup, recovery, idempotency, observability |
| Schema evolution and migration | 6 | Versioned ontology, additive change, re-projection and backfill without data loss |
| Scale and cost control | 5 | Derived indexes, tiered storage, bounded DKG publication, efficient media handling |
| Production integration fit | 5 | Works with the existing application, Livepeer, Edge Node, and future services |

Scores are from 1 to 5. A score under 3 on semantic fidelity, provenance, versioning, privacy, or operational durability is a rejection regardless of total score.

## 2. Ten candidate architectures

### A. DKG-native Knowledge Asset system of record

Every creative object and relation is authored directly as an OriginTrail Knowledge Asset. The application uses DKG operations for persistence and queries, with local caches for speed.

**Strengths:** Native UAL ownership, network provenance, RDF/SPARQL, direct alignment with OriginTrail.

**Failure mode:** DKG publication and network consistency are poor foundations for high-frequency draft writes, private transactional workflow state, media metadata joins, job orchestration, or deterministic product-side replay. It also couples the domain model to network/API availability and costs.

### B. Event-sourced relational core with DKG projections

All domain changes are immutable events in a transactional database. Current state, RDF/JSON-LD assertions, vector embeddings, search indexes, and DKG Knowledge Assets are projections of that event stream.

**Strengths:** Strong transactions, replay, auditability, offline/outbox support, schema evolution, clear separation of operational state and public knowledge.

**Failure mode:** The team must build and operate projection pipelines and canonical RDF serialization correctly. DKG is not automatically the source of truth for local state.

### C. RDF triplestore as canonical store, DKG as publication bridge

All knowledge is stored natively as RDF in a production triplestore. The application uses SPARQL for writes and reads, while DKG receives selected graph partitions.

**Strengths:** Best native semantic model, standards-based queries, easy ontology validation, straightforward DKG projection.

**Failure mode:** Transactional product state, append-only event history, binary evidence references, and high-quality operational replay need additional systems. RDF alone does not provide a sufficient event/audit model.

### D. Property graph as canonical store with RDF/DKG export

Creative entities and relationships are stored in Neo4j or a similar property graph. RDF and DKG assets are export formats.

**Strengths:** Excellent traversal ergonomics and graph exploration, approachable developer experience, good fit for lineage UI.

**Failure mode:** RDF interoperability and formal semantics become translation concerns. Provenance, temporal history, canonicalization, and DKG-compatible assertions require extra modeling discipline.

### E. Temporal knowledge lakehouse with graph serving layer

Raw events, media metadata, evaluations, and graph assertions land in object storage and table formats. A graph serving index is built for online retrieval; DKG publication is a downstream export.

**Strengths:** Excellent scale, replay, analytics, offline evaluation, dataset versioning, and cost control for large creative corpora.

**Failure mode:** High latency and platform complexity are unjustified for transactional authoring and early product workflows. Strong online privacy and per-project consistency require another system.

### F. Content-addressed Merkle DAG of creative knowledge

Every record is a content-addressed node. Immutable Merkle links connect plans, artifacts, evaluations, lessons, and revisions. DKG assets anchor or publish selected roots.

**Strengths:** Excellent integrity, deduplication, reproducibility, branching, portable exports, and cryptographic lineage.

**Failure mode:** Content addressing alone does not provide efficient temporal queries, access control, full-text/vector retrieval, or product transactions. Those become separate layers.

### G. CRDT-first collaborative knowledge graph

Knowledge objects are replicated CRDT documents so multiple creators and agents can edit concurrently offline. DKG stores shared or public snapshots.

**Strengths:** Strong offline collaboration, conflict-free editing, multi-agent authoring, and portable user-owned data.

**Failure mode:** Creative knowledge is not only collaborative document state; it needs immutable evidence and semantic assertions. CRDT merge semantics are awkward for conclusions, scores, supersession, and policy-governed publication.

### H. Federated personal knowledge graphs with DKG federation

Each creator, project, or agent owns a private graph on an Edge Node. A federation layer resolves, ranks, and optionally publishes references or assertions into shared DKG context graphs.

**Strengths:** Excellent privacy, ownership, autonomy, and cross-organization collaboration. Closest to OriginTrail’s private/shared/public memory direction.

**Failure mode:** Federation without a canonical local event/provenance contract makes consistency, replay, deletion, schema upgrades, and cross-graph causal lineage difficult. It is a deployment topology, not sufficient domain architecture by itself.

### I. Knowledge Asset registry and evidence catalog

Every meaningful lesson, technique, identity, and model observation becomes a first-class Knowledge Asset. A registry relates assets to local projects and media evidence; DKG is the canonical asset catalog.

**Strengths:** Clear boundaries, good asset ownership, easy public sharing, strong discoverability, and good fit for a future creative knowledge marketplace.

**Failure mode:** It models the nouns well but under-specifies the event history and causal process that produced them. A registry cannot, by itself, guarantee reproducible generation lineage or robust temporal semantics.

### J. Hybrid semantic event graph: B + F + H, with DKG projections

The canonical core is an immutable event log with bitemporal facts and content-addressed payloads. A relational operational store provides transactions and authorization; RDF/JSON-LD is the semantic projection; Merkle links provide integrity; private Edge Nodes and shared/public DKG assets provide controlled distribution. Vector and full-text indexes are derived projections.

**Strengths:** Covers the complete quality bar: transactional durability, replay, semantics, integrity, temporal truth, privacy, DKG alignment, strong retrieval, and future federation.

**Failure mode:** Most implementation discipline and the largest initial system surface. The team must define canonicalization, projection guarantees, retention, and consistency semantics carefully.

## 3. Elimination process

### Elimination 1: reject DKG-only as operational source of truth

Candidate A scores well for interoperability and DKG alignment but fails the high-frequency transactional workflow requirement. Draft plans, failed generation jobs, local policy decisions, and private evidence need atomic local writes and replay without network availability or publication cost. **A is eliminated as the primary architecture**, but its native Knowledge Asset semantics remain a target projection.

### Elimination 2: reject RDF-only as the complete product database

Candidate C is the strongest semantic store, but RDF assertions alone do not provide the application’s required event log, job state, access-control decisions, outbox, or operational replay model. **C is eliminated as the complete architecture**, but RDF remains the canonical semantic interchange and query projection.

### Elimination 3: reject property graph as semantic authority

Candidate D is attractive for exploration, but translating between property-graph semantics and RDF/DKG semantics creates avoidable ambiguity around identity, provenance, and external interoperability. **D is eliminated as the authoritative model**. A property-graph read model may be added later for exploration if measurements justify it.

### Elimination 4: reject lakehouse-first for the product transaction path

Candidate E is ideal for corpus analytics and offline evaluation, but not for responsive project authoring, transactional privacy decisions, or immediate lineage reads. **E is eliminated as the primary serving architecture**. It remains a downstream analytics and training projection.

### Elimination 5: reject Merkle DAG alone as the complete architecture

Candidate F solves integrity better than most candidates but leaves temporal query, authorization, retrieval, and product transaction concerns unresolved. **F is eliminated as a standalone architecture**. Content addressing and Merkle links are retained inside the winner.

### Elimination 6: reject CRDT-first for the first canonical model

Candidate G is excellent for concurrent documents, but merging creative conclusions and evidence is not equivalent to merging editable text. **G is eliminated as the canonical persistence model**. CRDTs may be used later for collaborative draft editing above the immutable knowledge core.

### Elimination 7: reject federation-only as a domain model

Candidate H correctly emphasizes ownership and private Edge Nodes, but it leaves local event history and cross-node consistency underspecified. **H is eliminated as a standalone architecture**. Federation becomes the distribution topology of the winner.

### Elimination 8: reject registry-only for lack of causal depth

Candidate I captures durable assets but not the full process that produced them. Without immutable events, a lesson can be discoverable but not defensibly connected to the evaluation, attempt, model, and artifact that support it. **I is eliminated as the complete architecture**. Asset registry behavior is included in the semantic projection.

### Elimination 9: compare the remaining composite directions

Candidate B supplies the strongest production transaction and replay foundation. Candidate F supplies content integrity. Candidate H supplies the correct privacy and distribution topology. Candidate J combines them while retaining RDF and DKG as first-class boundaries rather than export afterthoughts.

## 4. Weighted scorecard

| Candidate | Semantics | Provenance | Time | Privacy | Integrity | Retrieval | Operations | Evolution | Scale | Fit | Weighted score | Result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| A DKG-only | 5 | 4 | 2 | 4 | 5 | 4 | 2 | 3 | 3 | 4 | 3.55/5 | Reject |
| B Event-sourced + DKG projections | 4 | 5 | 5 | 5 | 4 | 5 | 5 | 5 | 4 | 5 | 4.75/5 | Strong finalist |
| C RDF canonical | 5 | 5 | 3 | 4 | 4 | 5 | 3 | 4 | 4 | 4 | 4.15/5 | Reject as complete system |
| D Property graph | 3 | 4 | 3 | 4 | 3 | 5 | 4 | 3 | 4 | 4 | 3.65/5 | Reject as authority |
| E Lakehouse-first | 4 | 5 | 5 | 4 | 5 | 3 | 4 | 5 | 5 | 2 | 4.25/5 | Reject as serving core |
| F Merkle DAG | 4 | 5 | 5 | 4 | 5 | 2 | 3 | 5 | 4 | 3 | 3.95/5 | Reject standalone |
| G CRDT-first | 3 | 4 | 3 | 5 | 3 | 3 | 3 | 4 | 4 | 3 | 3.55/5 | Reject canonical model |
| H Federated graphs | 5 | 4 | 3 | 5 | 4 | 4 | 3 | 4 | 4 | 4 | 4.15/5 | Reject standalone |
| I Asset registry | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 5 | 3.75/5 | Reject complete system |
| J Hybrid semantic event graph | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 5 | 4 | 5 | **4.85/5** | **Winner** |

The weighted score is a decision aid, not a claim of mathematical certainty. Candidate J wins because it is the only option that treats operational history, semantic meaning, cryptographic integrity, controlled distribution, and retrieval as cooperating concerns with explicit boundaries.

## 5. Winner: CineGraph Production Core

The selected architecture has five layers:

```text
1. Immutable knowledge event log
   append-only facts, observations, decisions, provenance events

2. Transactional operational store
   PostgreSQL records, authorization, bitemporal indexes, outbox, idempotency

3. Semantic and integrity projections
   canonical JSON-LD/RDF, n-quads hashes, Merkle links, SPARQL/vector indexes

4. Governed evidence and media storage
   object storage for bytes, metadata, hashes, transformations, retention policy

5. DKG distribution and verification
   Edge Node private/shared memory, public Knowledge Assets, UALs, receipts
```

### Canonicality rule

The event log plus immutable content-addressed payloads are the canonical record of what CineGraph knows and why it knows it. PostgreSQL provides the transactional materialization of that record. RDF, vector indexes, graph explorers, and DKG Knowledge Assets are derived or distributed views whose projection status and source event range are recorded.

### Consistency rule

Local event commit is synchronous and durable. Derived projections are asynchronous but observable through checkpoints and lag metrics. A DKG write is considered complete only when the adapter has a normalized receipt; a local assertion remains `pending` or `failed` until then. Public publication never changes the underlying semantic identity of the lesson.

### Privacy rule

Raw creative material stays in governed private storage. Shared or public assertions are minimized projections containing stable IDs, hashes, bounded semantic observations, applicability constraints, and provenance references that do not expose private source content.

## 6. Why this is highest quality for creative knowledge

Creative knowledge is not just a collection of tips. It is a time-dependent, evidence-backed network of claims:

```text
an attempt made under conditions
  -> an artifact produced by a model/provider
  -> an evaluation made by a declared method
  -> an observation or lesson
  -> a later use in a plan
  -> a subsequent result that may confirm, refine, or falsify it
```

The winner can represent all of that without forcing private drafts into a public network, without flattening uncertainty into a single label, and without losing the history needed to understand when a lesson was valid. It also permits later re-ranking, re-evaluation, and ontology migration because the original events and payload hashes remain available.

## 7. Consequences

### Positive

- Production workflows do not depend on DKG availability for local durability.
- Every semantic assertion can be replayed and re-projected.
- DKG publication is meaningful because it is a governed projection of known provenance, not the only copy of the data.
- Retrieval can use graph constraints, semantic similarity, and applicability without sacrificing auditability.
- Schema and ontology evolution can be performed by replaying events into a new projection.
- The same knowledge core can support manga, storyboards, shots, and video without changing the event model.

### Costs

- More components and more operational ownership than a DKG-only prototype.
- Canonicalization and projection correctness require conformance tests.
- Production deployment needs database migrations, object-storage policy, key management, observability, backup, and recovery exercises.
- The first implementation should be narrower in domain vocabulary, but deeper in durability and evidence.

## 8. Required quality gates

Before calling CineGraph production-ready, the implementation must pass:

1. Canonical serialization round-trip tests for JSON-LD to normalized n-quads.
2. Event replay tests proving the same event range yields the same semantic projection hash.
3. Bitemporal query tests for valid-time and transaction-time behavior.
4. DKG adapter conformance tests for create, read, query, update/supersede, and receipt recovery.
5. Privacy tests proving prohibited fields cannot cross the scope boundary.
6. Outbox crash/restart tests proving no duplicate billed publication.
7. Backup/restore tests for database, object metadata, and projection checkpoints.
8. Schema migration tests from every supported prior projection version.
9. Retrieval benchmark tests for precision, recall, applicability filtering, and explainable receipts.
10. Security tests for tenant isolation, authorization, signed webhooks, and secret handling.

