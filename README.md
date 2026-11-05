# EdgeOne Browser MCP

A **self-hosted remote Chromium MCP endpoint** on EdgeOne Makers. Designed for
AI coding agents such as Codex and OpenCode that benefit from an external
browser. This is a private, experimental service, **not** a general public
browser proxy or unlimited free compute offering.

- **Live PoC:** https://edgeone-playwright-mcp-ov.edgeone.dev
- **Source:** https://github.com/Skyline-Gazer/edgeone-playwright-mcp
- **Landing:** index.html (static, no build step)
- **Engineering decisions:** docs/ARCHITECTURE.md
- **ADS:** pinned .ads submodule at v0.7.0 / 42ba05c6b6707690702689988c352d4d3a3cde6e
- **Tasks:** GitHub Issues; Project bootstrap at scripts/bootstrap-project.sh

## Capabilities and verified baseline

The outer Streamable HTTP MCP endpoint exposes 11 first-class tools, including
sandbox control and command execution. A sandbox-local Microsoft Playwright MCP
server exposes an additional set of approximately 25 native tool names through
a **single** generic playwright_native_call relay. They are not first-class
independent tools on the outer MCP surface.

The published baseline evidence for the 21-check matrix is **18 PASS,
2 UNKNOWN, 1 PARTIAL**, not 21 PASS. Three separate conversations and the
short-session isolation cases were exercised. An instance remained responsive
for >=56 minutes; exact Sandbox free usage must be measured in the console.

The full native tool list, current route differences and limitations are in
CAPABILITIES.md, LIMITS.md, REPORT.md and SECURITY.md. Some documents are
historical PoC evidence and may contain overbroad claims; security/evidence
correction is tracked as P0 work.

## Agent connection

Your deployment must have its own randomly generated MCP_BEARER_TOKEN. Send it
as a header, never as a query string. Use **a different makers-conversation-id**
for each independent Agent/session; the ID by itself is not a credential.

Codex (append to ~/.codex/config.toml):

```toml
[mcp_servers.edgeone_browser]
url = "https://YOUR-DEPLOYMENT/mcp"
http_headers = { "Authorization" = "Bearer <TOKEN>", "makers-conversation-id" = "codex-main" }
```

OpenCode (merge under mcp in ~/.config/opencode/opencode.json):

```json
{
  "edgeone_browser": {
    "type": "remote",
    "url": "https://YOUR-DEPLOYMENT/mcp",
    "headers": {
      "Authorization": "Bearer <TOKEN>",
      "makers-conversation-id": "opencode-main"
    },
    "enabled": true
  }
}
```

MCP clients must support JSON-RPC over HTTP POST and Bearer headers. The native
25-tool relay is invoked with playwright_native_call and explicit method/params.

## Local development

Requirements: Git, Node.js 20+, npm, and EdgeOne CLI for deployment only.

```bash
git clone --recurse-submodules https://github.com/Skyline-Gazer/edgeone-playwright-mcp.git
cd edgeone-playwright-mcp
git switch dev
git submodule update --init .ads
npm ci
npm test
```

To prepare a clean checkout of the *current* PoC, copy
agents/_auth.ts.example to agents/_auth.ts; the file is gitignored.
This does not grant deployment access. The project has a P0 task to remove
the insecure baked-token fallback and make production fail closed.

Do not run a deploy casually: it may change a live EdgeOne service. After
checking account permissions and provisioning MCP_BEARER_TOKEN as an
environment secret, the currently documented EdgeOne deployment command is:

```bash
edgeone makers deploy -n YOUR-PROJECT -a overseas
```

A live test requires an authorized endpoint and secret:

```bash
node tests/mcp-client.mjs "$BASE" "$TOKEN" basic
node tests/multi-agent.mjs "$BASE" "$TOKEN"
```

Do not commit unredacted results under evidence/. The present scripts write
raw diagnostic content; that is a known P0 issue.

## Engineering workflow

GitHub primary. Work on topic branches, open Issue-linked PRs to dev, and use
a separate reviewed PR to promote dev to master. No automatic deployment or
new required dev CI gates. See AGENTS.md for the ADS Lite working agreement.

For a GitHub Projects board with native sub-issues and Phase/Priority fields,
run scripts/bootstrap-project.sh with an authenticated gh CLI having project
scope. The board setup script does not deploy the application.

## Security and limits

- Bearer protects current MCP and probe endpoints, but today's privileged
  shell and unsafe browser operations require a trusted single-tenant Agent.
- Reusing a conversation ID with the same token can share browser state.
- A private-IP URL guard on browser_navigate does not limit shell execution,
  page JavaScript evaluation, DNS rebinding or alternate browser navigation.
- CDP WebSocket direct access failed in testing; native commands use a local
  relay, with latency overhead.
- Sandbox state is ephemeral; observed >=56 minutes is not a continuity SLA.
- Free-tier usage is **not** proven to cover 60–120 browser hours per month.
  Use actual allocated-memory GB-s and account counters before forecasting.
- Historic public evidence requires secret review; never treat it as sanitized
  simply because the top-level API token was removed.

See SECURITY.md and GitHub Issues #1–#14 for baseline remediation and scope.

## License and contribution

ADS v0.7.0 is separately licensed under MIT in the pinned .ads directory.
This repository's application license has not yet been selected; no license
grant is implied by the public visibility of this repository.
