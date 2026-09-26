import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import svg from "@poppanator/sveltekit-svg";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		svelte(),
		// Keep editor-authored artwork intact and leave cursor/nameplate asset loading alone.
		svg({
			includePaths: [resolve(rootDir, "src/assets/icons")],
			svgoOptions: false,
		}),
	],
	// Electron loads built entries from disk; assets must resolve beside those entries.
	base: "./",
	build: {
		rolldownOptions: {
			input: {
				client: resolve(rootDir, "client/index.html"),
				explorer: resolve(rootDir, "explorer/index.html"),
				browserHarness: resolve(rootDir, "harness/browser/index.html"),
			},
		},
	},
	server: {
		host: "127.0.0.1",
		port: 1420,
		strictPort: true,
	},
	test: {
		environment: "node",
		include: [
			"src/**/*.test.ts",
			"electron/**/*.test.ts",
			"scripts/**/*.test.ts",
		],
	},
});
