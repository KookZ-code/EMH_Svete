import type { RequestHandler } from '@sveltejs/kit';
import { mwGet, apiResponse, apiError } from '$lib/server/middleware';
import type { InventoryKpi, InventoryMachine, MachineArea } from '$types';

interface MwInventoryMachine {
  machine_id: string;
  des_machine: string;
  area: string;
  area_name?: string;
  mfg: string;
  model: string;
  sn: string;
  flag_key: number;
  flag_automotive: number;
  flag_gold: number;
  year_install?: number | null;
  notes?: string | null;
}

export const GET: RequestHandler = async ({ url }) => {
  try {
    const areas    = url.searchParams.get('areas')    ?? undefined;
    const search   = url.searchParams.get('search')   ?? undefined;
    const key_only = url.searchParams.get('key_only') ?? undefined;

    const data = await mwGet<{ machines: MwInventoryMachine[] }>(
      '/api/v1/inventory/machines',
      { ...(areas ? { area: areas } : {}), ...(key_only ? { key_only } : {}) }
    );

    let machines: MwInventoryMachine[] = data.machines ?? [];

    if (search) {
      const q = search.toLowerCase();
      machines = machines.filter(m =>
        m.machine_id.toLowerCase().includes(q) ||
        m.model.toLowerCase().includes(q) ||
        m.mfg.toLowerCase().includes(q)
      );
    }

    const typed: InventoryMachine[] = machines.map(m => ({
      id:            m.machine_id,
      code_machine:  m.machine_id,
      area:          m.area as MachineArea,
      model:         m.model ?? '',
      manufacturer:  m.mfg ?? '',
      year_install:  m.year_install ?? null,
      is_key:        m.flag_key === 1,
      is_auto:       m.flag_automotive === 1,
      is_gold:       m.flag_gold === 1,
      status:        'Running',
      serial_no:     m.sn ?? null,
      notes:         m.notes ?? null,
    }));

    // Derive KPIs
    const areas_set = new Set(typed.map(m => m.area));
    const kpi: InventoryKpi = {
      total_machines: typed.length,
      key_machines:   typed.filter(m => m.is_key).length,
      areas:          areas_set.size,
      avg_age_years:  0,  // year_install not reliably available from all machines
    };

    return apiResponse({ kpi, machines: typed });
  } catch (err) {
    return apiError(err);
  }
};
