const crypto = require('crypto');

const DEFAULT_MANGA_BRIEF = `Create readable Japanese-style manga with right-to-left reading order. Treat each panel as one clear story beat with deliberate shot choice, staging, movement, expression, and visual transition. Preserve character identity, wardrobe, props, location, time, injuries, transformations, and emotional state from the approved continuity. Use consistent ink, screentone, contrast, perspective, and line weight. Leave clean negative space for lettering. Do not invent characters, props, locations, plot events, or dialogue. Generate clean panel art without dialogue lettering; visual sound effects are included only when explicitly marked.`;

const idFor = (prefix, seed = '') => `${prefix}-${crypto.createHash('sha1').update(`${prefix}:${seed}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 12)}`;

const asArray = (value) => (Array.isArray(value) ? value : []);
const asString = (value) => (typeof value === 'string' ? value : '');
const planHash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

const normalizeEntity = (entity = {}) => ({
    id: asString(entity.id) || idFor('entity', entity.name),
    name: asString(entity.name),
    role: asString(entity.role),
    appearance: asString(entity.appearance),
    wardrobe: asString(entity.wardrobe),
    personality: asString(entity.personality),
    emotionalState: asString(entity.emotionalState),
    relationships: asArray(entity.relationships),
    props: asArray(entity.props),
    notes: asString(entity.notes),
    referenceAsset: entity.referenceAsset || null,
});

const normalizeStoryBible = (bible = {}) => ({
    version: Number.isInteger(bible.version) ? bible.version : 1,
    logline: asString(bible.logline),
    themes: asArray(bible.themes),
    characters: asArray(bible.characters).map(normalizeEntity),
    locations: asArray(bible.locations).map(normalizeEntity),
    props: asArray(bible.props).map(normalizeEntity),
    visualRules: asArray(bible.visualRules),
    timeline: asArray(bible.timeline),
    requiredBeats: asArray(bible.requiredBeats),
    unresolvedThreads: asArray(bible.unresolvedThreads),
    continuityRules: asArray(bible.continuityRules),
});

const createEmptyStoryBible = () => normalizeStoryBible({ version: 0 });

const normalizeLettering = (entry = {}) => ({
    id: asString(entry.id) || idFor('lettering', entry.text),
    type: ['dialogue', 'caption', 'sfx'].includes(entry.type) ? entry.type : 'dialogue',
    text: asString(entry.text),
    speaker: asString(entry.speaker),
    readingOrder: Number.isInteger(entry.readingOrder) ? entry.readingOrder : 0,
    balloonStyle: asString(entry.balloonStyle) || 'standard',
    x: Number.isFinite(entry.x) ? entry.x : 0.08,
    y: Number.isFinite(entry.y) ? entry.y : 0.08,
    width: Number.isFinite(entry.width) ? entry.width : 0.28,
    height: Number.isFinite(entry.height) ? entry.height : 0.16,
    tailTarget: entry.tailTarget || null,
    visualTreatment: asString(entry.visualTreatment),
    locked: entry.locked === true,
});

const canonicalizeReferences = (references, entities) => {
    const values = asArray(references);
    if (!entities.length) return values;
    return values.map((reference) => {
        const needle = String(reference || '').toLowerCase();
        const match = entities.find((entity) => {
            const id = String(entity.id || '').toLowerCase();
            const name = String(entity.name || '').toLowerCase();
            return needle === id || needle === name || needle.includes(name) || name.includes(needle);
        });
        return match?.id || null;
    }).filter(Boolean);
};

const canonicalizeLocation = (location, entities) => {
    if (!entities.length) return asString(location);
    const needle = asString(location).toLowerCase();
    return entities.find((entity) => {
        const id = String(entity.id || '').toLowerCase();
        const name = String(entity.name || '').toLowerCase();
        return needle === id || needle === name || needle.includes(name) || name.includes(needle);
    })?.id || '';
};

const normalizePanel = (panel = {}, index = 0, { storyBible } = {}) => {
    const bible = storyBible ? normalizeStoryBible(storyBible) : null;
    const characters = canonicalizeReferences(panel.characters, bible?.characters || []);
    const props = canonicalizeReferences(panel.props, bible?.props || []);
    const location = canonicalizeLocation(panel.location, bible?.locations || []);
    return {
    id: asString(panel.id) || idFor('panel', index),
    order: Number.isInteger(panel.order) ? panel.order : index + 1,
    transition: asString(panel.transition) || 'moment-to-moment',
    shotType: asString(panel.shotType) || 'medium',
    composition: asString(panel.composition),
    action: asString(panel.action),
    emotion: asString(panel.emotion),
    characters,
    location,
    props,
    time: asString(panel.time),
    movementDirection: asString(panel.movementDirection),
    dialogue: asArray(panel.dialogue).map((line, lineIndex) => normalizeLettering({ ...line, type: 'dialogue', readingOrder: line.readingOrder ?? lineIndex })),
    soundEffects: asArray(panel.soundEffects || panel.sfx).map((line, lineIndex) => normalizeLettering({ ...line, type: 'sfx', readingOrder: line.readingOrder ?? lineIndex })),
    lettering: asArray(panel.lettering).map((line, lineIndex) => normalizeLettering({ ...line, readingOrder: line.readingOrder ?? lineIndex })),
    continuityState: panel.continuityState && typeof panel.continuityState === 'object' ? panel.continuityState : {},
    letteringSafeRegions: asArray(panel.letteringSafeRegions),
    approval: panel.approval === 'approved' ? 'approved' : 'draft',
    renderStatus: ['not-started', 'queued', 'running', 'succeeded', 'failed'].includes(panel.renderStatus) ? panel.renderStatus : 'not-started',
    // Technical validation proves that an image can be decoded; it cannot prove
    // that the provider followed the panel plan. Keep that distinction visible.
    qualityReview: ['pending', 'accepted', 'rejected'].includes(panel.qualityReview)
        ? panel.qualityReview
        : (panel.generatedAsset || panel.renderStatus === 'succeeded' ? 'pending' : null),
    generatedAsset: panel.generatedAsset || null,
    generationId: asString(panel.generationId),
    renderError: panel.renderError && typeof panel.renderError === 'object' ? panel.renderError : null,
    revisions: asArray(panel.revisions),
    };
};

const normalizePage = (page = {}, index = 0, options = {}) => ({
    id: asString(page.id) || idFor('page', page.pageNumber || index + 1),
    pageNumber: Number.isInteger(page.pageNumber) ? page.pageNumber : index + 1,
    storyBeat: asString(page.storyBeat || page.pageContent),
    sceneGoal: asString(page.sceneGoal),
    transition: asString(page.transition),
    layout: page.layout || null,
    approval: page.approval === 'approved' ? 'approved' : 'draft',
    planRevision: asString(page.planRevision) || planHash({ storyBeat: page.storyBeat || page.pageContent, sceneGoal: page.sceneGoal, transition: page.transition, layout: page.layout, panels: page.panels }),
    approvedPlanRevision: asString(page.approvedPlanRevision),
    panelCount: Number.isInteger(page.panelCount) ? page.panelCount : asArray(page.panels).length,
    panels: asArray(page.panels).map((panel, panelIndex) => normalizePanel(panel, panelIndex, options)),
    generatedAsset: page.generatedAsset || null,
    generationSettings: page.generationSettings || {},
});

const normalizePlannedPages = (pages, options = {}) => asArray(pages).map((page, index) => {
    const count = Number.isInteger(page.panelCount) && page.panelCount > 0 ? page.panelCount : asArray(page.panels).length || 1;
    const panels = asArray(page.panels).length
        ? page.panels
        : Array.from({ length: count }, (_, panelIndex) => ({
            order: panelIndex + 1,
            composition: panelIndex === 0 ? asString(page.storyBeat || page.pageContent) : '',
        }));
    return normalizePage({ ...page, panels, panelCount: count }, index, options);
});

const createChapter = ({ number = 1, title = '', storySource = '' } = {}) => ({
    id: idFor('chapter', number),
    number,
    title: asString(title) || `Chapter ${number}`,
    storySource: asString(storySource),
    storyVersion: 1,
    storyBibleVersion: 1,
    status: 'draft',
    pages: [],
});

const normalizeChapter = (chapter = {}, index = 0) => ({
    ...createChapter({ number: Number.isInteger(chapter.number) ? chapter.number : index + 1 }),
    ...chapter,
    id: asString(chapter.id) || idFor('chapter', index),
    number: Number.isInteger(chapter.number) ? chapter.number : index + 1,
    title: asString(chapter.title) || `Chapter ${index + 1}`,
    storySource: asString(chapter.storySource),
    storyVersion: Number.isInteger(chapter.storyVersion) ? chapter.storyVersion : 1,
    storyBibleVersion: Number.isInteger(chapter.storyBibleVersion) ? chapter.storyBibleVersion : 1,
    status: ['draft', 'planned', 'approved', 'in-progress', 'complete'].includes(chapter.status) ? chapter.status : 'draft',
    pages: asArray(chapter.pages).map(normalizePage),
});

const normalizeMangaBrief = (brief = {}) => ({
    presetId: asString(brief.presetId) || 'japanese-manga',
    text: asString(brief.text) || DEFAULT_MANGA_BRIEF,
    version: Number.isInteger(brief.version) ? brief.version : 1,
});

const normalizeProjectV3 = (project = {}) => {
    const chapters = asArray(project.chapters).map(normalizeChapter);
    return {
        createdAt: asString(project.createdAt) || new Date().toISOString(),
        id: project.id,
        name: asString(project.name) || project.id,
        mode: project.mode === 'storybook' ? 'storybook' : 'manga',
        schemaVersion: 3,
        revision: Number.isInteger(project.revision) && project.revision >= 0 ? project.revision : 0,
        generationQueue: project.generationQueue || { items: [], state: 'idle', updatedAt: new Date().toISOString() },
        mangaBrief: normalizeMangaBrief(project.mangaBrief),
        series: {
            title: asString(project.series?.title) || asString(project.name),
            premise: asString(project.series?.premise),
            genre: asString(project.series?.genre),
            readingDirection: project.series?.readingDirection === 'ltr' ? 'ltr' : 'rtl',
            storySource: asString(project.series?.storySource || project.story),
            storyBible: project.series?.storyBible ? normalizeStoryBible(project.series.storyBible) : createEmptyStoryBible(),
        },
        chapters: chapters.length ? chapters : [createChapter({ number: 1, storySource: asString(project.series?.storySource || project.story) })],
        storybookBooklet: project.storybookBooklet || { covers: { front: {}, back: {} } },
    };
};

const migratePage = (page = {}, index = 0) => {
    const count = Number.isInteger(page.panelCount) && page.panelCount > 0 ? page.panelCount : 1;
    const panels = asArray(page.panels).length ? page.panels : Array.from({ length: count }, (_, panelIndex) => ({
        order: panelIndex + 1,
        composition: panelIndex === 0 ? page.pageContent || '' : '',
    }));
    return normalizePage({ ...page, panels }, index);
};

const migrateProjectToV3 = (project = {}) => {
    if (project.schemaVersion === 3) return normalizeProjectV3(project);
    if (project.schemaVersion !== 2) return normalizeProjectV3(project);
    const storySource = asString(project.story);
    const chapter = createChapter({ number: 1, title: 'Chapter 1', storySource });
    chapter.status = asArray(project.plannedPages).length ? 'planned' : 'draft';
    chapter.pages = asArray(project.plannedPages).map(migratePage);
    return normalizeProjectV3({
        ...project,
        mangaBrief: { presetId: 'japanese-manga', text: DEFAULT_MANGA_BRIEF, version: 1 },
        series: { title: project.name, storySource, storyBible: createEmptyStoryBible(), readingDirection: 'rtl' },
        chapters: [chapter],
    });
};

const stringify = (value) => JSON.stringify(value, null, 2);

const buildContinuityPrompt = ({ mangaBrief, storyBible, readingDirection = 'rtl', colorMode = 'bw', chapter, page, previousPanel, panel, references = [], userInstruction = '' }) => {
    const bible = normalizeStoryBible(storyBible);
    const normalizedPanel = normalizePanel(panel);
    const selectedCharacters = bible.characters.filter((entity) => normalizedPanel.characters.some((reference) => String(reference).toLowerCase() === entity.id.toLowerCase() || String(reference).toLowerCase().includes(entity.name.toLowerCase())));
    const selectedProps = bible.props.filter((entity) => normalizedPanel.props.some((reference) => String(reference).toLowerCase() === entity.id.toLowerCase() || String(reference).toLowerCase().includes(entity.name.toLowerCase())));
    const forbiddenEntities = [
        ...bible.characters.filter((entity) => !selectedCharacters.some((selected) => selected.id === entity.id)).map((entity) => entity.name),
        ...bible.props.filter((entity) => !selectedProps.some((selected) => selected.id === entity.id)).map((entity) => entity.name),
    ].filter(Boolean);
    const anchorLines = [
        ...selectedCharacters.map((entity) => `- ${entity.name}: ${entity.appearance || ''} | wardrobe: ${entity.wardrobe || ''} | props: ${(entity.props || []).join(', ')}`.slice(0, 280)),
        ...selectedProps.map((entity) => `- prop ${entity.name}: must be visibly drawn`.slice(0, 160)),
    ].filter(Boolean).slice(0, 8);
    const identityLock = selectedCharacters.length > 0
        ? `CHARACTER IDENTITY LOCK (MANDATORY): ${selectedCharacters.map((entity) => `${entity.name} must keep the exact same face, hairstyle, hair length, body proportions, armor/clothing silhouette, crest, and prop design across every panel. Do not redesign, age, recolor, or restyle this character for a different shot.`).join(' ')}\n`
        : '';
    const visualAnchor = `${anchorLines.length > 0 ? `VISUAL ANCHOR (highest priority, draw exactly):\n${anchorLines.join('\n')}\n` : ''}${identityLock}${forbiddenEntities.length > 0 ? `FORBIDDEN IN THIS PANEL (MUST NOT BE VISIBLE): ${forbiddenEntities.join(', ')}. These entities may exist elsewhere in the story bible, but they are not part of this panel's staging. Do not show them, even as background figures, silhouettes, reflections, or implied visible props.\n` : ''}`;
    // Keep script text out of the image-model payload. Dialogue is rendered later as
    // editable overlays; exposing it here encourages image providers to bake words
    // into the art even when the prompt says not to.
    const visualPanel = { ...normalizedPanel };
    delete visualPanel.dialogue;
    delete visualPanel.soundEffects;
    delete visualPanel.lettering;
    // The complete chapter remains persisted for story analysis and planning,
    // but raw prose (especially spoken words) must not be sent to the art model.
    // It can otherwise hallucinate speech bubbles in clean-art mode.
    chapter = chapter ? { ...chapter, storySource: '' } : chapter;
    return `${visualAnchor}STYLE: Japanese seinen manga, pure black-and-white ink, screentone shading, exactly ONE moon when night, no color, no text, no speech balloons.\n\nMANGA PRODUCTION BRIEF:\n${mangaBrief || DEFAULT_MANGA_BRIEF}\n\nSERIES STORY BIBLE:\n${stringify(bible)}\n\nREADING DIRECTION: ${readingDirection === 'ltr' ? 'left-to-right' : 'right-to-left'}\n\nCOLOR REQUIREMENT: ${colorMode === 'bw' ? 'BLACK AND WHITE ONLY. Use grayscale ink, screentone, and white paper; no hue or color accents.' : 'Full color.'}\n\nCONTINUITY LOCK (MANDATORY): Use the exact approved character identities, wardrobe, props, location, timeline, and emotional state. Characters marked off-screen or not yet visible must remain off-screen. Do not reveal unresolved characters or events early. Keep the same face, hair, body proportions, costume, and prop design from prior panels. If the story bible lists plate armor, draw plate armor. If it lists a handheld iron lantern, draw that lantern in hand. Never substitute a staff, spear, broom, or glow for the lantern. Keep one consistent moon, one consistent gate design, and one consistent character age across all panels.\n\nCURRENT PANEL ENTITY DETAILS (MUST VISIBLY MATCH):\n${stringify({ characters: selectedCharacters, props: selectedProps, location: normalizedPanel.location })}\n\nMANDATORY VISIBLE ELEMENTS: Every character and prop listed in CURRENT PANEL ENTITY DETAILS is required in this image when the composition permits it. Render each one as a recognizable, concrete visual element with the approved appearance and wardrobe. Never omit, replace, merge, or reinterpret a named prop (for example, a lantern must look like a handheld lantern, not a broom, staff, or abstract glow). If a listed character is off-screen or explicitly marked not yet visible, keep that character off-screen.\n\nCLEAN ART MODE (MANDATORY): This is an art-only panel. Do not draw dialogue lettering, speech balloons, captions, sound-effect lettering, symbols, signs, watermarks, logos, UI, or any written language. Leave lettering-safe regions as plain uninterrupted artwork; MangaGen will add editable overlays separately.\n\nRESOLVED REFERENCE ASSETS:\n${stringify(references)}\n\nCHAPTER CONTEXT:\n${stringify({ title: chapter?.title || '', storySource: chapter?.storySource || '' })}\n\nPAGE CONTEXT:\n${stringify({ pageNumber: page?.pageNumber, storyBeat: page?.storyBeat, sceneGoal: page?.sceneGoal })}\n\nPrevious panel state:\n${stringify(previousPanel || {})}\n\nCURRENT PANEL VISUAL DIRECTION (NO SCRIPT TEXT):\n${stringify(visualPanel)}\n\nLETTERING IS EXTERNAL: MangaGen will add dialogue, captions, and SFX as editable overlays after image generation. Do not render or imitate any words from the story or panel script.\n\nUSER PANEL INSTRUCTION:\n${userInstruction || 'None'}\n\nOUTPUT REQUIREMENTS:\nGenerate exactly one high-fidelity manga panel. Preserve continuity and the supplied staging. Use the requested reading direction and leave the listed lettering-safe regions empty. Do not add story content, characters, props, locations, dialogue, or visual SFX that are not in the approved panel plan. HARD NEGATIVE: absolutely no letters, words, numbers, symbols, signs, speech balloons, captions, or written marks anywhere in the image.`;
};

const buildStoryAnalysisPrompt = ({ storySource, mangaBrief }) => `Act as a manga story editor and continuity supervisor. Build a structured story bible from the complete story below using the production brief. Return ONLY valid JSON with exactly these keys: logline, themes, characters, locations, props, visualRules, timeline, requiredBeats, unresolvedThreads, continuityRules. Each character must include id, name, role, appearance, wardrobe, personality, emotionalState, relationships, props, and notes. Preserve names exactly as written in the story source; do not alter spelling, transliterate, or invent alternate names. Identify facts that must not change across panels, including identity, wardrobe, props, locations, timeline, injuries, transformations, relationships, and dialogue ownership.\n\nMANGA PRODUCTION BRIEF:\n${mangaBrief || DEFAULT_MANGA_BRIEF}\n\nSTORY SOURCE:\n${storySource || ''}`;

module.exports = {
    DEFAULT_MANGA_BRIEF,
    buildContinuityPrompt,
    createChapter,
    createEmptyStoryBible,
    migrateProjectToV3,
    normalizeChapter,
    normalizePanel,
    normalizePage,
    normalizePlannedPages,
    normalizeProjectV3,
    normalizeStoryBible,
    buildStoryAnalysisPrompt,
};
