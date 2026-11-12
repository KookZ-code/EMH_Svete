// Forwards browser calls to /api/v1/* on to the Rust backend.
//
// Why this exists: in dev, Vite proxies /api/* straight to the backend, so this route is never reached.
// On IIS (adapter-node under iisnode) nothing else forwards these paths, so without this route the
// trend charts (/api/v1/wb/report-7day) and the admin page (/api/v1/users, /permissions) return 404.
//
// The hook in hooks.server.ts already requires a signed-in session for every /api/ path,
// so this route only needs to add the backend base URL and the API key.

import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const BACKEND_BASE = (env.API_BASE_URL ?? 'http://127.0.0.1:8090').replace(/\/$/, '');
const TIMEOUT_MS = Number(env.API_TIMEOUT ?? 30000);

const forward: RequestHandler = async ({ request, params, url }) => {
  // Reject path traversal before building the upstream URL.
  if (params.path.split('/').some((seg) => seg === '..' || seg === '.')) {
    return new Response('invalid path', { status: 400 });
  }

  const headers = new Headers({ 'X-API-Key': env.API_KEY ?? '' });
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const upstream = await fetch(`${BACKEND_BASE}/api/v1/${params.path}${url.search}`, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
  });
};

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
