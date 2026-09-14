# Livepeer Agent MangaGen Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route MangaGen panel and page image generation through Livepeer Agent’s streamable HTTP MCP endpoint when the Livepeer provider is selected.

**Architecture:** Add a small server-side MCP client that performs the initialize handshake and calls `create_media`, then adapt the existing provider router to expose Livepeer as an image provider. Keep credentials server-side, record the requested/served capability metadata, and preserve existing providers unchanged.

**Tech Stack:** Node.js, Express, MCP JSON-RPC over streamable HTTP, Node test runner.

**Spec:** `docs/research/LIVEPEER.md` and the official [Livepeer Agent Get Started guide](https://agent.livepeer.org/get-started.html)

## Global Constraints

- Use `https://agent.livepeer.org/api/mcp` as the default endpoint.
- Send `X-Livepeer Agent-Tool-Profile: lean` by default.
- Keep `LIVEPEER_AGENT_API_KEY` server-side and never expose it in public settings.
- Use runtime model/capability selection and preserve Livepeer response metadata.

---

### Task 1: MCP client contract

**Files:**
- Create: `code/mangagen/server/services/livepeer-agent.js`
- Test: `code/mangagen/tests/livepeer-agent.test.js`

- [ ] Write tests for MCP initialize/tool-call framing, auth headers, and image output extraction.
- [ ] Run the focused test and confirm it fails because the client does not exist.
- [ ] Implement the minimal client with injected `fetch`, endpoint, API key, and idempotency/session inputs.
- [ ] Run the focused test and confirm it passes.

### Task 2: Provider configuration and routing

**Files:**
- Modify: `code/mangagen/server/config.js`
- Modify: `code/mangagen/server/services/ai-settings-store.js`
- Modify: `code/mangagen/server/services/ai-service.js`
- Test: `code/mangagen/tests/server.test.js`

- [ ] Add Livepeer environment defaults and a redacted public provider entry.
- [ ] Add Livepeer image route support and return normalized image data plus runtime metadata.
- [ ] Add server coverage proving the key is not returned and the route can be selected.
- [ ] Run the server tests and confirm they pass.

### Task 3: UI route availability

**Files:**
- Modify: `code/mangagen/src/components/SettingsPanel.jsx`
- Modify: `code/mangagen/src/lib/api.mjs`
- Test: `code/mangagen/tests/client-utils.test.js`

- [ ] Add Livepeer to provider labels/capabilities and route configuration without exposing the key.
- [ ] Add a clear missing-key status message.
- [ ] Run client tests and the production build.

### Task 4: End-to-end verification

- [ ] Restart MangaGen with the user’s Livepeer environment variable.
- [ ] Verify settings show Livepeer enabled without displaying the secret.
- [ ] Generate one panel through Livepeer if quota/authorization allows.
- [ ] Run the full test suite and report any upstream quota or account limitation separately from code failures.
