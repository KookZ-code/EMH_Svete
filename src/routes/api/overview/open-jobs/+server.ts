import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';
import type { OpenJob, MachineArea, JobType } from '$types';

// Middleware returns snake_case names that differ from our TypeScript OpenJob interface
interface MwJob {
  code_machine: string;
  area: string;
  job_type: string;
  des_job: string | null;
  datex: string | null;
  date_ack: string | null;
  tech: string | null;
  wait_min: number;
  repair_min: number;
  status: string;
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const areas    = url.searchParams.get('areas')    ?? undefined;
    const job_type = url.searchParams.get('job_type') ?? undefined;

    const data = await mwGet<{ jobs: MwJob[] }>(
      '/api/v1/overview/open-jobs',
      { ...(areas ? { areas } : {}), ...(job_type ? { job_type } : {}) }
    );

    const jobs: OpenJob[] = (data.jobs ?? []).map((j, i) => ({
      id:              `${j.code_machine}_${j.datex ?? i}`,
      code_machine:    j.code_machine,
      area:            j.area as MachineArea,
      job_type:        j.job_type as JobType,
      symptom:         j.des_job ?? null,
      wait_time_min:   j.wait_min ?? 0,
      repair_time_min: j.repair_min ?? 0,
      tech_name:       j.tech ?? null,
      status:          j.status,
      date_act:        j.datex ?? '',
      date_tech:       j.date_ack ?? null,
      date_close:      null,
      is_key:          false,
    }));

    return apiResponse(jobs);
  } catch (err) {
    return apiError(err);
  }
};
