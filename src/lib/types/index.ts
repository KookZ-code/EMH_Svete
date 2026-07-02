// src/lib/types/index.ts — Shared TypeScript types for EMH Dashboard

// ─── API wrappers ──────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T | null;
  error: ApiError | null;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

// ─── UI state ──────────────────────────────────────────────────────────────

export type LoadingState = 'idle' | 'loading' | 'success' | 'error';

export interface AsyncState<T> {
  data: T | null;
  state: LoadingState;
  error: string | null;
}

export function createAsyncState<T>(): AsyncState<T> {
  return { data: null, state: 'idle', error: null };
}

// ─── EMH domain — Machine ──────────────────────────────────────────────────

export type MachineArea =
  | 'BG' | 'SAW' | 'DA' | 'WB' | 'MOLD'
  | 'PLATE' | 'MARK' | 'SAW_QFN' | 'TF' | 'ISO' | 'FS';

export type JobType =
  | 'M/C DOWN'
  | 'ENGINEERING DOWN'
  | 'FACILITY DOWN'
  | 'PM'
  | 'SETUP'
  | 'SETUP BY OPERATOR'
  | 'CONVERT'
  | 'CLEAN MOLD'
  | 'CHANGE CAP';

export type MachineStatus =
  | 'Running'
  | 'M/C Down'
  | 'PM'
  | 'Setup'
  | 'Idle'
  | 'Convert'
  | 'Waiting'
  | 'Lost Time'
  | 'Other';

export interface Machine {
  id: string;
  code_machine: string;
  area: MachineArea;
  model: string;
  manufacturer: string;
  year_install: number | null;
  is_key: boolean;
  is_auto: boolean;
  is_gold: boolean;
  status: MachineStatus;
}

// ─── EMH domain — Jobs ─────────────────────────────────────────────────────

export interface OpenJob {
  id: string;
  code_machine: string;
  area: MachineArea;
  job_type: JobType;
  symptom: string | null;
  wait_time_min: number;       // minutes from report to tech arrival
  repair_time_min: number;     // minutes in repair
  tech_name: string | null;
  status: string;
  date_act: string;            // ISO 8601 when operator reported
  date_tech: string | null;    // ISO 8601 when tech arrived
  date_close: string | null;   // ISO 8601 when closed
  is_key: boolean;
}

export interface StatusMatrixRow {
  job_type: JobType;
  waiting: number;
  on_process: number;
  closed: number;
}

// ─── EMH domain — Overview KPIs ───────────────────────────────────────────

export interface OverviewKpi {
  key_machines: number;
  running: number;
  mc_down: number;
  waiting_for_tech: number;
  on_process: number;
  closed_this_shift: number;
  last_updated: string;
}

export interface StatusDonut {
  running: number;
  mc_down: number;
  lost_time: number;
  pm: number;
  other: number;
  total: number;
}

// ─── EMH domain — Live Board ──────────────────────────────────────────────

export interface LiveMachine {
  code_machine: string;
  area: MachineArea;
  status: MachineStatus;
  job_type: JobType | null;
  tech_name: string | null;
  symptom: string | null;
  package_type: string | null;
  model: string | null;
  elapsed_min: number;
  started_at: string | null;
  is_key: boolean;
}

// ─── EMH domain — Utilization ─────────────────────────────────────────────

export interface UtilizationKpi {
  utilization_pct: number;
  downtime_pct: number;
  pm_pct: number;
  lost_time_pct: number;
}

export interface MonthlyTrendRow {
  month: string;           // "2026-01"
  running_min: number;
  down_min: number;
  pm_min: number;
  lost_min: number;
}

export interface AreaUtilizationRow {
  area: string;
  utilization_pct: number;
  target_pct: number;
}

export interface ParetoRow {
  reason: string;
  hours: number;
  cumulative_pct: number;
}

export interface MachineUtilRow {
  code_machine: string;
  area: string;
  utilization_pct: number;
  down_min: number;
  pm_min: number;
  lost_min: number;
}

export interface ScatterPoint {
  code_machine: string;
  frequency: number;       // # of events
  avg_duration_h: number;  // average hours per event
  area: string;
}

// ─── EMH domain — Downtime ────────────────────────────────────────────────

export interface DowntimeReasonRow {
  reason: string;
  hours: number;
  count: number;
  cumulative_pct: number;
}

export interface DowntimeMachineRow {
  code_machine: string;
  area: string;
  reasons: Record<string, number>;  // reason → hours
  total_hours: number;
}

// ─── EMH domain — Machine Detail ──────────────────────────────────────────

export interface MachineProfile {
  code_machine: string;
  area: MachineArea;
  model: string;
  manufacturer: string;
  year_install: number | null;
  serial_no: string | null;
  is_key: boolean;
  notes: string | null;
}

export interface MachineMetrics {
  utilization_30d: number;
  mttr_h: number;
  downtime_events_30d: number;
  pm_events_30d: number;
}

export interface StatusTimelineEvent {
  ts: string;
  status: MachineStatus;
  job_type: JobType | null;
  duration_min: number;
}

// ─── EMH domain — Tech Performance ───────────────────────────────────────

export interface TechScore {
  tech_name: string;
  supervisor: string | null;
  score: number;           // 0–100 composite
  grade: 'A' | 'B' | 'C' | 'D';
  mttr_score: number;
  response_score: number;
  ftfr_score: number;
  volume_score: number;
  versatility_score: number;
  total_jobs: number;
  areas_covered: number;
}

// ─── EMH domain — Inventory ───────────────────────────────────────────────

export interface InventoryKpi {
  total_machines: number;
  key_machines: number;
  areas: number;
  models: number;
}

export type HealthStatus = 'critical' | 'warning' | 'monitor' | 'healthy';

export interface InventoryMachine extends Machine {
  des_machine: string;
  area_name?: string;
  year_install: number | null;
  serial_no: string | null;
  is_gold: boolean;
  notes: string | null;
  // 7-day downtime (joined from /inventory/downtime)
  down_events: number;
  down_hrs: number;
  avg_mttr_min: number;
  health: HealthStatus;
  // last run package (joined from /inventory/last-package)
  last_package: string | null;
  last_run_date: string | null;
}

// ─── Filters ──────────────────────────────────────────────────────────────

export interface DateRange {
  start: string;   // YYYY-MM-DD
  end: string;     // YYYY-MM-DD
}

export interface DashboardFilters {
  dateRange: DateRange;
  areas: MachineArea[];
  machines: string[];
  shift: 'all' | 'day' | 'night';
  jobTypes: JobType[];
}

// ─── Auth ─────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'supervisor' | 'viewer'

export interface SessionUser {
  id:          number
  username:    string
  displayName: string
  role:        UserRole
}

// ─── Item (template — keep for compatibility) ──────────────────────────────

export interface Item {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}
