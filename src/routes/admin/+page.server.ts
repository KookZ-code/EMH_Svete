import { env } from '$env/dynamic/private'
import type { PageServerLoad } from './$types'

const API = () => (env.API_BASE_URL ?? 'http://localhost:8090').replace(/\/$/, '')
const headers = () => ({ 'X-API-Key': env.API_KEY ?? '', 'Content-Type': 'application/json' })

export const load: PageServerLoad = async ({ fetch }) => {
  const [usersRes, permsRes] = await Promise.all([
    fetch(`${API()}/api/v1/users`, { headers: headers() }),
    fetch(`${API()}/api/v1/permissions`, { headers: headers() }),
  ])

  const users = usersRes.ok ? (await usersRes.json()).data ?? [] : []
  const permissions = permsRes.ok ? (await permsRes.json()).data ?? {} : {}

  return { users, permissions }
}
