import { redirect } from '@sveltejs/kit'
import { base } from '$app/paths'
import type { Handle } from '@sveltejs/kit'
import { verifyJwt } from '$lib/server/jwt'
import { getPermissions } from '$lib/server/permissions'

const LOGIN_PATH = `${base}/login`

export const handle: Handle = async ({ event, resolve }) => {
  const { pathname } = event.url
  // strip base prefix to get relative path
  const rel = base ? pathname.slice(base.length) || '/' : pathname

  // Login and 403 pages — always allow. /403 must be exempt too, otherwise a
  // non-admin user denied some path gets redirected to /403, which itself
  // fails the same permission check (it's not in any role's allowed-path
  // list) and redirects to /403 again — an infinite loop.
  if (rel === '/login' || rel.startsWith('/login/')) {
    return resolve(event)
  }
  if (rel === '/403' || rel.startsWith('/403/')) {
    const token = event.cookies.get('session')
    const user = token ? verifyJwt(token) : null
    if (user) event.locals.user = user
    return resolve(event)
  }

  const token = event.cookies.get('session')
  const user = token ? verifyJwt(token) : null
  console.log('[hooks] path:', rel, 'token:', !!token, 'user:', user?.username ?? 'none')

  if (!user) {
    if (token) event.cookies.delete('session', { path: '/' })
    redirect(302, LOGIN_PATH)
  }

  // Admin: full access
  if (user.role === 'admin') {
    event.locals.user = user
    return resolve(event)
  }

  // Non-admin: block /admin
  if (rel.startsWith('/admin')) {
    redirect(302, `${base}/403`)
  }

  // API routes bypass permission check
  if (rel.startsWith('/api/')) {
    event.locals.user = user
    return resolve(event)
  }

  // Check dynamic permissions from DB (cached 60s)
  const perms = await getPermissions(user.role)
  const allowed = perms.some(p => rel === p || rel.startsWith(p + '/'))
  if (!allowed) {
    redirect(302, `${base}/403`)
  }

  event.locals.user = user
  return resolve(event)
}
