const test = require('node:test');
const assert = require('node:assert/strict');
const { createLivepeerAgent } = require('../server/services/livepeer-agent');

test('calls Livepeer Agent create_media over MCP and extracts an image result', async () => {
    const requests = [];
    const fetchImpl = async (url, options) => {
        requests.push({ url, options });
        const body = JSON.parse(options.body);
        if (body.method === 'initialize') {
            return new Response(JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: { protocolVersion: '2025-03-26', capabilities: {} },
            }), { headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' } });
        }

        assert.equal(body.method, 'tools/call');
        assert.equal(body.params.name, 'create_media');
        assert.equal(body.params.arguments.model_override, 'flux-schnell');
        return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
                structuredContent: {
                    output: { url: 'https://cdn.example/panel.png' },
                    capability: 'flux-schnell',
                },
            },
        }), { headers: { 'content-type': 'application/json' } });
    };

    const agent = createLivepeerAgent({
        apiKey: 'sk-test',
        endpoint: 'https://agent.example/api/mcp',
        fetchImpl,
    });
    const result = await agent.createMedia({
        idempotencyKey: 'attempt-1-panel-1',
        model: 'flux-schnell',
        prompt: 'A lone swordsman in a storm',
        sessionId: 'attempt-1',
    });

    assert.deepEqual(result, {
        capability: 'flux-schnell',
        cost: null,
        imageUrl: 'https://cdn.example/panel.png',
        modelNote: null,
        requestedCapability: 'flux-schnell',
    });
    assert.equal(requests[0].options.headers.Authorization, 'Bearer sk-test');
    assert.equal(requests[0].options.headers['X-Livepeer-Agent-Tool-Profile'], 'lean');
    assert.equal(requests[1].options.headers['Mcp-Session-Id'], 'session-1');
});

test('falls back to run_capability when create_media is unavailable', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        if (body.method === 'initialize') {
            return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), {
                headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-fallback' },
            });
        }
        if (body.params.name === 'create_media') {
            return new Response(JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                error: { code: -32601, message: 'Unknown tool: create_media' },
            }), { headers: { 'content-type': 'application/json' } });
        }
        assert.equal(body.params.name, 'run_capability');
        assert.equal(body.params.arguments.capability, 'flux-schnell');
        assert.equal(body.params.arguments.timeout, 90);
        return new Response(JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: { structuredContent: { ok: true, url: 'https://cdn.example/fallback.jpg', capability_used: 'flux-schnell' } },
        }), { headers: { 'content-type': 'application/json' } });
    };

    const agent = createLivepeerAgent({ apiKey: 'sk-test', endpoint: 'https://agent.example/api/mcp', fetchImpl });
    const result = await agent.createMedia({ idempotencyKey: 'fallback-panel-1', model: 'flux-schnell', prompt: 'A monochrome manga gate' });

    assert.equal(result.imageUrl, 'https://cdn.example/fallback.jpg');
    assert.equal(result.capability, 'flux-schnell');
    assert.deepEqual(calls.map((call) => call.params?.name).filter(Boolean), ['create_media', 'run_capability']);
});

test('uses a hosted previous-panel reference before text generation for continuity', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'mcp-session-id': 'session-image' } });
        if (body.params.name === 'upload') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { url: 'https://cdn.example/previous.jpg' } } }));
        assert.equal(body.params.name, 'run_capability');
        assert.equal(body.params.arguments.capability, 'kontext-edit');
        assert.equal(body.params.arguments.source_url, 'https://cdn.example/previous.jpg');
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { ok: true, url: 'https://cdn.example/continuity.jpg', capability_used: 'kontext-edit' } } }));
    };

    const agent = createLivepeerAgent({ apiKey: 'sk-test', endpoint: 'https://agent.example/api/mcp', fetchImpl });
    const result = await agent.createMedia({
        idempotencyKey: 'continuity-panel-2',
        model: 'flux-schnell',
        prompt: 'A close-up reaction in monochrome manga',
        references: [{ name: 'panel-1.jpg', mimeType: 'image/jpeg', data: `data:image/jpeg;base64,${Buffer.from('panel').toString('base64')}` }],
    });

    assert.equal(result.imageUrl, 'https://cdn.example/continuity.jpg');
    assert.equal(result.capability, 'kontext-edit');
    assert.deepEqual(calls.map((call) => call.params?.name).filter(Boolean), ['upload', 'run_capability']);
});

test('normalizes nested image results and polls submitted media jobs', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'mcp-session-id': 'session-poll' } });
        if (body.params.name === 'create_media') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { status: 'submitted', job_id: 'mjob-1' } } }));
        if (body.params.name === 'get_create_media') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { status: 'completed', result: { url: 'https://cdn.example/polled.png' } } } }));
        throw new Error(`Unexpected tool ${body.params.name}`);
    };
    const agent = createLivepeerAgent({ apiKey: 'sk-test', endpoint: 'https://agent.example/api/mcp', fetchImpl });
    const result = await agent.createMedia({ idempotencyKey: 'poll-panel-1', model: 'flux-schnell', prompt: 'A clean manga panel' });
    assert.equal(result.imageUrl, 'https://cdn.example/polled.png');
    assert.deepEqual(calls.map((call) => call.params?.name).filter(Boolean), ['create_media', 'get_create_media']);
});

test('normalizes the raw run_capability run_output URL', async () => {
    const fetchImpl = async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'mcp-session-id': 'session-run' } });
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { capability_used: 'kontext-edit', run_output: { url: 'https://cdn.example/run-output.png' } } } }));
    };
    const agent = createLivepeerAgent({ apiKey: 'sk-test', endpoint: 'https://agent.example/api/mcp', fetchImpl });
    const result = await agent.createMedia({ idempotencyKey: 'run-output-panel', model: 'flux-schnell', prompt: 'A clean manga panel' });
    assert.equal(result.imageUrl, 'https://cdn.example/run-output.png');
    assert.equal(result.capability, 'kontext-edit');
});

test('falls back when a reference capability returns a structured validation error', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'mcp-session-id': 'session-error' } });
        if (body.params.name === 'upload') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { url: 'https://cdn.example/ref.jpg' } } }));
        if (body.params.name === 'run_capability') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { error: 'Input validation error', code: 'validation_failed' } } }));
        if (body.params.name === 'create_media') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { output: { url: 'https://cdn.example/fallback.png' }, capability: 'flux-schnell' } } }));
        throw new Error(`Unexpected tool ${body.params.name}`);
    };
    const agent = createLivepeerAgent({ apiKey: 'sk-test', endpoint: 'https://agent.example/api/mcp', fetchImpl });
    const result = await agent.createMedia({
        idempotencyKey: 'structured-error-panel',
        model: 'flux-schnell',
        prompt: 'A clean manga panel',
        references: [{ name: 'panel-2.jpg', mimeType: 'image/jpeg', data: `data:image/jpeg;base64,${Buffer.from('panel').toString('base64')}` }],
    });
    assert.equal(result.imageUrl, 'https://cdn.example/fallback.png');
    assert.deepEqual(calls.map((call) => call.params?.name).filter(Boolean), ['upload', 'run_capability', 'create_media']);
});

test('treats an MCP isError result as a failed reference attempt', async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        const body = JSON.parse(options.body);
        calls.push(body);
        if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'mcp-session-id': 'session-iserror' } });
        if (body.params.name === 'upload') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { url: 'https://cdn.example/ref.jpg' } } }));
        if (body.params.name === 'run_capability') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: 'Input validation error' }] } }));
        if (body.params.name === 'create_media') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { output: { url: 'https://cdn.example/fallback-iserror.png' }, capability: 'flux-schnell' } } }));
        throw new Error(`Unexpected tool ${body.params.name}`);
    };
    const agent = createLivepeerAgent({ apiKey: 'sk-test', endpoint: 'https://agent.example/api/mcp', fetchImpl });
    const result = await agent.createMedia({
        idempotencyKey: 'iserror-panel',
        model: 'flux-schnell',
        prompt: 'A clean manga panel',
        references: [{ name: 'panel-2.jpg', mimeType: 'image/jpeg', data: `data:image/jpeg;base64,${Buffer.from('panel').toString('base64')}` }],
    });
    assert.equal(result.imageUrl, 'https://cdn.example/fallback-iserror.png');
    assert.deepEqual(calls.map((call) => call.params?.name).filter(Boolean), ['upload', 'run_capability', 'create_media']);
});

test('blocks text-only fallback when continuity is required', async () => {
    const fetchImpl = async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'mcp-session-id': 'session-required' } });
        if (body.params.name === 'upload') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { url: 'https://cdn.example/ref.jpg' } } }));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { structuredContent: { error: 'Input validation error', code: 'validation_failed' } } }));
    };
    const agent = createLivepeerAgent({ apiKey: 'sk-test', endpoint: 'https://agent.example/api/mcp', fetchImpl });
    await assert.rejects(
        agent.createMedia({
            idempotencyKey: 'required-continuity-panel',
            model: 'flux-schnell',
            prompt: 'A consistent manga panel',
            continuityRequired: true,
            references: [{ name: 'panel-2.jpg', mimeType: 'image/jpeg', data: `data:image/jpeg;base64,${Buffer.from('panel').toString('base64')}` }],
        }),
        (error) => error.code === 'LIVEPEER_CONTINUITY_FAILED',
    );
});
