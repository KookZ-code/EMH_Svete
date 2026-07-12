// src/lib/server/middleware.ts — server-only fetch wrapper for Rust middleware API
// $lib/server/* is automatically treated as server-only by SvelteKit

import { env } from '$env/dynamic/private';

function getBase()    { return (env.API_BASE_URL ?? 'http://localhost:8080').replace(/\/$/, ''); }
function getApiKey()  { return env.API_KEY ?? ''; }
function getTimeout() { return Number(env.API_TIMEOUT ?? 10000); }

export class MiddlewareError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** GET the middleware API. Returns `body.data` or throws `MiddlewareError`. */
export async function mwGet<T>(path: string, params?: Record<string, string | string[] | undefined>): Promise<T> {
  const url = new URL(`${getBase()}${path}`);

  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach(i => url.searchParams.append(k, i));
      else url.searchParams.set(k, v);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeout());

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { 'X-API-Key': getApiKey() },
      signal: controller.signal,
    });
  } catch (err) {
    throw new MiddlewareError('NETWORK_ERROR', err instanceof Error ? err.message : 'Network error');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new MiddlewareError('HTTP_ERROR', `Middleware returned ${res.status}`);
  }

  // Rust API returns { data: T, error: null } on success, { data: null, error: {...} } on failure
  const body = await res.json() as { data: T | null; error: { code: string; message: string } | null };

  if (body.error != null) {
    const e = body.error;
    throw new MiddlewareError(e?.code ?? 'API_ERROR', e?.message ?? 'Unknown API error');
  }

  return body.data as T;
}

/** Wrap a server route handler — returns JSON or a 500 error envelope. */
export function apiResponse(data: unknown) {
  return Response.json({ data, error: null });
}

export function apiError(err: unknown) {
  const code    = err instanceof MiddlewareError ? err.code : 'INTERNAL_ERROR';
  const message = err instanceof Error ? err.message : 'Unexpected error';
  console.error('[middleware]', code, message);
  return Response.json({ data: null, error: { code, message } }, { status: 502 });
}
