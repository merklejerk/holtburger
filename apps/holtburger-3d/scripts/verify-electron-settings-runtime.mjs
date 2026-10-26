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
// Cache persistence shares the preview codec; validate that emitted dependency graph as well.
await import(
	new URL(
		"../dist-electron/electron/client-visual-cache-store.js",
		import.meta.url,
	).href
);

// Client close policy and its acknowledgement codec must also survive Node ESM emission.
await import(
	new URL("../dist-electron/electron/client-window-close.js", import.meta.url)
		.href
);

// Startup imports app-local codecs from native code; verify their emitted ESM graph too.
await import(
	new URL("../dist-electron/electron/content-startup.js", import.meta.url).href
);
await import(
	new URL(
		"../dist-electron/electron/content-preference-store.js",
		import.meta.url,
	).href
);

// Theme discovery consumes app-local codecs from Node ESM as well as the renderer.
await import(
	new URL("../dist-electron/electron/ui-theme-catalog.js", import.meta.url).href
);
