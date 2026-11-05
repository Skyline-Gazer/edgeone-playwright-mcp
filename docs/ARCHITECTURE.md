# Architecture — EdgeOne Browser MCP

## Purpose and architectural decision

Provide a **private remote browser** to development agents that cannot or should
not launch Chromium locally. Retain the live-tested EdgeOne Makers Sandbox
backend instead of re-platforming it. This repository is not a general web proxy.

Architecture diagram:

    Codex / OpenCode / compatible MCP client
       │ POST /mcp + Authorization: Bearer <token>
       │ makers-conversation-id: a unique client session key
       ▼
    EdgeOne Makers Agent HTTP handler (agents/mcp.ts)
       │ auth / JSON-RPC dispatch
       ├── first-class browser tools → context.sandbox.browser → Chromium
       └── playwright_native_call
                │ sandbox.commands.run (local shell/curl relay)
                ▼
            @playwright/mcp inside Sandbox → local CDP → Chromium

The independent probe endpoint /probe is intended for authenticated diagnostics.
Do not expose CDP URLs, live URLs or sandbox tokens in ordinary responses.

## Current implementation — not desired-state promises

- HTTP: JSON replies on MCP POST; no server-pushed SSE stream. A new
  Mcp-Session-Id can be generated on incoming requests; this is not currently a
  durable or identity-bound server session.
- First-class tools: 11 current tools, including privileged shell/control tools.
  Browser operations include navigate, HTML, click, type, evaluate, screenshot.
- Native: Microsoft Playwright MCP is started in the sandbox and called through
  one generic relay tool. Its 25 tool names are **not** independently returned by
  the outer tools/list, and native image/error structures may be wrapped in text.
- Browser: conversation ID routes to a sticky, isolated Sandbox instance in the
  observed environment. IDs are supplied by clients; reusing an ID with the same
  Bearer grants access to the same trust domain.
- Duration: a continuous instance was observed usable for >=56 min; exact
  free-tier memory-hours, restart boundary, and future platform guarantees remain
  unverified. Sandbox-local /tmp and browser state are ephemeral.

## Boundaries

The landing page is static and deploy-neutral; it must never ask for or persist a
live token in the page. The API is Bearer protected on /mcp and /probe. In production
the authentication path must fail closed if MCP_BEARER_TOKEN is missing; the
current source has a baked development fallback that is tracked as a P0 issue.

Tool-level privilege must be explicit. Code execution in page context and
sandbox_run_command are **not** constrained by the URL check in browser_navigate.
Network egress and session ownership should not be represented as hardened before
they are independently proven.

Secrets include MCP_BEARER_TOKEN, sandboxToken, CDP capabilities, signed URLs,
AI gateway keys, cookies and screenshots of authenticated sites. The existing
evidence directory contains historical data requiring P0 cleanup.

## Engineering sequence

- P0 security and truthful evidence: ensure sensitive outputs cannot leak,
  decide default/privileged tool split, fail-closed auth and session identity.
- P1 contract and reliability: typed native relay, exact version pin, real MCP
  content/error semantics, session replacement and real Agent E2E.
- P2 developer experience: accessible static landing, deploy/test instructions,
  ADS Lite and reproducible clean checkout.
- P3 operational readiness: real free-quota consumption, smoke/rollback plan,
  separate dev → master release review.

GitHub Issues and Project hold task state, dependencies, start/end dates and
completion status. This document records durable architectural decisions only;
it is deliberately not a duplicate task tracker.

## Design constraints

- GitHub primary, topic-branch PRs to dev, separate master promotion.
- Keep functionality development-first; targeted functional checks and real
  review remain, but optional scanning and OS isolation are not automatic gates.
- Avoid custom orchestration, external DB, Docker, and additional approval roles
  unless a measured requirement justifies them.
- Do not deploy or rotate production secrets as an implicit consequence of
  writing docs or refactoring.
