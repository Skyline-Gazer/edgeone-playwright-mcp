/**
 * Probe endpoint → POST /probe
 * Bearer-protected diagnostics: sandbox availability, warmup/cold-start timings,
 * instance info. cdpUrl is only returned when body { reveal: "cdp" }.
 */

import { bearerFrom, checkAuth } from './_auth';

interface CtxLike {
  request: { headers: Record<string, string>; body?: unknown };
  env?: Record<string, string>;
  sandbox: unknown; // structural check happens below
  conversation_id?: string;
}

interface SandboxShape {
  commands: { run(cmd: string, opts?: { timeout?: number }): Promise<unknown> };
  getInfo(): Promise<unknown>;
  browser: { cdpUrl?: string; liveUrl?: string };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPost(context: CtxLike): Promise<Response> {
  if (!checkAuth(bearerFrom(context.request.headers), context.env?.MCP_BEARER_TOKEN)) {
    return json(401, { error: 'unauthorized' });
  }

  const t0 = Date.now();
  const sb = context.sandbox as SandboxShape | null;
  if (!sb) {
    return json(200, {
      sandbox: null,
      note: 'context.sandbox is null in this runtime',
      elapsedMs: Date.now() - t0,
    });
  }

  // Runtime requires one async sandbox call before other namespaces work.
  const warmT0 = Date.now();
  await sb.commands.run('true', { timeout: 30 });
  const warmMs = Date.now() - warmT0;

  const bodyObj: object = typeof context.request.body === 'object' && context.request.body !== null ? context.request.body : {};
  const reveal = 'reveal' in bodyObj ? bodyObj.reveal : undefined;

  const infoT0 = Date.now();
  const info = await sb.getInfo();
  const infoMs = Date.now() - infoT0;

  const browser = sb.browser ?? {};
  let cdpHost: string | null | 'unparseable' = null;
  if (typeof browser.cdpUrl === 'string' && browser.cdpUrl.length > 0) {
    try {
      cdpHost = new URL(browser.cdpUrl).host;
    } catch {
      cdpHost = 'unparseable';
    }
  }
  return json(200, {
    warmMs,
    infoMs,
    totalMs: Date.now() - t0,
    info,
    browser: {
      hasCdpUrl: typeof browser.cdpUrl === 'string' && browser.cdpUrl.length > 0,
      cdpHost,
      cdpUrl: reveal === 'cdp' ? browser.cdpUrl : undefined,
      liveUrl:
        typeof browser.liveUrl === 'string'
          ? browser.liveUrl.replace(/(token|key|sig)=[^&]+/gi, '$1=REDACTED')
          : undefined,
    },
  });
}
