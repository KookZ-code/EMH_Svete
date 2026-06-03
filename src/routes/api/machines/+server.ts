import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const p: Record<string, string | undefined> = {};
    const area     = url.searchParams.get('areas');
    const key_only = url.searchParams.get('key_only');
    if (area)     p['area']     = area;
    if (key_only) p['key_only'] = key_only;

    const data = await mwGet<{ machines: unknown[] }>('/api/v1/machines', p);
    return apiResponse(data.machines ?? []);
  } catch (err) {
    return apiError(err);
  }
};
