# SECURITY — Bearer auth & isolation

All checks below were **executed live** against `https://edgeone-playwright-mcp-ov.edgeone.dev` (2026-11-05).

## Token handling

- Token generated with `crypto.randomBytes(32).base64url` (256-bit entropy).
- Source priority: `context.env.MCP_BEARER_TOKEN` (**verified live** — set via `edgeone makers env set`, value read from project env) > baked fallback in gitignored `agents/_auth.ts` (for anonymous deploys that cannot inject env).
- Constant-time compare (length check + XOR fold) in `checkAuth`.
- Token never logged (request log is `[mcp] METHOD path ms` only), never in URLs, never in screenshots.
- The preset-domain `?eo_token=` URL signing is a platform gate, separate from MCP auth; the
  overseas deployment (`edgeone.dev`) is publicly reachable, so **Bearer is the only auth layer** —
  verified by 401s below.

## Enforcement matrix (live results)

| Check | Result |
|---|---|
| POST /mcp without token | **401** PASS |
| POST /mcp wrong token (different length) | **401** PASS |
| Unauthenticated request latency | 1.1–2.0 s, fails **before** any sandbox acquire |
| POST /probe with conversation-id but no token | **401** PASS |
| Every tools/call passes `checkAuth` first | single choke point in `onRequestPost` PASS |
| Unauthorized tool call (wrong bearer, valid body) | rejected at 401 — no tool dispatch |

## Transport & cross-site

- Origin check: browser `Origin` must match request host → cross-site browser origins get 403
  (DNS-rebinding guard). Non-browser clients unaffected.
- GET /mcp → 405 (no SSE stream → no cross-origin event-stream surface).
- No cookies; all state rides the Authorization header.

## SSRF / private-network guard

`isPrivateTarget()` rejects non-http(s), `localhost`, `*.localhost`, `*.internal`, `*.local`,
loopback/0.x/10.x/127.x/169.254.x/172.16–31.x/192.168.x/CGNAT/multicast IPv4, `::1`, `fc/fd/fe80`
IPv6. **Verified live**: `browser_navigate http://127.0.0.1:8931/...` → blocked. **Known limitation:**
a public DNS name resolving to a private IP is not re-checked inside Chromium (verify/mmitigate via
platform egress policy if available).

## CDP / Live URL exposure

- `sandbox_info` reports cdpUrl **host only**; `/probe` returns full `cdpUrl` **only** to a valid
  Bearer AND body `{reveal:"cdp"}`. No unauthenticated CDP, Live URL, or sandbox port is exposed.
- The externally exposed CDP WebSocket rejects third-party clients (401) — no CDP attack surface.
- Platform `getHost(port)` cannot expose arbitrary ports (`310508` verified) — no client-exposed
  sandbox ports exist.

## Conversation ID isolation (verified live, 7/7 PASS)

- Different `makers-conversation-id` → **different sandbox instances** (distinct instanceIds).
- Agent A's cookie invisible to B; page titles differ; A's `browser_close` does not affect B;
  A can recreate and continue after close.
- **Known gap:** conversation IDs are client-supplied. Two holders of the SAME Bearer token can
  spoof each other's conversation id and land in the same sandbox. Accepted for a single-tenant
  private service; per-client identity would require deriving/encrypting IDs per token holder.
- Different Bearer holders are not a model here — the service is single-token by design.

## Token rotation

- Live path: `edgeone makers env set MCP_BEARER_TOKEN <new>` then redeploy (env var wins over baked
  fallback). Old-token rejection uses the same code path verified in the auth matrix.
