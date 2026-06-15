import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';
import type { LiveMachine, MachineArea, MachineStatus, JobType } from '$types';

interface MwMachine {
  machine_id: string;
  des_machine: string;
  area: string;
  flag_key: number;
  flag_automotive: number;
  model: string | null;
}

interface MwJob {
  code_machine: string;
  area: string;
  job_type: string;
  des_job: string;
  tech: string | null;
  wait_min: number;
  status: string;
  datex: string;
  package_type: string | null;
}

// Map job_type → MachineStatus
// SBO des_job keywords that indicate machine is idle/waiting (not actively setting up)
const IDLE_SBO_RE = /^idle|^wait/i;

function jobTypeToStatus(jobType: string, jobStatus: string, desJob?: string): MachineStatus {
  if (jobStatus?.toLowerCase() === 'waiting') return 'Waiting';
  const t = jobType?.toUpperCase();
  if (t === 'M/C DOWN')            return 'M/C Down';
  if (t === 'PM')                  return 'PM';
  if (t === 'SETUP' || t === 'SETUP BY OPERATOR') {
    // Separate SBO machines that are idle/waiting from those actively setting up
    return IDLE_SBO_RE.test(desJob ?? '') ? 'Idle' : 'Setup';
  }
  if (t === 'CONVERT')             return 'Convert';
  if (t === 'ENGINEERING DOWN' || t === 'FACILITY DOWN') return 'Other';
  return 'Other';
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const areas = url.searchParams.get('areas') ?? undefined;
    const params = areas ? { areas } : undefined;

    const [machinesData, jobsData, pkgData] = await Promise.all([
      mwGet<{ machines: MwMachine[] }>('/api/v1/machines', params),
      mwGet<{ jobs: MwJob[] }>('/api/v1/overview/open-jobs', params),
      mwGet<{ packages: { code_machine: string; package_type: string }[] }>('/api/v1/inventory/last-package')
        .catch(() => ({ packages: [] as { code_machine: string; package_type: string }[] })),
    ]);

    const machines = machinesData.machines ?? [];
    const openJobs = jobsData.jobs ?? [];

    const jobMap = new Map<string, MwJob>();
    for (const job of openJobs) jobMap.set(job.code_machine, job);

    // Last-run package per machine (for Running machines that have no open job)
    const pkgMap = new Map<string, string>();
    for (const p of pkgData.packages ?? []) pkgMap.set(p.code_machine.trim(), p.package_type);

    const live: LiveMachine[] = machines.map(m => {
      const job = jobMap.get(m.machine_id);
      let status: MachineStatus = 'Running';
      let elapsed_min = 0;

      let started_at: string | null = null;

      if (job) {
        status = jobTypeToStatus(job.job_type, job.status, job.des_job);
        if (job.status?.toLowerCase() === 'waiting') {
          elapsed_min = job.wait_min ?? 0;
          started_at  = job.datex ? job.datex.substring(11, 16) : null;
        } else {
          // datex inconsistency: backend sometimes stores Thailand local time with Z suffix.
          // If Date.now() - Date.parse(datex) < 0 → datex is local (+7h offset needed).
          // If positive → datex is real UTC, convert to Thailand local for display.
          const raw = Date.parse(job.datex ?? '');
          if (!isNaN(raw)) {
            const diff = Date.now() - raw;
            if (diff >= 0) {
              // Real UTC datex
              elapsed_min = Math.floor(diff / 60000);
              const localMs = raw + 7 * 3600 * 1000;
              started_at  = new Date(localMs).toISOString().substring(11, 16);
            } else {
              // Local time stored as Z — add 7h to get elapsed, use raw HH:MM as-is
              elapsed_min = Math.max(0, Math.floor((diff + 7 * 3600 * 1000) / 60000));
              started_at  = job.datex.substring(11, 16);
            }
          }
        }
      }

      return {
        code_machine: m.machine_id,
        area:         m.area as MachineArea,
        status,
        job_type:     job ? (job.job_type as JobType) : null,
        tech_name:    job?.tech ?? null,
        symptom:      job?.des_job ?? null,
        // Running machines show last-run package; non-Running show the open-job package
        package_type: job?.package_type ?? pkgMap.get(m.machine_id.trim()) ?? null,
        model:        m.model ?? null,
        elapsed_min,
        started_at,
        is_key:       m.flag_key === 1,
      };
    });

    // If a machine has L/R variants, drop the plain entry (same physical unit).
    // Build a set of base IDs that have at least one L/R sibling.
    const hasLR = new Set<string>();
    for (const m of live) {
      const match = m.code_machine.match(/^(.+?)[LR]$/);
      if (match) hasLR.add(match[1].trimEnd());
    }
    const deduped = live.filter(m =>
      /[LR]$/.test(m.code_machine) ||            // keep all L/R
      !hasLR.has(m.code_machine.trimEnd())        // keep plain only if no L/R sibling
    );

    return apiResponse(deduped);
  } catch (err) {
    return apiError(err);
  }
};
