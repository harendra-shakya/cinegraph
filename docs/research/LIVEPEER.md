# Livepeer Agent research

Research date: 2026-09-10. The live endpoint was probed on 2026-09-10 with a keyless, read-only MCP client; no bearer token was used.

## Current Agent surface

The current Get Started page defines the MCP endpoint as:

`https://agent.livepeer.org/api/mcp`

The recommended lean profile exposes nine core tools: `list_capabilities`, `get_pricing`, `create_media`, `generate_project`, `upload`, `get_cost_report`, `subscribe_progress`, `attach_skill`, and `list_skills`. The full surface remains available when a specialized operation requires it.

The keyless demo currently advertises approximately $10 of demo credit per network address over seven days at real model prices. Full access uses a Daydream key. Credentials belong in runtime configuration only.

Sources:

- [Livepeer Agent Get Started](https://agent.livepeer.org/get-started.html)
- [Livepeer network overview](https://docs.livepeer.org/network)
- [Livepeer orchestrators](https://docs.livepeer.org/network/explanation/orchestrators)
- [Livepeer glossary](https://docs.livepeer.org/network/reference/glossary)

## Live probe results

The MCP `initialize` response reported protocol version `2025-03-26`, server name `livepeer-agent-raw (demo credits — no key)`, and a raw surface whose instructions say to discover capabilities and describe a capability before invoking one.

The `list_capabilities` probe returned 173 live AI capabilities and 10 registered capabilities without live capacity. Examples included `gemini-text`, `flux-schnell`, `gemini-image`, `pixverse-ref2v`, `pixverse-t2v`, `seedance-mini-ref2v`, `kling-v3-turbo-t2v`, and many other image, video, audio, 3D, and finishing capabilities.

The `describe_capability` probe returned these current records:

| Capability | Current contract observed | Live evidence |
| --- | --- | --- |
| `flux-schnell` | prompt-only image generation; `run_capability`; timeout example 37 seconds | 100% success, n=47, seven-day window; p50 4.767 seconds, p95 6.14 seconds |
| `pixverse-ref2v` | reference-video-to-video; integer duration 1–15 seconds; timeout example 255 seconds | availability reported as available; live SLA unavailable |
| `gemini-text` | prompt-only text generation; `run_capability`; timeout example 34 seconds | 100% success, n=14, seven-day window; p50 1.747 seconds, p95 3.198 seconds |

The `get_pricing` probe returned:

| Capability | Price observed | Unit |
| --- | ---: | --- |
| `flux-schnell` | $0.00315 | megapixel |
| `gemini-image` | $0.00410 | image |
| `pixverse-ref2v` | $0.06825 | second |
| `kling-v3-turbo-t2v` | $0.11760 | second |

These values are point-in-time rate-card evidence, not permanent product constants. The application must discover and record the capability, served model, price basis, and cost at runtime.

## Invocation and reliability rules

- Use `list_capabilities` before selecting a model.
- Use `describe_capability` before the first call to a new capability; parameters differ between siblings.
- Use `get_pricing` for pre-flight comparisons, and `get_cost_report` for retrospective spend.
- Use `create_media` for ordinary image, video, and audio generation when its richer behavior is sufficient.
- Use `run_capability` when exact dispatch or a capability-specific contract is required. The current raw surface says it does not fuzzy-match or silently fall back.
- Pass a per-logical-action `idempotency_key`. A repeated key replays the result or the same async job rather than billing a second render.
- Pass a stable `session_id` to attribute spend to the attempt.
- Treat async video/audio as normal: capture `job_id`, poll with `get_create_media`, and never re-submit just because a response stream stalled.
- Size the timeout at or above the capability's p95. A client timeout does not necessarily cancel upstream work or avoid billing.
- Record `requested_capability`, `capability` or `served_model_id`, `model_note` when present, job reference, output URL, cost fields, and warnings.
- Use `persist` only when a durable hosted copy is needed; it adds storage and copy cost.

## Why the network matters

Livepeer is a decentralized marketplace for AI video compute. Applications send jobs to a gateway; gateways select orchestrators using capability, price, latency, reliability, and stake; orchestrators execute AI or video work on GPUs and receive payment. OpenCinema should therefore describe Livepeer as the distributed execution layer for media jobs, not as a badge or a local renderer it rebuilt.

