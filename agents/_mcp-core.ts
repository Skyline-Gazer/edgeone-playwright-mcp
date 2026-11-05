/**
 * Minimal MCP (Model Context Protocol) core over Streamable HTTP.
 * Implements: initialize, notifications/initialized, ping, tools/list, tools/call.
 * Transport: JSON responses (spec allows application/json replies on POST).
 * Session via Mcp-Session-Id header.
 *
 * Tools wrap EdgeOne Makers `context.sandbox` (browser / commands / control).
 * The platform injects `context` untyped at the boundary; shapes are narrowed
 * with small guards instead of `any`.
 */

import { isPrivateTarget } from './_auth';

interface JsonRpcReq {
  jsonrpc?: string;
  id?: string | number | null;
  method: string;
  params?: unknown;
}

/** Minimal structural view of the platform sandbox browser. */
interface SandboxBrowser {
  goto(url: string): Promise<unknown>;
  screenshot(opts: { fullPage?: boolean }): Promise<unknown>;
  click(selector: string): Promise<unknown>;
  type(selector: string, text: string): Promise<unknown>;
  evaluate(script: string): Promise<unknown>;
  getContent(): Promise<unknown>;
  close(): Promise<unknown>;
  cdpUrl?: string;
  liveUrl?: string;
}

/** Minimal structural view of the platform sandbox client. */
interface SandboxClient {
  browser: SandboxBrowser;
  commands: { run(cmd: string, opts?: { timeout?: number }): Promise<unknown> };
  getInfo(): Promise<unknown>;
  extendTimeout(seconds: number): Promise<unknown>;
  getHost(port: number): Promise<unknown>;
}

/** Platform request context actually consumed by this module. */
export interface PlatformCtx {
  sandbox: SandboxClient | null;
  conversationId?: string;
}

/**
 * The runtime wrapper requires one async sandbox call before other namespaces
 * work ("Sandbox is not initialized. Call an async sandbox method first").
 * Warm up once per conversation, then reuse.
 */
const warmed = new Set<string>();

async function ensureSandbox(ctx: PlatformCtx): Promise<void> {
  const key = ctx.conversationId ?? '__default__';
  if (warmed.has(key)) return;
  // First acquire on a fresh conversation can race the platform lazy-init and
  // surface "Sandbox is not initialized"; one retry after a short wait clears it.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await ctx.sandbox.commands.run('true', { timeout: 30 });
      warmed.add(key);
      return;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('not initialized') || attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

interface ToolResult {
  isError?: boolean;
  content: Array<Record<string, unknown>>;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: PlatformCtx): Promise<ToolResult>;
}

function text(s: string): Record<string, unknown> {
  return { type: 'text', text: s };
}

function img(base64: string, mime = 'image/png'): Record<string, unknown> {
  return { type: 'image', data: base64, mimeType: mime };
}

function errResult(message: string): ToolResult {
  return { isError: true, content: [text(message)] };
}

function jsonResult(value: unknown): ToolResult {
  return { content: [text(JSON.stringify(value, null, 2))] };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v);
}

function extractBase64(r: unknown): string | null {
  if (typeof r === 'string') return r;
  if (r && typeof r === 'object') {
    if ('base64Image' in r && typeof r.base64Image === 'string') return r.base64Image;
    if ('base64' in r && typeof r.base64 === 'string') return r.base64;
  }
  return null;
}

const BROWSER_TOOLS: ToolDef[] = [
  {
    name: 'browser_navigate',
    description: 'Navigate the sandbox Chromium to a URL. Private/loopback targets are rejected.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Absolute http(s) URL' } },
      required: ['url'],
    },
    run: async (args, ctx) => {
      if (isPrivateTarget(str(args.url))) return errResult('blocked: private/loopback/non-http target');
      return jsonResult((await ctx.sandbox.browser.goto(str(args.url))) ?? { ok: true });
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Screenshot the current page. Returns an image (PNG) content block.',
    inputSchema: { type: 'object', properties: { fullPage: { type: 'boolean', default: false } } },
    run: async (args, ctx) => {
      const r = await ctx.sandbox.browser.screenshot({ fullPage: args.fullPage === true });
      const b64 = extractBase64(r);
      if (!b64) return errResult('screenshot returned no image: ' + JSON.stringify(r).slice(0, 300));
      return { content: [img(b64)] };
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element matched by CSS selector.',
    inputSchema: { type: 'object', properties: { selector: { type: 'string' } }, required: ['selector'] },
    run: async (args, ctx) => jsonResult((await ctx.sandbox.browser.click(str(args.selector))) ?? { ok: true }),
  },
  {
    name: 'browser_type',
    description: 'Type text into an element matched by CSS selector.',
    inputSchema: {
      type: 'object',
      properties: { selector: { type: 'string' }, text: { type: 'string' } },
      required: ['selector', 'text'],
    },
    run: async (args, ctx) => jsonResult((await ctx.sandbox.browser.type(str(args.selector), str(args.text))) ?? { ok: true }),
  },
  {
    name: 'browser_evaluate',
    description: 'Evaluate JavaScript in the page context and return the JSON-serializable result.',
    inputSchema: { type: 'object', properties: { script: { type: 'string' } }, required: ['script'] },
    run: async (args, ctx) => jsonResult(await ctx.sandbox.browser.evaluate(str(args.script))),
  },
  {
    name: 'browser_get_content',
    description: 'Return the current page HTML.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_args, ctx) => {
      const c = await ctx.sandbox.browser.getContent();
      return { content: [text(typeof c === 'string' ? c : JSON.stringify(c))] };
    },
  },
  {
    name: 'browser_close',
    description: 'Close the sandbox browser and release it.',
    inputSchema: { type: 'object', properties: {} },
    run: async (_args, ctx) => jsonResult((await ctx.sandbox.browser.close()) ?? { ok: true }),
  },
];

function redactQuery(u: unknown): unknown {
  return typeof u === 'string' ? u.replace(/(token|key|sig)=[^&]+/gi, '$1=REDACTED') : u;
}

function cdpHost(cdpUrl: unknown): string | null {
  if (typeof cdpUrl !== 'string' || cdpUrl.length === 0) return null;
  try {
    return new URL(cdpUrl).host;
  } catch {
    return null;
  }
}

const CONTROL_TOOLS: ToolDef[] = [
  {
    name: 'sandbox_info',
    description: 'Sandbox instance info (id, region, timeouts); browser cdpUrl is reported host-only.',
    inputSchema: { type: 'object', properties: { exposePort: { type: 'number', description: 'optional sandbox port to expose via getHost()' } } },
    run: async (args, ctx) => {
      // getInfo() needs the sandbox session bootstrapped even when browser
      // namespaces are already warm; running a command first satisfies it.
      await ctx.sandbox.commands.run('true', { timeout: 30 });
      let info: unknown;
      try {
        info = await ctx.sandbox.getInfo();
      } catch (e) {
        info = { getInfoError: e instanceof Error ? e.message : String(e) };
      }
      const exposedHost =
        typeof args.exposePort === 'number' ? redactQuery(await ctx.sandbox.getHost(args.exposePort)) : undefined;
      const b = ctx.sandbox.browser;
      return jsonResult({
        info,
        exposedHost,
        browser: { hasCdpUrl: typeof b.cdpUrl === 'string' && b.cdpUrl.length > 0, cdpHost: cdpHost(b.cdpUrl), liveUrl: redactQuery(b.liveUrl ?? null) },
      });
    },
  },
  {
    name: 'sandbox_run_command',
    description: 'Run a shell command in the sandbox (stdout/stderr/exitCode). timeout in seconds.',
    inputSchema: {
      type: 'object',
      properties: { cmd: { type: 'string' }, timeout: { type: 'number', default: 30 } },
      required: ['cmd'],
    },
    run: async (args, ctx) => jsonResult(await ctx.sandbox.commands.run(str(args.cmd), { timeout: typeof args.timeout === 'number' ? args.timeout : 30 })),
  },
  {
    name: 'playwright_native_call',
    description:
      'Relay ONE JSON-RPC message to the NATIVE @playwright/mcp server running inside the sandbox ' +
      '(full Playwright toolset: browser_snapshot, browser_tabs, browser_file_upload, browser_console_messages, ...). ' +
      'Auto-starts the server and manages its session. args: { method, params }. ' +
      'Use method=tools/list to enumerate native tools, tools/call with name/arguments to invoke.',
    inputSchema: {
      type: 'object',
      properties: { method: { type: 'string' }, params: { type: 'object' } },
      required: ['method'],
    },
    run: async (args, ctx) => {
      const payload = Buffer.from(
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: str(args.method), params: args.params ?? {} }),
      ).toString('base64');
      const script = [
        'set -e',
        'CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8931/mcp || true)',
        'if [ "$CODE" != "200" ] && [ "$CODE" != "400" ]; then',
        '  nohup npx -y @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9222 --port 8931 >/tmp/pwmcp.log 2>&1 &',
        '  for i in $(seq 1 45); do',
        '    sleep 1',
        '    CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8931/mcp || true)',
        '    [ "$CODE" = "200" ] || [ "$CODE" = "400" ] && break',
        '  done',
        'fi',
        'if ! grep -q . /tmp/pw-session 2>/dev/null; then',
        '  curl -s -D /tmp/pw-hdr -o /tmp/pw-init.json -X POST http://127.0.0.1:8931/mcp -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d \'{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"edgeone-relay","version":"1.0"}}}\'',
        '  SID=$(grep -i "^mcp-session-id:" /tmp/pw-hdr | tr -d "\\r" | awk \'{print $2}\')',
        '  [ -n "$SID" ] && echo "$SID" > /tmp/pw-session',
        '  curl -s -o /dev/null -X POST http://127.0.0.1:8931/mcp ${SID:+-H "mcp-session-id: $SID"} -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d \'{"jsonrpc":"2.0","method":"notifications/initialized"}\'',
        'fi',
        'SID=$(cat /tmp/pw-session 2>/dev/null || true)',
        `echo ${payload} | base64 -d > /tmp/pw-req.json`,
        'curl -s -X POST http://127.0.0.1:8931/mcp ${SID:+-H "mcp-session-id: $SID"} -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" --data-binary @/tmp/pw-req.json',
      ].join('\n');
      const r = await ctx.sandbox.commands.run(script, { timeout: 120 });
      const out = r as { stdout?: unknown };
      const stdout = typeof out.stdout === 'string' ? out.stdout : JSON.stringify(r);
      const dataLine = stdout
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6).trim())
        .pop();
      return jsonResult(dataLine ? JSON.parse(dataLine) : stdout);
    },
  },
  {
    name: 'sandbox_extend_timeout',
    description: 'Extend the sandbox lifetime by N seconds (platform-capped).',
    inputSchema: { type: 'object', properties: { seconds: { type: 'number' } }, required: ['seconds'] },
    run: async (args, ctx) => jsonResult((await ctx.sandbox.extendTimeout(typeof args.seconds === 'number' ? args.seconds : Number(args.seconds))) ?? { ok: true }),
  },
];

export const ALL_TOOLS: ToolDef[] = [...BROWSER_TOOLS, ...CONTROL_TOOLS];

export const SERVER_INFO = { name: 'edgeone-playwright-mcp', version: '0.1.0' };

function rpcResult(id: JsonRpcReq['id'], result: unknown) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcReq['id'], code: number, message: string) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export async function handleRpc(req: JsonRpcReq, ctx: PlatformCtx): Promise<Record<string, unknown> | undefined> {
  const { method, params, id } = req;

  if (method === 'initialize') {
    const p = (params ?? {}) as { protocolVersion?: string };
    return rpcResult(id, {
      protocolVersion: p.protocolVersion ?? '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
    });
  }
  if (typeof method === 'string' && method.startsWith('notifications/')) {
    return undefined; // notification: no response body
  }
  if (method === 'ping') return rpcResult(id, {});
  if (method === 'tools/list') {
    return rpcResult(id, {
      tools: ALL_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
    });
  }
  if (method === 'tools/call') {
    const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
    const name = str(p.name);
    const tool = ALL_TOOLS.find((t) => t.name === name);
    if (!tool) return rpcError(id, -32602, `unknown tool: ${name}`);
    if (!ctx.sandbox) {
      return rpcResult(id, errResult('sandbox unavailable in this runtime (null) — anonymous deploys may lack sandbox tickets'));
    }
    const args = (p.arguments ?? {}) as Record<string, unknown>;
    try {
      await ensureSandbox(ctx);
      const result = await tool.run(args, ctx);
      return rpcResult(id, result);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return rpcResult(id, errResult(msg));
    }
  }
  return rpcError(id, -32601, `method not found: ${method}`);
}
