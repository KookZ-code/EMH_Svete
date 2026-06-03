import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const p: Record<string, string | undefined> = {};
    for (const key of ['start', 'end', 'areas', 'shift', 'selected_month']) {
      const v = url.searchParams.get(key);
      if (v) p[key] = v;
    }

    // Fetch both detail and machine breakdown in parallel
    const [detail, byMachine] = await Promise.all([
      mwGet<Record<string, unknown>>('/api/v1/utilization/detail', p),
      mwGet<{ rows: unknown[] }>('/api/v1/utilization/by-machine', p).catch(() => ({ rows: [] })),
    ]);

    return apiResponse({ ...detail, machine_rows: byMachine.rows ?? [] });
  } catch (err) {
    return apiError(err);
  }
};
