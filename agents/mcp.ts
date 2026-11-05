/**
 * MCP Streamable HTTP endpoint → POST /mcp
 * Auth: Authorization: Bearer <token>, checked before any sandbox access.
 * CORS/Origin: cross-site browser origins rejected (DNS-rebinding guard).
 */

import { bearerFrom, checkAuth } from './_auth';
import { handleRpc, SERVER_INFO } from './_mcp-core';
import type { PlatformCtx } from './_mcp-core';

interface ReqLike {
  headers: Record<string, string>;
  url: string;
  body?: unknown;
}

interface CtxLike {
  request: ReqLike;
  env?: Record<string, string>;
  sandbox: PlatformCtx['sandbox'];
  conversation_id?: string;
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function unauthorized(): Response {
  return new Response(
    JSON.stringify({ error: 'unauthorized', hint: 'Authorization: Bearer <token>' }),
    { status: 401, headers: { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' } },
  );
}

function originAllowed(req: ReqLike): boolean {
  const origin = req.headers['origin'] ?? req.headers['Origin'];
  if (!origin) return true; // non-browser client
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

async function dispatch(messages: unknown, ctx: CtxLike, sessionId: string): Promise<Response> {
  const platformCtx: PlatformCtx = { sandbox: ctx.sandbox, conversationId: ctx.conversation_id };
  const list: unknown[] = Array.isArray(messages) ? messages : [messages];
  const responses: Record<string, unknown>[] = [];
  for (const m of list) {
    const req = m as { jsonrpc?: string; id?: string | number | null; method?: unknown };
    if (!req || typeof req.method !== 'string') continue;
    const res = await handleRpc(
      { jsonrpc: '2.0', id: req.id ?? null, method: req.method, params: (m as { params?: unknown }).params },
      platformCtx,
    );
    if (res) responses.push(res);
  }
  const headers: Record<string, string> = { 'Mcp-Session-Id': sessionId };
  if (responses.length === 0) return new Response(null, { status: 202, headers });
  const body = Array.isArray(messages) ? responses : responses[0];
  return json(200, body, headers);
}

export async function onRequestPost(context: CtxLike): Promise<Response> {
  const started = Date.now();
  const req = context.request;

  if (!checkAuth(bearerFrom(req.headers), context.env?.MCP_BEARER_TOKEN)) return unauthorized();
  if (!originAllowed(req)) return json(403, { error: 'cross-origin request rejected' });

  const sessionId = req.headers['mcp-session-id'] ?? crypto.randomUUID().replace(/-/g, '');
  const body = req.body;

  // Platform pre-parses JSON; handle string payloads defensively.
  let messages: unknown = body;
  if (typeof body === 'string') {
    try {
      messages = JSON.parse(body);
    } catch {
      return json(400, { error: 'invalid JSON body' });
    }
  }
  if (!messages || (typeof messages !== 'object' && !Array.isArray(messages))) {
    return json(400, { error: 'expected JSON-RPC object or batch' });
  }

  const res = await dispatch(messages, context, sessionId);
  console.log(`[mcp] ${req.method} ${new URL(req.url).pathname} ${Date.now() - started}ms`);
  return res;
}

export async function onRequestGet(context: CtxLike): Promise<Response> {
  if (!checkAuth(bearerFrom(context.request.headers), context.env?.MCP_BEARER_TOKEN)) return unauthorized();
  // No server-initiated streams in this PoC: point clients at POST.
  return json(405, { error: 'SSE stream not supported; use POST for JSON-RPC' });
}

export { SERVER_INFO };
