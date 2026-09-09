# Reuse map

Research date: 2026-09-10.

| Problem | Existing solution | Source | Reuse / adapt / reject | Reason |
| --- | --- | --- | --- | --- |
| Discover current media capabilities | Livepeer Agent capability registry with `list_capabilities` and `describe_capability` | [Livepeer Agent](https://agent.livepeer.org/get-started.html) | Reuse | The registry is live and current; hard-coded model lists will drift. |
| Compare generation cost | Livepeer `get_pricing` and `get_cost_report` | [Livepeer Agent](https://agent.livepeer.org/get-started.html) | Reuse | The application should show runtime price and actual attempt spend. |
| Execute image/video/audio work | Livepeer Agent `create_media` or exact `run_capability` | [Livepeer Agent](https://agent.livepeer.org/get-started.html) | Adapt | Use the richer media path where sufficient; use exact dispatch only when the contract requires it. |
| Async rendering | Job ID plus `get_create_media` polling | [Livepeer Agent](https://agent.livepeer.org/get-started.html), reference adapter | Reuse / adapt | Poll stalled jobs and never duplicate billed work. |
| Safe retries | Idempotency key per logical action | Livepeer live tool schema, reference adapter | Reuse / adapt | Protects refreshes, transport retries, and repeated button actions. |
| Attempt orchestration | Director-owned state machine and reservation before remote work | [Reference architecture](https://github.com/its-DeFine/livepeer-dkg-iteration-lab/blob/main/docs/architecture.md), local clone | Adapt | Keep the loop but add ScenePlan, character/style entities, and explicit CineGraph retrieval. |
| Blind artifact judging | Artifact-only judge prompt with normalized JSON output | Reference `server/adapters/judge.ts` | Adapt | Extend dimensions for manga; keep hidden prompt/memory out of the judge input. |
| Immutable evidence | Per-Try Run Ledger snapshots and prompt/output hashes | Reference `server/director.ts`, `server/adapters/dkg.ts` | Adapt | Add provenance relationships for ScenePlan, CharacterIdentity, StyleIdentity, Lesson, and Try 2. |
| Knowledge graph storage | DKG Context Graph and Knowledge Asset lifecycle | [OriginTrail publish/query](https://docs.origintrail.io/use-dkg/publish-and-query) | Reuse / adapt | Use real Edge Node Working/Shared Memory first; keep promotion possible. |
| Minimal DKG round trip | Four-triple Hello World HTTP integration | [DKG Hello World](https://github.com/OriginTrail/dkg-hello-world) | Adapt | Use its node API/auth and idempotent Context Graph pattern, replacing greeting triples with CineGraph RDF. |
| Local development | File adapter and mock Livepeer/Judge adapters | Reference repo | Reuse with visible labeling | Enables fast UI/tests; never present mock mode as Track 2 evidence. |
| Public/shared privacy boundary | Hashes, references, short summaries, no secrets/media bytes | Reference README and DKG docs | Reuse / strengthen | Add per-asset scope and consent before sharing. |
| Model routing and media infrastructure | Livepeer Agent and network gateways/orchestrators | [Livepeer network docs](https://docs.livepeer.org/network) | Reuse | OpenCinema differentiation is creative intelligence and knowledge reuse, not a second renderer. |
| Crypto product surface | Tokens, wallet UI, NFT marketplace, DAO | Product brief | Reject for MVP | No product value for the core Try 1 to Try 2 proof. |
| Full manga editor/timeline | Product brief | Product brief | Reject for MVP | Would dilute the single demonstrable memory loop. |

