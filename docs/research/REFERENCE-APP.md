# Workshop reference application

Source: [its-DeFine/livepeer-dkg-iteration-lab](https://github.com/its-DeFine/livepeer-dkg-iteration-lab)

The repository was cloned into `reference-livepeer-dkg-iteration-lab`, dependencies were installed, the app was run in mock mode, and the reference tests and production build passed.

## Verified local run

- Mock settings: `LIVEPEER_MODE=mock`, `DKG_MODE=file`, `JUDGE_MODE=mock`.
- Test result: 9 tests passed.
- Build result: Vite client build and server TypeScript build passed.
- Browser result: Try 1 produced a mock artifact scored 6/10; Try 2 with DKG memory produced a mock artifact scored 8/10.
- The browser displayed the selected DKG observations before Try 2, a prompt fingerprint, a graph with 13 entities and 14 links, and separate Run Ledger and Improvement Memory views.

Mock mode is interface and state-machine evidence only. It is not evidence of a real Livepeer or DKG integration.

## Architecture to adapt

The reference separates:

- Director: owns the attempt loop and immutable per-attempt history.
- Livepeer adapter: mock and MCP implementations, async polling, output reference extraction, idempotency keys, and capability profiles.
- Judge adapter: mock and Livepeer-backed implementations with an artifact-only judging prompt.
- DKG adapter: file snapshots for local development and CLI-backed DKG Context Graph/Knowledge Asset writes and queries.
- Storage: atomic JSON state writes plus per-attempt JSON-LD and Turtle snapshots.
- UI: artifact-first workspace, attempt comparison, knowledge asset views, graph navigation, RDF view, and explicit memory-used display.

## Patterns worth reusing

- Reserve and persist an attempt job before expensive remote work begins.
- Keep attempts immutable; never mutate Try 1 when recording Try 2.
- Persist completed artifact and evaluation even if the later DKG write fails.
- Use cumulative but versioned Run Ledger and Improvement Memory snapshots.
- Verify the latest DKG write with a query/readback rather than treating a receipt as proof.
- Keep the judge blind to memory, prompt history, and provenance so the evaluation is not contaminated.
- Sanitize DKG summaries and store hashes/references instead of private prompt text.
- Scope concurrent project mutations so a late response cannot alter the selected project.

## Patterns to update or reject

- Do not copy the fixed `flux-schnell` and `pixverse-t2v` choices as the product catalog. Current Livepeer discovery returned 173 AI capabilities and tells clients to discover and describe capabilities first.
- Do not treat `run_capability` as the only generation path. Current Agent guidance recommends `create_media` for ordinary media and reserves exact raw dispatch for cases that need it.
- Do not treat a local file snapshot as Track 2 proof. Real DKG node create/read/query evidence is required.
- Do not present a higher judge score as causal proof that memory improved quality.
- Do not publish raw prompts or large media to DKG.

