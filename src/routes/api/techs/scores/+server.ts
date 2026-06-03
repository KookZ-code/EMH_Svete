import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';
import type { TechScore } from '$types';

interface MwTechRow {
  technician: string;
  job_count: number;
  avg_response_min: number;
  avg_repair_min: number;
  area_count: number;
  ftfr_pct: number;
  supervisor?: string;
}

// Normalise a raw value (lower is better for times) into 0–100 score
function scoreTime(value: number, p50: number, p95: number): number {
  if (value <= p50) return 100;
  if (value >= p95) return 0;
  return Math.round(100 * (1 - (value - p50) / (p95 - p50)));
}

function calcGrade(score: number): 'A' | 'B' | 'C' | 'D' {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return 'D';
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const p: Record<string, string | undefined> = {};
    for (const key of ['start', 'end', 'areas', 'shift', 'job_type']) {
      const v = url.searchParams.get(key);
      if (v) p[key] = v;
    }

    const data = await mwGet<{ rows: MwTechRow[] }>('/api/v1/tech/metrics', p);
    const rows = data.rows ?? [];

    if (rows.length === 0) return apiResponse([]);

    // Derive percentiles for normalisation
    const responses = rows.map(r => r.avg_response_min).sort((a, b) => a - b);
    const repairs   = rows.map(r => r.avg_repair_min).sort((a, b) => a - b);
    const mid = Math.floor(rows.length / 2);
    const top = Math.max(0, Math.floor(rows.length * 0.95) - 1);

    const p50r = responses[mid] ?? 60;  const p95r = responses[top] ?? 180;
    const p50m = repairs[mid]   ?? 60;  const p95m = repairs[top]   ?? 240;
    const maxJobs = Math.max(...rows.map(r => r.job_count), 1);
    const maxAreas = Math.max(...rows.map(r => r.area_count), 1);

    const scores: TechScore[] = rows.map(r => {
      const response_score   = scoreTime(r.avg_response_min, p50r, p95r);
      const mttr_score       = scoreTime(r.avg_repair_min,   p50m, p95m);
      const ftfr_score       = Math.min(100, Math.round(r.ftfr_pct));
      const volume_score     = Math.round((r.job_count / maxJobs) * 100);
      const versatility_score = Math.round((r.area_count / maxAreas) * 100);
      const score = Math.round(
        0.25 * mttr_score + 0.20 * response_score + 0.25 * ftfr_score +
        0.15 * volume_score + 0.15 * versatility_score
      );

      return {
        tech_name:          r.technician,
        supervisor:         r.supervisor ?? null,
        score,
        grade:              calcGrade(score),
        mttr_score,
        response_score,
        ftfr_score,
        volume_score,
        versatility_score,
        total_jobs:         r.job_count,
        areas_covered:      r.area_count,
      };
    });

    scores.sort((a, b) => b.score - a.score);
    return apiResponse(scores);
  } catch (err) {
    return apiError(err);
  }
};
