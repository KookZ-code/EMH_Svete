import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const p: Record<string, string | undefined> = {};
    for (const key of ['job_types','start','end','areas','shift','machine','symptom','cause','tech','limit','drill_day']) {
      const v = url.searchParams.get(key);
      if (v) p[key] = v;
    }
    const data = await mwGet<{ events: unknown[]; total: number }>('/api/v1/downtime/events', p);
    return apiResponse(data);
  } catch (err) {
    return apiError(err);
  }
};
