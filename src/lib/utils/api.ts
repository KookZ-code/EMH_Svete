// src/lib/utils/api.ts — EMH Dashboard API client
// All HTTP calls go through apiFetch — never fetch directly in components.

import { base } from '$app/paths';
import type {
  ApiResponse,
  OverviewKpi, StatusMatrixRow, StatusDonut, OpenJob,
  LiveMachine,
  InventoryKpi, InventoryMachine,
  TechScore,
  MachineProfile, MachineMetrics, StatusTimelineEvent,
  MachineArea, JobType,
} from '$types';

// ─── Base fetch wrapper ────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const url = path;  // API paths are always /api/v1/... — no base prefix needed
  try {
    const res  = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    });
    const text = await res.text()
    const json: ApiResponse<T> = JSON.parse(text);
    if (!res.ok && !json.error) {
      return { data: null, error: { code: 'HTTP_ERROR', message: `HTTP ${res.status}` } };
    }
    return json;
  } catch (err) {
    return {
      data: null,
      error: { code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : 'Network error' },
    };
  }
}

// ─── Query string builder ──────────────────────────────────────────────────

function qs(params: Record<string, string | string[] | number | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      if (v.length > 0) p.set(k, v.join(','));
    } else {
      p.append(k, String(v));
    }
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ─── Shared filter params ─────────────────────────────────────────────────

interface FilterParams {
  start?: string;
  end?: string;
  areas?: MachineArea[];
  shift?: 'all' | 'day' | 'night';
  job_types?: JobType[];
}

// ─── Overview ─────────────────────────────────────────────────────────────

export interface OverviewPayload {
  kpi: OverviewKpi;
  matrix: StatusMatrixRow[];
  donut: StatusDonut;
}

export const overviewApi = {
  all: (areas?: MachineArea[]) =>
    apiFetch<OverviewPayload>(`/api/overview${qs({ areas })}`),

  openJobs: (areas?: MachineArea[], job_types?: JobType[]) =>
    apiFetch<OpenJob[]>(`/api/overview/open-jobs${qs({ areas, job_types })}`),
};

// ─── Live Board ───────────────────────────────────────────────────────────

export const liveApi = {
  machines: (areas?: MachineArea[]) =>
    apiFetch<LiveMachine[]>(`/api/live/machines${qs({ areas })}`),
};

// ─── Utilization ──────────────────────────────────────────────────────────

export const utilizationApi = {
  // Base-prefixed: this route has its own +server.ts that merges in machine_rows from a
  // second backend call — it must reach SvelteKit's router, not the dev proxy's direct passthrough.
  detail: (p: FilterParams & { selected_month?: string }) =>
    apiFetch<UtilizationDetailPayload>(`${base}/api/utilization/detail${qs(p as Record<string, string | string[] | number | undefined>)}`),
};

export interface UtilizationDetailPayload {
  raw?: {
    kpi_totals?: KpiTotalRow[];
    area_totals?: AreaTotalRow[];
    area_counts?: unknown[];
    machine_count?: number;
    prev_kpi_totals?: KpiTotalRow[];
    prev_machine_count?: number;
  };
  monthly_trend?: MonthlyTrendRaw[];
  scatter?: ScatterRaw[];
  top_down?: TopCauseRow[];
  top_lost?: TopCauseRow[];
  machines_per_cause?: unknown[];
  machine_rows?: MachineUtilRaw[];
}

export interface KpiTotalRow {
  label: string;
  minutes: number;
  pct: number;
}

export interface AreaTotalRow {
  area: string;
  utilization_pct: number;
  down_pct: number;
  pm_pct: number;
  lost_pct: number;
  target_pct?: number;
}

export interface MonthlyTrendRaw {
  month: string;
  running_min: number;
  down_min: number;
  pm_min: number;
  lost_min: number;
}

export interface ScatterRaw {
  code_machine: string;
  area: string;
  frequency: number;
  avg_duration_h: number;
}

export interface TopCauseRow {
  reason: string;
  hours: number;
  cumulative_pct: number;
}

export interface MachineUtilRaw {
  code_machine: string;
  area: string;
  utilization_pct: number;
  down_min: number;
  pm_min: number;
  lost_min: number;
}

// ─── Downtime ─────────────────────────────────────────────────────────────

export const downtimeApi = {
  detail: (p: FilterParams & { job_types?: JobType[]; limit?: number; drill_day?: string }) =>
    apiFetch<DowntimeDetailPayload>(`/api/downtime/detail${qs(p as Record<string, string | string[] | number | undefined>)}`),
};

export interface DowntimeDetailPayload {
  reason?: DowntimeReasonRaw[];
  machines_by_reason?: DowntimeMachineRaw[];
  daily_shift?: unknown[];
  machine_daily?: unknown[];
  symptom_cause?: unknown[];
  events?: unknown[];
}

export interface DowntimeReasonRaw {
  reason: string;
  hours: number;
  count: number;
  cumulative_pct: number;
}

export interface DowntimeMachineRaw {
  code_machine: string;
  area: string;
  total_hours: number;
  [reason: string]: unknown;
}

// ─── Machines ─────────────────────────────────────────────────────────────

export const machineDetailApi = {
  list: (areas?: MachineArea[]) =>
    apiFetch<{ machine_id: string; area: string; flag_key: number }[]>(
      `/api/machines${qs({ areas })}`
    ),

  detail: (id: string, limit = 25) =>
    apiFetch<{ profile: MachineProfile; metrics: MachineMetrics; timeline: StatusTimelineEvent[] }>(
      `/api/machines/detail?id=${encodeURIComponent(id)}&limit=${limit}`
    ),
};

// ─── Tech Scores ──────────────────────────────────────────────────────────

export const timelineApi = {
  scores: (p: FilterParams) =>
    apiFetch<TechScore[]>(`/api/techs/scores${qs(p as Record<string, string | string[] | number | undefined>)}`),
};

// ─── Inventory ────────────────────────────────────────────────────────────

export interface InventoryPayload {
  kpi: InventoryKpi;
  machines: InventoryMachine[];
}

export const inventoryApi = {
  all: (p?: { areas?: MachineArea[]; search?: string; key_only?: string }) =>
    apiFetch<InventoryPayload>(`/api/inventory${qs(p ?? {})}`),
};
