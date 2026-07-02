// Server-only: verify JWT using Node.js crypto (reliable in SvelteKit/Node context)
import { createHmac, timingSafeEqual } from 'crypto'
import { env } from '$env/dynamic/private'
import type { SessionUser } from '$lib/types'

interface JwtPayload {
  sub:          string
  id:           number
  display_name: string
  role:         string
  exp:          number
}

function b64urlDecode(s: string): Buffer {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
  return Buffer.from(b64, 'base64')
}

export function verifyJwt(token: string): SessionUser | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [headerB64, payloadB64, sigB64] = parts
    const secret = env.JWT_SECRET ?? 'emh-dashboard-jwt-secret-2026'

    // Recompute HMAC-SHA256 signature
    const expected = createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url')

    // Timing-safe comparison
    console.log('[jwt] expected sig:', expected)
    console.log('[jwt] token sig:   ', sigB64)
    if (expected.length !== sigB64.length) {
      console.log('[jwt] length mismatch:', expected.length, 'vs', sigB64.length)
      return null
    }
    const a = Buffer.from(expected)
    const b = Buffer.from(sigB64)
    if (!timingSafeEqual(a, b)) {
      console.log('[jwt] signature mismatch')
      return null
    }

    // Decode payload
    const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8')) as JwtPayload

    // Check expiry
    if (payload.exp < Math.floor(Date.now() / 1000)) return null

    return {
      id:          payload.id,
      username:    payload.sub,
      displayName: payload.display_name,
      role:        payload.role as SessionUser['role'],
    }
  } catch (e) {
    console.error('[verifyJwt] error:', e)
    return null
  }
}
