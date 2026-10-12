import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const p: Record<string, string | undefined> = {};
    for (const key of ['start', 'end', 'areas', 'shift', 'limit']) {
      const v = url.searchParams.get(key);
      if (v) p[key] = v;
    }

    const data = await mwGet('/api/v1/downtime/top-machines', p);
    return apiResponse(data);
  } catch (err) {
    return apiError(err);
  }
};
