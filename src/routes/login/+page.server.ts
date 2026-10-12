import { fail, redirect } from '@sveltejs/kit'
import { base } from '$app/paths'
import { env } from '$env/dynamic/private'
import type { Actions } from './$types'

export const actions: Actions = {
  default: async ({ request, cookies }) => {
    const data = await request.formData()
    const badgecode = String(data.get('badgecode') ?? '').trim()
    const password = String(data.get('password') ?? '')

    if (!badgecode || !password) {
      return fail(400, { error: 'กรุณากรอกรหัสพนักงานและรหัสผ่าน' })
    }

    const apiBase = (env.API_BASE_URL ?? 'http://localhost:8090').replace(/\/$/, '')
    const url = `${apiBase}/api/v1/auth/login`

    console.log('[login] calling:', url)

    const ctrl = new AbortController()
    // Microchip API's AD bind can take several seconds — give it (and our
    // backend's own 15s timeout against it) enough room before aborting.
    const timer = setTimeout(() => ctrl.abort(), 20000)

    let res: Response
    try {
      // Use globalThis.fetch to bypass any SvelteKit fetch wrapping
      res = await globalThis.fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': env.API_KEY ?? '',
        },
        body: JSON.stringify({ badgecode, password }),
        signal: ctrl.signal,
      })
    } catch (e: unknown) {
      clearTimeout(timer)
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[login] fetch error:', msg)
      return fail(503, { error: `ติดต่อ server ไม่ได้: ${msg}` })
    } finally {
      clearTimeout(timer)
    }

    console.log('[login] response status:', res.status)

    if (!res.ok) {
      return fail(401, { error: 'รหัสพนักงานหรือรหัสผ่านไม่ถูกต้อง' })
    }

    const json = await res.json()
    const token: string = json.data?.token
    if (!token) {
      return fail(500, { error: 'Login failed — no token received' })
    }

    cookies.set('session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,   // HTTP (no HTTPS) — must be explicit when NODE_ENV=production
      path: '/',
      maxAge: 60 * 60 * 8,
    })

    redirect(302, `${base}/`)
  },
}
