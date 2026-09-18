#!/usr/bin/env node

// TypeScript's bundler resolution accepts extensionless imports that Node ESM cannot load from
// emitted Electron code. Import the shared settings codec exactly as Electron main does so the
// build fails before launch when its runtime dependency graph is not Node-resolvable.
await import(
	new URL(
		"../dist-electron/src/client/client-settings-contract.js",
		import.meta.url,
	).href
);
