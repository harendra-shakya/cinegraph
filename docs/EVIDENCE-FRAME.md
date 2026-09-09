# OpenCinema Evidence Frame

Status: proposed; awaiting ratification by the product decision-maker.

Prepared: 2026-09-10

## 1. Decision-maker map

| Decision-maker | Decision | What they lose if this fails |
| --- | --- | --- |
| Track 2 hackathon judges | Award and accept the project as a credible Track 2 submission | Review time and confidence that the DKG integration is real, useful, and central rather than decorative |
| Founder / product owner | Continue investment after submission and prioritize a pilot | Build time, paid media spend, and credibility if the product is only a polished mock |
| Independent creator or artist, pilot user | Use the workflow for the next scene or abandon it | Time spent re-prompting for character/style consistency and trust in generated work |

## 2. Their existing scoreboard

The published judge scoreboard is qualitative: usefulness and originality, clarity of user and purpose, meaningful Livepeer Agent use, end-to-end execution, product judgment, continuation potential, and whether verifiable knowledge materially improves the application. The participant pack also requires a public repository, README, working demonstration, demo video, integration explanation, limitations, and the Track 2 Knowledge Asset path.

The founder and creator scoreboards are not yet observed in a primary workflow. Until a timed baseline session is completed, creator outcome metrics remain supporting evidence rather than headline claims.

## 3. KPI cross-map

The table deliberately operationalizes the judge's published requirements without inventing a judge percentage score.

| Their monitored measure | Our KPI, same units | Measurement at current stage | Baseline plan | Headline? |
| --- | --- | --- | --- | --- |
| Track 2: actual DKG create/retrieve/query/verify path | Complete real DKG evidence paths / eligible held-out demo paths | Binary checklist per path: asset created, read/query succeeds, retrieved lesson is displayed before Try 2 | 0 completed product paths before implementation; verify on 5 held-out briefs before demo | Yes |
| Track 2: knowledge materially changes application behavior/value | Held-out cases where retrieved knowledge changes the next Director instruction / cases with retrievable knowledge | Compare Try 2 prompt fingerprint and normalized instruction set against Try 1; require at least one named retrieved lesson in the changed instruction set | Baseline manual/prompt-only workflow on the same 5 briefs; pre-register what counts as a changed instruction | Yes |
| End-to-end execution | Completed real Livepeer + DKG loops / started eligible loops | Denominator includes failures; a loop completes only when artifact, independent evaluation, Knowledge Asset readback, and knowledge-used evidence exist | Run 5 pre-demo cases on the real path; record all started attempts | Yes |
| Usefulness and product judgment | Median creator time to reach a reviewable four-panel page, in minutes | Timed from brief submission to reviewable Try 2 comparison, paired against manual baseline | One roleplayed or real creator, 5 paired briefs, baseline completed before demo | Supporting until baseline is observed |
| Meaningful Livepeer Agent use | Real Livepeer media attempts / eligible media attempts | Runtime capability, model served, job/output reference, cost, and failure status recorded per attempt | 0 before integration; verify all demo attempts use real Agent mode | Supporting evidence |

No claim will use a bare percentage. Every result will include numerator, denominator, and eligible-attempt definition.

## 4. Causal KPI tree

This is the causal justification for the cross-map; driver links are hypotheses, not identities.

`🟧 Track 2 decision confidence <- complete real DKG evidence, material behavior change, end-to-end reliability, product clarity`

`├─ 🟧 Material behavior change <- retrieved lesson coverage, lesson-to-instruction binding, Director revision quality`

`│  ├─ 🟧 Retrieved lesson coverage <- query recall, scope filtering, typed CineGraph relationships`

`│  ├─ 🟧 Lesson-to-instruction binding <- explicit knowledge-used records, prompt fingerprint delta, pre-generation UI evidence`

`│  └─ 🟧 Director revision quality <- ScenePlan constraints, character/style anchors, critic recommendation quality`

`├─ 🟧 Complete real DKG evidence <- asset write success, readback success, provenance completeness`

`├─ 🟧 End-to-end reliability <- Livepeer availability, timeout sizing, idempotency, durable attempt state`

`└─ 🟧 Product clarity <- artifact-first layout, visible Try 1 to Try 2 causal chain, privacy labels, short demo path`

Measurement caveats: graph retrieval can return irrelevant or stale lessons; a changed prompt does not prove a better artifact; model-judge scores are supporting observations; failures remain in denominators; no correction counts as success without a detection mechanism.

## 5. Baseline plan

The baseline must be completed before the demo readiness date, proposed as 2026-09-17.

1. Select five held-out manga briefs that are not used in prompt examples, fixtures, or Director-development tests.
2. Mechanically fingerprint the held-out brief set and the prompt-example set; fail the check on any overlap.
3. Have one independent creator or roleplayed creator complete each brief using a prompt-only/manual workflow. Time to a reviewable four-panel page, number of re-prompts, and visible character/style failures are recorded.
4. Run the same five briefs through the real OpenCinema path after the baseline is frozen.
5. Keep every started attempt, including failures, in the denominator.

No delta claim is allowed if this baseline is not completed before the demo.

## 6. Evaluation integrity contract

- The prompt author does not author or select the held-out cases.
- The held-out cases are disjoint from prompt examples and development fixtures, verified by a committed fingerprint check.
- The critic receives the target and artifact, not hidden memory, prior prompts, or provenance.
- Evaluation dimensions are preregistered: character consistency, style consistency, continuity, story clarity, composition, emotional intent, panel flow, and visual artifacts.
- Identification, extraction, DKG readback, and generation failures count as expected-output failures.
- All percentages carry `n` and denominator; confidence intervals are included when sample size makes them meaningful.
- “Uncorrected means correct” is not an acceptable headline.
- A higher LLM score is not presented as causal proof. The primary Track 2 evidence is the named knowledge asset retrieved before Try 2 and the changed Director instruction.

## 7. Claim boundaries

At the research stage, the evidence supports only: the Track 2 requirement is understood; the reference loop is reproducible in mock mode; current Livepeer and DKG integration paths are identified; and a falsifiable real-mode test is defined.

After a real 5-case run, the evidence may support: “In 5 held-out cases, OpenCinema completed X real Livepeer-plus-DKG loops and retrieved named lessons that changed Y next instructions.”

It cannot support “CineGraph improves creative quality,” “reduces production time,” or “generalizes across creators” without a measured paired baseline, a larger sample, and an independently adjudicated evaluation.

## Ratification

Please ratify this frame or correct its decision-maker, scoreboard, baseline date, or headline measures. PRODUCT.md, ARCHITECTURE.md, and IMPLEMENTATION-PLAN.md remain intentionally unwritten until this frame is ratified.

