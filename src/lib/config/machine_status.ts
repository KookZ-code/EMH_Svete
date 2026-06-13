// Shared machine-status presentation — used by both the Live Board tile grid
// (src/routes/live/+page.svelte) and the WB floor map (WbFloorMap.svelte).
import type { MachineStatus } from '$types';

export interface StatusStyle { bg: string; text: string; label: string; }

export const statusConfig: Record<string, StatusStyle> = {
  'Running':   { bg: '#5EBF33', text: '#fff',  label: 'RUNNING' },
  'M/C Down':  { bg: '#CC0000', text: '#fff',  label: 'M/C DOWN' },
  'PM':        { bg: '#702076', text: '#fff',  label: 'PM' },
  'Setup':     { bg: '#1D9CE4', text: '#fff',  label: 'SETUP' },
  'Idle':      { bg: '#78909C', text: '#fff',  label: 'IDLE' },
  'Convert':   { bg: '#FFD53A', text: '#333',  label: 'CONVERT' },
  'Waiting':   { bg: '#FD7F20', text: '#fff',  label: 'WAITING' },
  'Lost Time': { bg: '#FD7F20', text: '#fff',  label: 'LOST TIME' },
  'Other':     { bg: '#8A8A8A', text: '#fff',  label: 'OTHER' },
};

export function statusStyle(status: MachineStatus | string): StatusStyle {
  return statusConfig[status] ?? statusConfig['Other'];
}

/** Format elapsed minutes as "45m" or "2h 5m". */
export function fmtElapsed(min: number): string {
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}
