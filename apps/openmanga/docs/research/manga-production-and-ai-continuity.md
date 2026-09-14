# Manga production and AI continuity decisions

## Research basis

- [J-STAGE: How to create “Name”](https://www.jstage.jst.go.jp/article/jsgs/45/4/45_11/_article/-char/en) describes establishing story, character, and setting material before rough page construction.
- [Clip Studio: Creating a manga page](https://tips.clip-studio.com/en-us/articles/3520) treats page flow, movement, speech balloons, sound effects, and screentones as distinct compositional decisions.
- [MediBang: Frames and speech bubbles](https://medibangpaint.com/en/use/2021/11/mangatutorialforbeginners08/) documents right-to-left manga reading order, gutters, and emphasis panels.
- [Clip Studio: Speech balloon placement](https://tips.clip-studio.com/en-us/articles/4811) emphasizes readable speech order and balloon tails that identify the speaker.
- [MangaFlow](https://arxiv.org/abs/2605.28173) decomposes generation into planning, grounding, layout, panel rendering, composition, and lettering, with reusable story-section memory.
- [Make-A-Storyboard](https://arxiv.org/abs/2312.07549) supports scene-by-scene story visualization with visual consistency rather than one-shot page synthesis.

## Product decisions

MangaGen treats a project as a multi-chapter series. The complete story is analyzed into a versioned story bible before page planning. Planning produces reviewable page and panel thumbnails, including shot type, transition, movement, continuity state, dialogue ownership, and lettering-safe regions. Art generation is gated on approval by default.

The editable Japanese-manga production brief is included in analysis, planning, generation, and regeneration prompts. It requires RTL order, stable character/location/prop identity, deliberate negative space, consistent ink and screentone treatment, and clean art without generated dialogue. Dialogue, captions, and ordinary SFX are persisted as editable overlay layers; visual SFX are opt-in.

Every panel stores its asset, revision history, provider/model, prompt and brief versions, story-bible version, references, and timestamp. Provider output is validated before persistence. Invalid, corrupt, undersized, uniform, or near-black images are retried once and then surfaced as a structured failure.

## Schema mapping

Schema v3 keeps the old `story` and `plannedPages` compatibility fields while making `series`, `chapters`, `pages`, and `panels` canonical. This allows existing v2 projects and their asset references to migrate without deleting data, while storybook projects retain their existing generation path.
