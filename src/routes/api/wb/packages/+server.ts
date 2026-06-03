import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';

export const GET: RequestHandler = async ({ url }) => {
  try {
    const date = url.searchParams.get('date') ?? '';
    if (!date) return apiResponse({ options: [], packages: [] });
    const data = await mwGet<{ options: unknown[]; packages: string[] }>('/api/v1/wb/packages', { date });
    return apiResponse(data);
  } catch (err) {
    return apiError(err);
  }
};
