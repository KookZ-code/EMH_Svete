// Server-only: cache role permissions from backend (TTL 60s)
import { env } from '$env/dynamic/private'

let cache: Record<string, { paths: string[]; ts: number }> = {}

export async function getPermissions(role: string): Promise<string[]> {
  const now = Date.now()
  if (cache[role] && now - cache[role].ts < 60_000) return cache[role].paths

  try {
    const base = (env.API_BASE_URL ?? 'http://localhost:8090').replace(/\/$/, '')
    const res = await fetch(`${base}/api/v1/permissions`, {
      headers: { 'X-API-Key': env.API_KEY ?? '' },
    })
    if (!res.ok) return cache[role]?.paths ?? []

    const json = await res.json()
    const data: Record<string, string[]> = json.data ?? {}
    for (const r of Object.keys(data)) {
      cache[r] = { paths: data[r], ts: now }
    }
  } catch {
    // on error return stale cache or empty
  }

  return cache[role]?.paths ?? []
}

export function invalidatePermissionsCache() {
  cache = {}
}
