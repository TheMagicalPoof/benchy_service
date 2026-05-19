import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		dedupe: ['three']
	},
	server: {
		proxy: {
			'/api': 'http://127.0.0.1:8080'
		}
	}
});
