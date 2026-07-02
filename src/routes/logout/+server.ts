import { redirect } from '@sveltejs/kit'
import { base } from '$app/paths'
import type { RequestHandler } from './$types'

export const POST: RequestHandler = ({ cookies }) => {
  cookies.delete('session', { path: '/' })
  redirect(302, `${base}/login`)
}
