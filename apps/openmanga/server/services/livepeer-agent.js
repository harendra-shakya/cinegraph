const { AppError } = require('../errors');

const DEFAULT_ENDPOINT = 'https://agent.livepeer.org/api/mcp';
const DEFAULT_PROFILE = 'lean';
const normalizeDirectEndpoint = (endpoint) => {
    const value = String(endpoint || DEFAULT_ENDPOINT).replace(/\/$/, '');
    // MangaGen calls direct capabilities (upload/run_capability), which
    // Livepeer exposes on the raw surface. Accept the older /api/mcp and
    // creative defaults from existing .env files, but route this adapter to
    // the compatible raw endpoint automatically.
    if (value.endsWith('/api/mcp') || value.endsWith('/api/mcp/creative')) return `${value.replace(/\/creative$/, '')}/raw`;
    return value;
};

const parseResponse = async (response) => {
    const text = await response.text();
    if (!text) return null;

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/event-stream')) {
        const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
        return dataLine ? JSON.parse(dataLine.slice(5).trim()) : null;
    }
    return JSON.parse(text);
};

const extractToolResult = (payload) => {
    const result = payload?.result || {};
    if (result.isError) {
        const text = result.content?.find((item) => item.type === 'text')?.text || 'Livepeer tool call failed';
        return { error: text, code: 'TOOL_ERROR', isError: true };
    }
    if (result.structuredContent) return result.structuredContent;

    const text = result.content?.find((item) => item.type === 'text')?.text;
    if (!text) return result;
    try {
        return JSON.parse(text);
    } catch {
        return { text };
    }
};

const extractImageUrl = (value) => {
    const candidates = [
        value?.output?.url,
        value?.output?.image_url,
        value?.output?.imageUrl,
        value?.result?.url,
        value?.result?.image_url,
        value?.result?.imageUrl,
        value?.result?.output?.url,
        value?.run_output?.url,
        value?.run_output?.image_url,
        value?.run_output?.imageUrl,
        value?.run_output?.output?.url,
        value?.url,
        value?.image_url,
        value?.imageUrl,
        ...(Array.isArray(value?.output) ? value.output : []),
    ];
    return candidates.find((candidate) => typeof candidate === 'string' && /^https?:\/\//.test(candidate)) || null;
};

const isTerminalMediaStatus = (value) => ['completed', 'complete', 'succeeded', 'failed', 'error', 'cancelled'].includes(String(value?.status || '').toLowerCase());
const isProviderError = (value) => Boolean(value && typeof value === 'object' && (value.error || value.isError || value.code === 'validation_failed'));

const inlineReferenceToUpload = (reference) => {
    const dataUrl = reference?.data;
    if (typeof dataUrl !== 'string' || !dataUrl.includes(';base64,')) return null;
    const [mime, data] = dataUrl.split(';base64,');
    if (!mime.startsWith('data:image/')) return null;
    return { data, mimeType: reference.mimeType || mime.slice('data:'.length) };
};

const createLivepeerAgent = ({
    apiKey = process.env.LIVEPEER_AGENT_API_KEY || '',
    endpoint = process.env.LIVEPEER_AGENT_URL || DEFAULT_ENDPOINT,
    fetchImpl = fetch,
    profile = process.env.LIVEPEER_AGENT_TOOL_PROFILE || DEFAULT_PROFILE,
} = {}) => {
    endpoint = normalizeDirectEndpoint(endpoint);
    let requestId = 0;
    let sessionId = null;
    let initialized = false;

    const request = async (method, params = {}) => {
        const headers = {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            ...(!endpoint.endsWith('/creative') ? { 'X-Livepeer-Agent-Tool-Profile': profile } : {}),
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        };
        const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
        });
        const responseSessionId = response.headers.get('mcp-session-id');
        if (responseSessionId) sessionId = responseSessionId;
        const payload = await parseResponse(response);
        if (!response.ok) {
            throw new AppError(response.status, payload?.error?.message || 'Livepeer Agent request failed');
        }
        if (payload?.error) {
            throw new AppError(502, payload.error.message || 'Livepeer Agent returned an error');
        }
        return payload;
    };

    const ensureInitialized = async () => {
        if (initialized) return;
        await request('initialize', {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: 'mangagen', version: '1.0.0' },
        });
        initialized = true;
    };

    const callTool = async (name, argumentsValue) => {
        await ensureInitialized();
        const payload = await request('tools/call', { name, arguments: argumentsValue });
        return extractToolResult(payload);
    };

    const createMedia = async ({ idempotencyKey, model, prompt, sessionId: attemptSessionId, references = [], continuityRequired = false }) => {
        if (!apiKey) {
            throw new AppError(400, 'Livepeer Agent API key not configured for image generation');
        }

        let value;
        const fallbackIdempotencyKey = `${idempotencyKey}-fallback`;
        let continuityFailure = null;

        // create_media is a text-first surface and does not receive inline
        // references. When continuity art is available, use the image-edit
        // capability first so the provider can actually see the approved
        // character/page reference. Keep create_media as a fallback for
        // providers that do not expose upload or kontext-edit.
        const inlineReference = inlineReferenceToUpload(references.at(-1));
        if (inlineReference) {
            try {
                const uploaded = await callTool('upload', {
                    data: inlineReference.data,
                    mime_type: inlineReference.mimeType,
                    filename: references.at(-1)?.name || 'previous-panel.jpg',
                });
                if (isProviderError(uploaded)) {
                    continuityFailure = `upload: ${uploaded.error || uploaded.code || 'provider error'}`;
                }
                const sourceUrl = uploaded?.url;
                if (typeof sourceUrl === 'string' && /^https?:\/\//.test(sourceUrl)) {
                    const continuityValue = await callTool('run_capability', {
                        capability: 'kontext-edit',
                        prompt: `${prompt}\n\nREFERENCE IMAGE INSTRUCTION: Preserve the recurring character identity, wardrobe, props, and line-art treatment from the supplied previous-panel reference. Change only the staging required by the current panel plan. Do not introduce lettering, balloons, or any written marks.`,
                        source_url: sourceUrl,
                        timeout: 46,
                        idempotency_key: idempotencyKey,
                        session_id: attemptSessionId,
                    });
                    if (isProviderError(continuityValue)) {
                        continuityFailure = `kontext-edit: ${continuityValue.error || continuityValue.code || 'provider error'}`;
                    }
                    value = isProviderError(continuityValue) ? null : continuityValue;
                }
            } catch (error) {
                continuityFailure = `continuity dispatch: ${error.message || 'provider error'}`;
                // Fall through to the normal generation surfaces when the
                // continuity-edit capability is unavailable or rejects a ref.
            }
        }
        if (continuityRequired && inlineReference && !value) {
            const detail = continuityFailure ? ` (${String(continuityFailure).slice(0, 260)})` : '';
            const error = new AppError(502, `Livepeer continuity edit failed; text-only fallback was blocked to protect character consistency${detail}`);
            error.code = 'LIVEPEER_CONTINUITY_FAILED';
            error.provider = 'livepeer';
            error.model = model || null;
            throw error;
        }
        try {
            if (!value) {
                const mediaValue = await callTool('create_media', {
                    action: 'generate',
                    idempotency_key: fallbackIdempotencyKey,
                    model_override: model || undefined,
                    prompt,
                    session_id: attemptSessionId,
                });
                value = isProviderError(mediaValue) ? null : mediaValue;
            }
        } catch (error) {
            // The current lean Livepeer Agent profile may omit create_media while
            // still exposing the same model through the generic capability tool.
            // Keep the preferred richer path, but do not fail every image request
            // when that surface is unavailable.
            const message = String(error?.message || '').toLowerCase();
            if (!message.includes('create_media') || (!message.includes('unknown') && !message.includes('not found') && !message.includes('tool'))) throw error;
            if (inlineReference) {
                try {
                    const uploaded = await callTool('upload', {
                        data: inlineReference.data,
                        mime_type: inlineReference.mimeType,
                        filename: references.at(-1)?.name || 'previous-panel.jpg',
                    });
                    const sourceUrl = uploaded?.url;
                    if (typeof sourceUrl === 'string' && /^https?:\/\//.test(sourceUrl)) {
                        const continuityValue = await callTool('run_capability', {
                            capability: 'kontext-edit',
                            prompt: `${prompt}\n\nREFERENCE IMAGE INSTRUCTION: Preserve the recurring character identity, wardrobe, props, and line-art treatment from the supplied previous-panel reference. Change only the staging required by the current panel plan.`,
                            source_url: sourceUrl,
                            timeout: 46,
                            idempotency_key: fallbackIdempotencyKey,
                            session_id: attemptSessionId,
                        });
                        value = isProviderError(continuityValue) ? null : continuityValue;
                    }
                } catch {
                    // A large or unsupported reference must not prevent a normal
                    // text-to-image retry; fall through to the requested model.
                }
            }
            if (!value) {
                const fallbackValue = await callTool('run_capability', {
                    capability: model,
                    prompt,
                    timeout: 90,
                    idempotency_key: fallbackIdempotencyKey,
                    session_id: attemptSessionId,
                });
                value = isProviderError(fallbackValue) ? null : fallbackValue;
            }
        }
        if (!value) {
            const fallbackValue = await callTool('run_capability', {
                capability: model,
                prompt,
                timeout: 90,
                idempotency_key: fallbackIdempotencyKey,
                session_id: attemptSessionId,
            });
            value = isProviderError(fallbackValue) ? null : fallbackValue;
        }
        // The raw surface may submit a slow edit even when the client asks for
        // a blocking call. Resolve that job before declaring the generation
        // unusable; otherwise a valid Livepeer render is lost as “no URL”.
        if (value?.job_id && !extractImageUrl(value)) {
            for (let attempt = 0; attempt < 12; attempt += 1) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
                const polled = await callTool('get_create_media', { job_id: value.job_id });
                value = polled;
                if (extractImageUrl(value) || isTerminalMediaStatus(value)) break;
            }
        }
        const imageUrl = extractImageUrl(value);
        if (!imageUrl) {
            const diagnostic = value && typeof value === 'object'
                ? JSON.stringify({
                    keys: Object.keys(value).slice(0, 12),
                    status: value.status || null,
                    jobId: value.job_id || null,
                    outputKind: value.output_kind || null,
                    errorCode: value.error_code || value.code || null,
                    error: typeof value.error === 'string'
                        ? value.error.slice(0, 300)
                        : value.error?.message || value.error?.detail || null,
                })
                : 'empty-response';
            throw new AppError(502, `Livepeer Agent did not return an image URL (${diagnostic})`);
        }
        return {
            imageUrl,
            capability: value.capability || value.capability_used || value.served_model_id || model || null,
            requestedCapability: value.requested_capability || model || null,
            modelNote: value.model_note || null,
            cost: value.cost || value.cost_usd || null,
        };
    };

    return { createMedia };
};

module.exports = { createLivepeerAgent };
