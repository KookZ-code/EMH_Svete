import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

function noCompression(proxy: import('http-proxy').Server) {
	proxy.on('proxyReq', (proxyReq) => {
		proxyReq.removeHeader('Accept-Encoding');
		proxyReq.setHeader('Accept-Encoding', 'identity');
	});
}

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		host: true,
		port: 5173,
		allowedHosts: ['.', 'localhost', 'mth-lt-b04469a'],
		proxy: {
			'/testSvelte/api': {
				target: 'http://127.0.0.1:8090',
				changeOrigin: true,
				// Routes with their own +server.ts merge/aggregation logic must reach SvelteKit
				// instead of being proxied straight to the backend, or that logic never runs in dev.
				bypass: (req) => /^\/testSvelte\/api\/(overview(\/open-jobs)?|utilization\/detail|downtime\/(detail|events)|live\/machines|inventory|machines(\/detail)?|techs\/scores|da\/(packages|report)|wb\/(packages|report))/.test(req.url ?? '') ? req.url : undefined,
				// Strip /testSvelte prefix; add /v1/ only if not already present
				rewrite: (path) => {
					const stripped = path.replace(/^\/testSvelte/, '');
					return stripped.startsWith('/api/v1') ? stripped : stripped.replace(/^\/api/, '/api/v1');
				},
				configure: noCompression,
			},
			'/api': {
				target: 'http://127.0.0.1:8090',
				changeOrigin: true,
				bypass: (req) => /^\/api\/(overview(\/open-jobs)?|utilization\/detail|downtime\/(detail|events)|live\/machines|inventory|machines(\/detail)?|techs\/scores|da\/(packages|report)|wb\/(packages|report))/.test(req.url ?? '') ? req.url : undefined,
				// Add /v1/ only if not already present
				rewrite: (path) => path.startsWith('/api/v1') ? path : path.replace(/^\/api/, '/api/v1'),
				configure: noCompression,
			},
		},
	},
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
	},
});
