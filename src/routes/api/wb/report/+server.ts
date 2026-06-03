import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const p: Record<string, string | undefined> = {};
    for (const key of ['date', 'shift', 'packages']) {
      const v = url.searchParams.get(key);
      if (v) p[key] = v;
    }
    if (!p.date) return apiResponse({ machines: [], kpi: {}, pkg_label: '', shift: '', time_range: '' });
    const data = await mwGet('/api/v1/wb/report', p);
    return apiResponse(data);
  } catch (err) {
    return apiError(err);
  }
};
