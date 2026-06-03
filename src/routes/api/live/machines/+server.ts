import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';
import type { LiveMachine, MachineArea, MachineStatus, JobType } from '$types';

interface MwMachine {
  machine_id: string;
  des_machine: string;
  area: string;
  flag_key: number;
  flag_automotive: number;
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
}

// Map job_type → MachineStatus
function jobTypeToStatus(jobType: string, jobStatus: string): MachineStatus {
  if (jobStatus === 'waiting') return 'Waiting';
  const t = jobType?.toUpperCase();
  if (t === 'M/C DOWN')            return 'M/C Down';
  if (t === 'PM')                  return 'PM';
  if (t === 'SETUP' || t === 'SETUP BY OPERATOR') return 'Setup';
  if (t === 'CONVERT')             return 'Convert';
  if (t === 'ENGINEERING DOWN' || t === 'FACILITY DOWN') return 'Other';
  return 'Other';
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const areas = url.searchParams.get('areas') ?? undefined;
    const params = areas ? { areas } : undefined;

    const [machinesData, jobsData] = await Promise.all([
      mwGet<{ machines: MwMachine[] }>('/api/v1/machines', params),
      mwGet<{ jobs: MwJob[] }>('/api/v1/overview/open-jobs', params),
    ]);

    const machines = machinesData.machines ?? [];
    const openJobs = jobsData.jobs ?? [];

    // Index open jobs by machine id for quick lookup
    const jobMap = new Map<string, MwJob>();
    for (const job of openJobs) {
      jobMap.set(job.code_machine, job);
    }

    const now = Date.now();
    const live: LiveMachine[] = machines.map(m => {
      const job = jobMap.get(m.machine_id);
      let status: MachineStatus = 'Running';
      let elapsed_min = 0;

      if (job) {
        status = jobTypeToStatus(job.job_type, job.status);
        const started = new Date(job.datex).getTime();
        elapsed_min = isNaN(started) ? 0 : Math.floor((now - started) / 60000);
      }

      return {
        code_machine: m.machine_id,
        area:         m.area as MachineArea,
        status,
        job_type:     job ? (job.job_type as JobType) : null,
        tech_name:    job?.tech ?? null,
        symptom:      job?.des_job ?? null,
        elapsed_min,
        is_key:       m.flag_key === 1,
      };
    });

    return apiResponse(live);
  } catch (err) {
    return apiError(err);
  }
};
