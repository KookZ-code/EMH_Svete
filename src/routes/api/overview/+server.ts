import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';
import type { OverviewKpi, StatusMatrixRow, StatusDonut } from '$types';

interface MwOverview {
  kpi: {
    total_machines: number;
    running: number;
    down: number;
    waiting: number;
    on_process: number;
    closed_this_shift: number;
  };
  status_matrix: { job_type: string; waiting: number; on_process: number; closed: number }[];
  status_donut?: { running: number; mc_down: number; lost_time: number; pm: number; other: number; total: number };
  updated_at: string;
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const areas = url.searchParams.get('areas') ?? undefined;
    const data = await mwGet<MwOverview>('/api/v1/overview', areas ? { areas } : undefined);

    const kpi: OverviewKpi = {
      key_machines:      data.kpi.total_machines,
      running:           data.kpi.running,
      mc_down:           data.kpi.down,
      waiting_for_tech:  data.kpi.waiting,
      on_process:        data.kpi.on_process,
      closed_this_shift: data.kpi.closed_this_shift,
      last_updated:      data.updated_at,
    };

    const matrix: StatusMatrixRow[] = data.status_matrix as StatusMatrixRow[];

    // Derive donut from kpi if middleware doesn't provide it
    const total = data.kpi.total_machines || 1;
    const donut: StatusDonut = data.status_donut ?? {
      running:   data.kpi.running,
      mc_down:   data.kpi.down,
      lost_time: 0,
      pm:        0,
      other:     Math.max(0, total - data.kpi.running - data.kpi.down - data.kpi.on_process),
      total,
    };

    return apiResponse({ kpi, matrix, donut });
  } catch (err) {
    return apiError(err);
  }
};
