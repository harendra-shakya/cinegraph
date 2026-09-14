const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_MANGA_BRIEF,
    createChapter,
    createEmptyStoryBible,
    migrateProjectToV3,
    normalizeProjectV3,
    normalizePanel,
    normalizePlannedPages,
    normalizeStoryBible,
    buildStoryAnalysisPrompt,
    buildContinuityPrompt,
} = require('../server/services/story-first');

test('migrates a v2 manga project into a multi-chapter v3 series', () => {
    const migrated = migrateProjectToV3({
        schemaVersion: 2,
        id: 'old-project',
        name: 'Old Project',
        mode: 'manga',
        story: 'The courier finds a seed.',
        plannedPages: [{ pageNumber: 1, pageContent: 'A courier arrives.', panelCount: 2, generatedAsset: { bucket: 'pages', filename: 'page-001.jpg' } }],
    });

    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.series.storySource, 'The courier finds a seed.');
    assert.equal(migrated.mangaBrief.text, DEFAULT_MANGA_BRIEF);
    assert.equal(migrated.chapters.length, 1);
    assert.equal(migrated.chapters[0].pages[0].panels.length, 2);
    assert.deepEqual(migrated.chapters[0].pages[0].generatedAsset, { bucket: 'pages', filename: 'page-001.jpg' });
});

test('normalizes story bible entities and preserves versioned continuity fields', () => {
    const bible = normalizeStoryBible({
        version: 4,
        logline: 'A knight protects a city.',
        characters: [{ id: 'knight', name: 'Knight', appearance: 'Silver armor' }],
        continuityRules: ['The sword stays in the right hand.'],
    });

    assert.equal(bible.version, 4);
    assert.equal(bible.characters[0].id, 'knight');
    assert.equal(bible.characters[0].wardrobe, '');
    assert.deepEqual(bible.continuityRules, ['The sword stays in the right hand.']);
    assert.deepEqual(createEmptyStoryBible().locations, []);
});

test('builds a continuity-aware clean-art prompt with story and panel context', () => {
    const prompt = buildContinuityPrompt({
        mangaBrief: 'Use right-to-left manga composition.',
        storyBible: {
            logline: 'A knight guards the gate.',
            visualRules: ['High-contrast ink and screentone.'],
            continuityRules: ['The knight wears silver armor.'],
            characters: [
                { id: 'knight', name: 'Knight', appearance: 'Silver armor', emotionalState: 'alert' },
                { id: 'child', name: 'Child', appearance: 'Not yet visible' },
            ],
        },
        chapter: { title: 'The Gate', storySource: 'The knight hears an alarm.' },
        page: { pageNumber: 1, storyBeat: 'The alarm begins.', sceneGoal: 'Establish danger.' },
        previousPanel: { action: 'The knight turns toward the city.' },
        references: [{ name: 'knight-front.png', bucket: 'characters' }],
        panel: { shotType: 'close-up', composition: 'The knight grips the sword.', action: 'Raises the sword.', emotion: 'determined', characters: ['knight'], dialogue: [{ speaker: 'Knight', text: 'Stand back.' }] },
        userInstruction: 'Make the rain dramatic.',
    });

    assert.match(prompt, /Use right-to-left manga composition/);
    assert.match(prompt, /The knight wears silver armor/);
    assert.doesNotMatch(prompt, /The knight hears an alarm/);
    assert.match(prompt, /Previous panel state/);
    assert.match(prompt, /knight-front\.png/);
    assert.match(prompt, /Do not draw dialogue lettering/);
    assert.doesNotMatch(prompt, /Stand back\./);
    assert.match(prompt, /LETTERING IS EXTERNAL/);
    assert.match(prompt, /FORBIDDEN IN THIS PANEL.*Child/);
    assert.match(prompt, /CHARACTER IDENTITY LOCK.*same face, hairstyle/);
    assert.match(prompt, /Make the rain dramatic/);
});

test('creates chapters with stable ids and draft statuses', () => {
    const chapter = createChapter({ number: 2, title: 'The Return', storySource: 'The hero returns.' });
    assert.equal(chapter.number, 2);
    assert.equal(chapter.title, 'The Return');
    assert.equal(chapter.status, 'draft');
    assert.match(chapter.id, /^chapter-/);
    assert.deepEqual(chapter.pages, []);
});

test('normalizes a v3 project with a default chapter and series fields', () => {
    const project = normalizeProjectV3({ id: 'series', name: 'Series' });
    assert.equal(project.schemaVersion, 3);
    assert.equal(project.series.readingDirection, 'rtl');
    assert.equal(project.chapters.length, 1);
    assert.equal(project.chapters[0].number, 1);
    assert.equal(project.mangaBrief.presetId, 'japanese-manga');
});

test('normalizes planner pages into ordered manga panels with approval gates', () => {
    const pages = normalizePlannedPages([{ pageNumber: 1, storyBeat: 'Alarm', panelCount: 2, panels: [{ composition: 'Wide gate' }, { composition: 'Close-up bell' }] }]);
    assert.equal(pages[0].approval, 'draft');
    assert.equal(pages[0].panels[0].order, 1);
    assert.equal(pages[0].panels[1].shotType, 'medium');
    assert.equal(pages[0].panels[1].approval, 'draft');
});

test('canonicalizes planner entity references against the approved story bible', () => {
    const pages = normalizePlannedPages([{
        pageNumber: 1,
        panelCount: 1,
        panels: [{ characters: ['Aiko', 'Invented Stranger'], location: 'The Ruined Gate', props: ['Lantern', 'Unknown Device'] }],
    }], {
        storyBible: {
            characters: [{ id: 'CHR-001', name: 'Aiko' }],
            locations: [{ id: 'LOC-001', name: 'The Ruined Gate' }],
            props: [{ id: 'PRP-001', name: 'Lantern' }],
        },
    });
    assert.deepEqual(pages[0].panels[0].characters, ['CHR-001']);
    assert.equal(pages[0].panels[0].location, 'LOC-001');
    assert.deepEqual(pages[0].panels[0].props, ['PRP-001']);
});

test('marks provider-rendered panels as pending human quality review', () => {
    const panel = normalizePanel({ renderStatus: 'succeeded', generatedAsset: { filename: 'panel.jpg' } });
    assert.equal(panel.qualityReview, 'pending');
});

test('builds a structured story-analysis prompt', () => {
    const prompt = buildStoryAnalysisPrompt({ storySource: 'A courier protects a seed.', mangaBrief: 'Keep the art monochrome.' });
    assert.match(prompt, /story bible/);
    assert.match(prompt, /characters/);
    assert.match(prompt, /continuityRules/);
    assert.match(prompt, /Keep the art monochrome/);
    assert.match(prompt, /preserve names exactly as written/i);
});
