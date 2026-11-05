# edgeone-playwright-mcp

Remote browser MCP on **EdgeOne Makers**: Bearer-auth MCP Streamable HTTP endpoint (`POST /mcp`) — 10 first-class tools over `context.sandbox`, plus the **native Microsoft `@playwright/mcp` toolset (25 tools)** relayed from inside the sandbox. No extra server, no database.

**Live**: `https://edgeone-playwright-mcp-ov.edgeone.dev` (deployed under an EdgeOne account, overseas area)

| Achievement | Status |
|---|---|
| Level 2 — Browser MCP (auth + sessions + tools) | ✅ **verified live** (21/21 + 7/7 checks) |
| Level 3 — Full Playwright MCP (25 native tools) | ✅ via `playwright_native_call` relay (+1–3 s/hop) |

## Architecture

```
Agent (Codex / OpenCode / any MCP client)
   │  POST /mcp  ·  Authorization: Bearer <token>  ·  JSON-RPC 2.0
   ▼
Makers Agent runtime (agents/mcp.ts)
   ├─ Route B tools ────────────── context.sandbox.browser (managed Chromium)
   └─ playwright_native_call ───── commands.run curl tunnel
                                     └─ @playwright/mcp (sandbox-internal, :8931)
                                          └─ CDP 127.0.0.1:9222 → Chromium (Chrome 152)
```

Why the relay: external CDP WebSocket is rejected by the platform (401), and `getHost(port)` cannot
expose arbitrary sandbox ports (`310508`) — both verified. See `REPORT.md` for the decision record.

## Deploy

```bash
export PAGES_SOURCE=skills
cd ~/workspace/edgeone-playwright-mcp
edgeone makers deploy -n edgeone-playwright-mcp-ov -a overseas   # overseas → public edgeone.dev domain
edgeone makers env set MCP_BEARER_TOKEN "<crypto-random-token>"  # then redeploy once
```

> `global` area lands on `*.edgeone.cool`, which forces signed-URL access (`eo_time missing` 401 for plain clients) — use `-a overseas`.

## Use

```bash
curl -sS -X POST https://edgeone-playwright-mcp-ov.edgeone.dev/mcp \
  -H "Authorization: Bearer $TOKEN" -H "makers-conversation-id: my-session" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"browser_navigate","arguments":{"url":"https://example.com"}}}'
```

- Route B tools: `browser_navigate` `browser_screenshot` `browser_click` `browser_type` `browser_evaluate` `browser_get_content` `browser_close` `sandbox_info` `sandbox_run_command` `sandbox_extend_timeout`
- Full native set via `playwright_native_call` `{method, params}` — e.g. `tools/list`, then `tools/call` with `browser_snapshot`, `browser_tabs`, `browser_file_upload`, …

## Tests

```bash
node tests/mcp-client.mjs "$BASE" "$TOKEN" basic      # auth + protocol + capability matrix (21)
node tests/multi-agent.mjs "$BASE" "$TOKEN"           # concurrency + isolation (7)
node tests/mcp-client.mjs "$BASE" "$TOKEN" lifecycle  # idle 6/30/55 min, extendTimeout, close+recreate
```

Client configs (Codex / OpenCode / curl): `REPORT.md` §接入示例.

## Cleanup / operations

- Token rotation: `edgeone makers env set MCP_BEARER_TOKEN <new>` → redeploy.
- Project console: `https://console.tencentcloud.com/edgeone/pages/project/makers-ostgmsajojne`
- The in-sandbox @playwright/mcp process self-heals: relay checks health and restarts `npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222 --port 8931` when missing.
