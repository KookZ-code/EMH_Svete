import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';
import type { MachineProfile, MachineMetrics, StatusTimelineEvent } from '$types';

interface MwMachineDetail {
  info: {
    machine_id: string;
    des_machine: string;
    area: string;
    flag_key: number;
    mfg: string;
    model: string;
    sn: string;
    notes?: string;
  };
  kpis: {
    utilization_pct?: number;
    avg_mttr_min?: number;
    down_events?: number;
    pm_events?: number;
  };
  recent_events: {
    ts?: string;
    datex?: string;
    job_type: string;
    status: string;
    duration_min: number;
  }[];
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const id = url.searchParams.get('id');
    if (!id) return Response.json({ data: null, error: { code: 'BAD_REQUEST', message: 'id required' } }, { status: 400 });

    const limit = url.searchParams.get('limit') ?? '25';
    const data = await mwGet<MwMachineDetail>('/api/v1/machines/detail', { id, recent_limit: limit });

    const profile: MachineProfile = {
      code_machine:  data.info.machine_id,
      area:          data.info.area as MachineProfile['area'],
      model:         data.info.model ?? '',
      manufacturer:  data.info.mfg ?? '',
      year_install:  null,
      serial_no:     data.info.sn ?? null,
      is_key:        data.info.flag_key === 1,
      notes:         data.info.notes ?? null,
    };

    const metrics: MachineMetrics = {
      utilization_30d:    data.kpis.utilization_pct ?? 0,
      mttr_h:             (data.kpis.avg_mttr_min ?? 0) / 60,
      downtime_events_30d: data.kpis.down_events ?? 0,
      pm_events_30d:       data.kpis.pm_events ?? 0,
    };

    const timeline: StatusTimelineEvent[] = (data.recent_events ?? []).map(e => ({
      ts:           e.ts ?? e.datex ?? '',
      status:       e.status as StatusTimelineEvent['status'],
      job_type:     e.job_type as StatusTimelineEvent['job_type'],
      duration_min: e.duration_min,
    }));

    return apiResponse({ profile, metrics, timeline });
  } catch (err) {
    return apiError(err);
  }
};
