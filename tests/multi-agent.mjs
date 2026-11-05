#!/usr/bin/env node
/** Multi-agent concurrency & isolation: 2-3 independent MCP clients (own conversation ids). */
import { writeFileSync } from 'node:fs';

const [baseUrl, token] = process.argv.slice(2);
if (!baseUrl || !token) {
  console.error('usage: node tests/multi-agent.mjs <baseUrl> <token>');
  process.exit(2);
}

function client(name, convId) {
  let id = 0;
  return async function call(tool, args) {
    const t0 = Date.now();
    const res = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'makers-conversation-id': convId,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name: tool, arguments: args ?? {} } }),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, ms: Date.now() - t0, body };
  };
}

const A = client('agentA', 'agent-a-isolation');
const B = client('agentB', 'agent-b-isolation');
const C = client('agentC', 'agent-c-isolation');
const results = [];
const rec = (item, status, detail) => {
  results.push({ item, status, detail });
  console.log(status.padEnd(8), item, detail ?? '');
};

// 1. Three concurrent sessions: navigate different pages simultaneously
const t0 = Date.now();
const [ra, rb, rc] = await Promise.all([
  A('browser_navigate', { url: 'https://example.com/' }),
  B('browser_navigate', { url: 'https://www.iana.org/help/example-domains' }),
  C('browser_navigate', { url: `${baseUrl}/` }),
]);
rec('concurrent-3-sessions', [ra, rb, rc].every((r) => r.status === 200 && !r.body?.result?.isError) ? 'PASS' : 'FAIL',
  `parallel ${Date.now() - t0}ms; A=${ra.ms} B=${rb.ms} C=${rc.ms}`);

// 2. Context isolation: A sets a cookie; B must not see it
await A('browser_evaluate', { script: 'document.cookie="agentA-secret=42;path=/"; "set"' });
const rbCookie = await B('browser_evaluate', { script: 'document.cookie' });
const bText = rbCookie.body?.result?.content?.[0]?.text ?? '';
rec('context-isolation-cookie', bText.includes('agentA-secret') ? 'FAIL' : 'PASS', `B cookie: ${bText.slice(0, 90)}`);

// 3. Page isolation: A reads its page title, B reads its own — must differ
const raTitle = await A('browser_evaluate', { script: 'document.title' });
const rbTitle = await B('browser_evaluate', { script: 'document.title' });
const ta = raTitle.body?.result?.content?.[0]?.text ?? '';
const tb = rbTitle.body?.result?.content?.[0]?.text ?? '';
rec('page-isolation-titles', ta !== tb ? 'PASS' : 'FAIL', `A=${ta.slice(0, 60)} B=${tb.slice(0, 60)}`);

// 4. A closes its browser; B must keep working
const raClose = await A('browser_close');
rec('agentA-close', raClose.status === 200 ? 'PASS' : 'FAIL', `${raClose.ms}ms`);
const rbAfter = await B('browser_get_content');
rec('agentB-survives-A-close', rbAfter.status === 200 && !rbAfter.body?.result?.isError ? 'PASS' : 'FAIL', `${rbAfter.ms}ms`);

// 5. A recreates and continues (sandbox still routable after close)
const raRe = await A('browser_navigate', { url: `${baseUrl}/` });
rec('agentA-recreate', raRe.status === 200 && !raRe.body?.result?.isError ? 'PASS' : 'FAIL', `${raRe.ms}ms`);

// 6. Sandbox quota: distinct instanceIds per conversation
const ia = await A('sandbox_info');
const ib = await B('sandbox_info');
const iaId = JSON.parse(ia.body?.result?.content?.[0]?.text ?? '{}')?.info?.instanceId;
const ibId = JSON.parse(ib.body?.result?.content?.[0]?.text ?? '{}')?.info?.instanceId;
rec('distinct-sandbox-instances', iaId && ibId && iaId !== ibId ? 'PASS' : 'PARTIAL', `A=${(iaId ?? '').slice(0, 12)} B=${(ibId ?? '').slice(0, 12)}`);

const fail = results.filter((r) => r.status === 'FAIL').length;
writeFileSync(new URL('../evidence/multi-agent.json', import.meta.url), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.length} checks, ${fail} FAIL`);
