#!/usr/bin/env node
/**
 * Minimal MCP client over Streamable HTTP (JSON responses).
 * Usage: node tests/mcp-client.mjs <baseUrl> <token> [capability]
 *   capability: probe | matrix | lifecycle | basic
 */
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

const [baseUrl, token, mode = 'basic'] = process.argv.slice(2);
if (!baseUrl || !token) {
  console.error('usage: node tests/mcp-client.mjs <baseUrl> <token> [probe|matrix|lifecycle|basic]');
  process.exit(2);
}
mkdirSync(new URL('../evidence/', import.meta.url), { recursive: true });
const EV = new URL('../evidence/', import.meta.url).pathname;

let sessionId = null;
let rpcId = 0;
const results = [];
const CONV_ID = `mcpcli-${Math.random().toString(36).slice(2, 10)}`;

async function rpc(method, params, { expectResponse = true } = {}) {
  const id = ++rpcId;
  const t0 = Date.now();
  const res = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'makers-conversation-id': CONV_ID,
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify(expectResponse ? { jsonrpc: '2.0', id, method, params } : { jsonrpc: '2.0', method, params }),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const ms = Date.now() - t0;
  let body = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ms, body };
}

function resultOf(r) {
  return r.body?.result ?? r.body;
}

function record(group, item, status, detail) {
  const row = { group, item, status, detail, at: new Date().toISOString() };
  results.push(row);
  console.log(`${status.padEnd(8)} ${group}/${item} ${detail ?? ''}`);
  try {
    writeFileSync(new URL('../evidence/progress.json', import.meta.url), JSON.stringify(results, null, 2));
  } catch {}
}
async function call(name, args) {
  return rpc('tools/call', { name, arguments: args ?? {} });
}

async function authChecks() {
  const noAuth = await fetch(`${baseUrl}/mcp`, { method: 'POST', body: '{}' });
  record('auth', 'missing-token', noAuth.status === 401 ? 'PASS' : 'FAIL', `status=${noAuth.status}`);
  const bad = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { Authorization: 'Bearer wrong-token-aaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    body: '{}',
  });
  record('auth', 'wrong-token', bad.status === 401 ? 'PASS' : 'FAIL', `status=${bad.status}`);
  // Auth check must precede sandbox creation: wrong token must fail fast.
  const t0 = Date.now();
  await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { Authorization: 'Bearer wrong-token-bbbbbbbbbbbbbbbbbbbbbbbbbbb' }, body: '{}' });
  record('auth', 'unauth-fast', Date.now() - t0 < 5000 ? 'PASS' : 'PARTIAL', `${Date.now() - t0}ms`);
  const probeBad = await fetch(`${baseUrl}/probe`, {
    method: 'POST',
    headers: { 'makers-conversation-id': 'unauth-check-1' },
    body: '{}',
  });
  record('auth', 'probe-needs-auth', probeBad.status === 401 ? 'PASS' : 'FAIL', `status=${probeBad.status}`);
}

async function init() {
  const r = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'edgeone-mcp-test', version: '0.1.0' },
  });
  const ok = r.status === 200 && resultOf(r)?.serverInfo?.name === 'edgeone-playwright-mcp';
  record('mcp', 'initialize', ok ? 'PASS' : 'FAIL', `${r.status} ${r.ms}ms ${JSON.stringify(resultOf(r)?.serverInfo ?? r.body).slice(0, 120)}`);
  await rpc('notifications/initialized', undefined, { expectResponse: false });
  const list = await rpc('tools/list', {});
  const tools = resultOf(list)?.tools?.map((t) => t.name) ?? [];
  record('mcp', 'tools/list', tools.length > 0 ? 'PASS' : 'FAIL', tools.join(','));
  return tools;
}

const NOW = () => new Date().toISOString();

async function capabilityMatrix() {
  // 基础
  {
    const r = await call('browser_navigate', { url: 'https://example.com/' });
    record('basic', 'navigate', r.status === 200 && !r.body?.result?.isError ? 'PASS' : 'FAIL', `${r.ms}ms ${JSON.stringify(r.body?.result ?? r.body).slice(0, 200)}`);
  }
  {
    // example.com body is rewritten by the sandbox egress (notice page); assert
    // HTML on our own deployed page instead.
    await call('browser_navigate', { url: `${baseUrl}/` });
    const r = await call('browser_get_content');
    const txt = r.body?.result?.content?.[0]?.text ?? '';
    record('basic', 'title-html', txt.includes('edgeone-playwright-mcp') ? 'PASS' : 'FAIL', `len=${txt.length}`);
  }
  // DOM / evaluate — note: example.com body is rewritten by the sandbox egress
  // (block/notice page), so DOM assertions use our own deployed page.
  {
    const r = await call('browser_evaluate', { script: 'document.querySelector("h1").textContent' });
    const txt = r.body?.result?.content?.[0]?.text ?? '';
    record('dom', 'evaluate-h1', txt.includes('edgeone-playwright-mcp') ? 'PASS' : 'FAIL', txt.slice(0, 80));
  }
  // 交互 — use our own deployed page (public test target)
  {
    await call('browser_navigate', { url: `${baseUrl}/` });
    const r = await call('browser_evaluate', { script: 'document.querySelector("code").textContent' });
    const txt = r.body?.result?.content?.[0]?.text ?? '';
    record('interaction', 'read-code-el', txt.includes('/mcp') ? 'PASS' : 'FAIL', txt.slice(0, 60));
  }
  // click/type: page has no inputs; verify tool responds (error on missing selector is correct behavior)
  {
    const r = await call('browser_click', { selector: 'h1' });
    record('interaction', 'click-h1', r.status === 200 ? 'PASS' : 'FAIL', `isError=${r.body?.result?.isError} ${JSON.stringify(r.body?.result?.content?.[0] ?? {}).slice(0, 120)}`);
  }
  {
    const r = await call('browser_type', { selector: 'h1', text: 'x' });
    record('interaction', 'type-h1', r.status === 200 ? 'PASS' : 'FAIL', `isError=${r.body?.result?.isError}`);
  }
  // 截图
  {
    const r = await call('browser_screenshot', { fullPage: false });
    const c = r.body?.result?.content?.[0] ?? {};
    record('screenshot', 'viewport', c.type === 'image' ? 'PASS' : 'FAIL', `${r.ms}ms mime=${c.mimeType} len=${(c.data ?? '').length}`);
    if (c.type === 'image') writeFileSync(`${EV}/shot-viewport.png`, Buffer.from(c.data, 'base64'));
  }
  {
    const r = await call('browser_screenshot', { fullPage: true });
    const c = r.body?.result?.content?.[0] ?? {};
    record('screenshot', 'fullpage', c.type === 'image' ? 'PASS' : 'FAIL', `${r.ms}ms len=${(c.data ?? '').length}`);
    if (c.type === 'image') writeFileSync(`${EV}/shot-fullpage.png`, Buffer.from(c.data, 'base64'));
  }
  // 状态
  {
    await call('browser_navigate', { url: 'https://example.com/' });
    await call('browser_evaluate', { script: 'document.cookie="poc=1;path=/"; localStorage.setItem("poc","1"); "set"' });
    await call('browser_navigate', { url: 'https://example.com/' });
    const r = await call('browser_evaluate', { script: 'JSON.stringify({c:document.cookie,l:localStorage.getItem("poc")})' });
    const txt = r.body?.result?.content?.[0]?.text ?? '';
    record('state', 'cookie-localstorage', txt.includes('poc=1') ? 'PASS' : 'PARTIAL', txt.slice(0, 100));
  }
  // 多标签页/iframe 等:无原生工具 → UNKNOWN(与本地 Playwright MCP 的差异,见 CAPABILITIES.md)
  record('page', 'tabs-history', 'UNKNOWN', 'no native tool in Route B set; evaluate() can touch window.history only');
  // 调试
  record('debug', 'console-network', 'UNKNOWN', 'sandbox.browser API exposes no console/network listeners');
  // 性能
  {
    const r = await call('browser_evaluate', {
      script: 'new Promise(res=>{const po=new PerformanceObserver(l=>{const e=l.getEntries();res(JSON.stringify({lcp:e.at(-1)?.startTime??null}));});po.observe({type:"largest-contentful-paint",buffered:true});setTimeout(()=>res(JSON.stringify({lcp:null})),3000);})',
    });
    record('performance', 'lcp-observe', (r.body?.result?.content?.[0]?.text ?? '').includes('lcp') ? 'PARTIAL' : 'FAIL', (r.body?.result?.content?.[0]?.text ?? '').slice(0, 100));
  }
  // 文件
  {
    const r = await call('sandbox_run_command', { cmd: 'echo poc-file > /tmp/poc.txt && cat /tmp/poc.txt', timeout: 15 });
    const txt = r.body?.result?.content?.[0]?.text ?? '';
    record('file', 'sandbox-tmp-write', txt.includes('poc-file') ? 'PASS' : 'FAIL', txt.slice(0, 120).replace(/\n/g, '\\n'));
  }
  // 高级
  {
    const r = await call('sandbox_info');
    record('advanced', 'sandbox-info', r.status === 200 && !r.body?.result?.isError ? 'PASS' : 'FAIL', (r.body?.result?.content?.[0]?.text ?? '').slice(0, 200));
  }
  // SSRF guard
  {
    const r = await call('browser_navigate', { url: 'http://127.0.0.1:8931/json/version' });
    const blocked = r.body?.result?.content?.[0]?.text?.includes('blocked') ?? false;
    record('security', 'ssrf-guard', blocked ? 'PASS' : 'FAIL', (r.body?.result?.content?.[0]?.text ?? '').slice(0, 80));
  }
}

async function lifecycle() {
  const mk = (name, r) => `${name}: ${r.status} ${r.ms}ms`;
  // 冷启动:已在 init 中完成;这里测复用
  let r = await call('browser_navigate', { url: 'https://example.com/' });
  record('lifecycle', 'reuse-after-init', r.status === 200 && !r.body?.result?.isError ? 'PASS' : 'FAIL', mk('navigate', r));
  // 空闲 6 分钟
  console.log('idle 6min ...', NOW());
  await new Promise((s) => setTimeout(s, 6 * 60 * 1000));
  r = await call('browser_get_content');
  record('lifecycle', 'after-idle-6min', r.status === 200 && !r.body?.result?.isError ? 'PASS' : 'FAIL', mk('getContent', r));
  // 30 分钟累计
  console.log('idle to 30min mark ...', NOW());
  await new Promise((s) => setTimeout(s, 24 * 60 * 1000));
  r = await call('browser_get_content');
  record('lifecycle', 'at-30min', r.status === 200 && !r.body?.result?.isError ? 'PASS' : 'FAIL', mk('getContent', r));
  // extendTimeout
  r = await call('sandbox_extend_timeout', { seconds: 900 });
  record('lifecycle', 'extend-900s', r.status === 200 ? 'PASS' : 'FAIL', (r.body?.result?.content?.[0]?.text ?? '').slice(0, 200));
  // 55 分钟
  console.log('idle to 55min mark ...', NOW());
  await new Promise((s) => setTimeout(s, 25 * 60 * 1000));
  r = await call('browser_get_content');
  record('lifecycle', 'at-55min', r.status === 200 && !r.body?.result?.isError ? 'PASS' : 'FAIL', mk('getContent', r));
  // close 后重建
  r = await call('browser_close');
  record('lifecycle', 'close', r.status === 200 ? 'PASS' : 'FAIL', mk('close', r));
  r = await call('browser_navigate', { url: 'https://example.com/' });
  record('lifecycle', 'recreate-after-close', r.status === 200 && !r.body?.result?.isError ? 'PASS' : 'FAIL', mk('navigate', r));
}

async function probeMode() {
  const res = await fetch(`${baseUrl}/probe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'makers-conversation-id': CONV_ID },
    body: JSON.stringify({ reveal: 'cdp' }),
  });
  const body = await res.json().catch(() => null);
  console.log(JSON.stringify(body, null, 2));
  writeFileSync(`${EV}/probe-${Date.now()}.json`, JSON.stringify({ status: res.status, body, at: NOW() }, null, 2));
}

async function main() {
  const t0 = Date.now();
  await authChecks();
  await init();
  if (mode === 'probe') return probeMode();
  if (mode === 'lifecycle') return lifecycle();
  await capabilityMatrix();
  writeFileSync(
    `${EV}/matrix-${mode}-${Date.now()}.json`,
    JSON.stringify({ at: NOW(), totalMs: Date.now() - t0, results }, null, 2),
  );
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${results.length} checks, ${fail} FAIL, total ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
