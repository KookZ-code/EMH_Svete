// See https://kit.svelte.dev/docs/types#app
import type { SessionUser } from '$lib/types'

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user: SessionUser | null
		}
		interface PageData {
			user: SessionUser | null
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
