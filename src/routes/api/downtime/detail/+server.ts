import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const p: Record<string, string | undefined> = {};
    for (const key of ['job_types', 'start', 'end', 'areas', 'machines', 'shift', 'reason_col']) {
      const v = url.searchParams.get(key);
      if (v) p[key] = v;
    }

    const data = await mwGet('/api/v1/downtime/detail', p);
    return apiResponse(data);
  } catch (err) {
    return apiError(err);
  }
};
