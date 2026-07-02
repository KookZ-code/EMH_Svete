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
		allowedHosts: 'all',
		proxy: {
			'/testSvelte/api': {
				target: 'http://127.0.0.1:8002',
				changeOrigin: true,
				// Strip /testSvelte prefix; add /v1/ only if not already present
				rewrite: (path) => {
					const stripped = path.replace(/^\/testSvelte/, '');
					return stripped.startsWith('/api/v1') ? stripped : stripped.replace(/^\/api/, '/api/v1');
				},
				configure: noCompression,
			},
			'/api': {
				target: 'http://127.0.0.1:8002',
				changeOrigin: true,
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
