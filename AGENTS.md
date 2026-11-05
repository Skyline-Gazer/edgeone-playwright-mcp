# Agent working agreement — EdgeOne Browser MCP

This project adopts **ADS v0.7.0 Lite** via the immutable .ads submodule at commit
42ba05c6b6707690702689988c352d4d3a3cde6e. On first use, read this file,
.ads/STANDARD.md, .ads/SAFETY.md, and .ads/QUALITY.md. If the submodule is absent,
run git submodule update --init .ads; never track the latest ADS branch implicitly.
Do not use ADS as a reason to block ordinary feature coding on optional security
scans, sandbox isolation, CodeGraph, RTK, or strict lifecycle receipts.

## Project facts

- Purpose: A self-hosted remote Chromium tool endpoint on EdgeOne Makers Free
  using MCP Streamable HTTP with Bearer authorization.
- Source layout: agents/mcp.ts (HTTP transport), agents/_mcp-core.ts (tools/relay),
  agents/probe.ts (diagnostics), index.html (static landing), tests/ (functional
  checks), evidence/ (historical PoC; treat outputs as potentially sensitive).
- State: current production endpoint is an existing PoC. This repo is not a
  general-purpose proxy or public browser-as-a-service.
- Tests: npm test (local landing checks); node tests/mcp-client.mjs and
  node tests/multi-agent.mjs need a deliberately authorized live endpoint.
  Never send real secrets to PR logs or evidence.
- Git provider: GitHub primary. GitHub Issues/Project are the only task-status
  source. Stable branch is master; integrate work via an Issue-linked topic-branch
  PR to dev. Promotion dev → master is separate and must be reviewed.
- Deploy: merging source code does not by itself prove deployment. Running
  edgeone makers deploy changes the live service and needs explicit deployment
  authorization. No automatic deployment of task branches.

## What matters for changes

1. Preserve tested browsing paths while improving MCP contract, docs, and
   privilege boundaries. Do not treat a successful HTTP 200 as tool success.
2. Distinguish first-class Browser tools from the native Playwright relay.
   Keep Tool schema, MCP content types, and actual verified coverage truthful.
3. Handle bearer keys, sandbox tokens, CDP/live URLs, cookies, traces, screenshots,
   and command outputs as secrets until explicitly sanitized. Prefer redaction at
   source. Historical evidence under evidence/ is not inherently safe.
4. Browser navigation and JavaScript evaluation are not SSRF security controls.
   Privileged shell and unsafe code execution require an intentional scope.
5. Only claim a security/feature test PASS after performing the relevant check.
   Keep Process, State, and Outcome separate in PRs.
6. Do not add a CI gate, governance script, extra approver, paid dependency, DB,
   task runner, or service solely for process. Use the smallest necessary checks.

## Agent completion

Use the linked Issue as scope and acceptance, implement on a topic branch,
run relevant tests and open a PR into dev. Report exact commit, verified behavior,
unverified behavior, security/production impact, and next action. No unrequested
force push, token rotation, remote resource deletion, or production deployment.
