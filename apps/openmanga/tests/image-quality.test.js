const test = require('node:test');
const assert = require('node:assert/strict');
const { validateImageBuffer } = require('../server/services/image-quality');
const { createAiService } = require('../server/services/ai-service');

const inspect = (stats) => async () => ({ width: 1024, height: 768, stats });

test('accepts a decoded non-uniform image of usable dimensions', async () => {
    const result = await validateImageBuffer(Buffer.from('image'), {
        inspect: inspect({ channels: [{ mean: 120, stdev: 40, max: 255 }] }),
    });
    assert.equal(result.valid, true);
});

test('rejects a blank near-black image', async () => {
    const result = await validateImageBuffer(Buffer.from('image'), {
        inspect: inspect({ channels: [{ mean: 0, stdev: 0, max: 0 }] }),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'IMAGE_BLANK');
});

test('rejects colored output for black-and-white manga', async () => {
    const result = await validateImageBuffer(Buffer.from('image'), {
        inspect: inspect({ channels: [
            { mean: 90, stdev: 35, max: 255 },
            { mean: 130, stdev: 35, max: 255 },
            { mean: 110, stdev: 35, max: 255 },
        ] }),
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'IMAGE_COLOR');
});

test('rejects corrupt or too-small images', async () => {
    const result = await validateImageBuffer(Buffer.from('image'), {
        inspect: async () => { throw new Error('decode failed'); },
    });
    assert.equal(result.valid, false);
    assert.equal(result.code, 'IMAGE_INVALID');
});

test('retries a blank Livepeer image with a new idempotency key', async () => {
    const svg = (fill) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="${fill}"/></svg>`).toString('base64');
    const keys = [];
    const livepeerAgent = {
        createMedia: async ({ idempotencyKey }) => {
            keys.push(idempotencyKey);
            return { imageUrl: `data:image/svg+xml;base64,${svg(keys.length === 1 ? '#000' : '#fff')}`, capability: 'image', requestedCapability: 'image' };
        },
    };
    const aiService = createAiService({
        livepeerAgent,
        aiSettingsStore: { getEffectiveSettings: async () => ({
            routes: { panelImage: { provider: 'livepeer', model: 'flux-schnell' } },
            providers: { livepeer: { enabled: true, apiKey: 'test', baseUrl: 'http://unused', capabilities: { imageOutput: true } } },
        }) },
    });

    const result = await aiService.generatePanel({ panel: { composition: 'A knight stands in the rain' } });
    assert.equal(result.result.type, 'image');
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1]);
});
