#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { isBuiltin, registerHooks } from "node:module";

const emittedRoot = new URL("../dist-electron/", import.meta.url).href;
const { dependencies } = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

// Development installs contain packages that Forge prunes. Reject those imports before
// Node can resolve them locally and give a broken release a passing runtime check.
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (
			context.parentURL?.startsWith(emittedRoot) &&
			!specifier.startsWith(".") &&
			!specifier.startsWith("/") &&
			!URL.canParse(specifier) &&
			!isBuiltin(specifier) &&
			specifier !== "electron"
		) {
			const packageName = specifier.startsWith("@")
				? specifier.split("/").slice(0, 2).join("/")
				: specifier.split("/")[0];
			if (!Object.hasOwn(dependencies, packageName))
				throw new Error(
					`Electron runtime imports undeclared production dependency ${packageName} from ${context.parentURL}`,
				);
		}
		return nextResolve(specifier, context);
	},
});

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
await import(
	new URL(
		"../dist-electron/electron/client-equipment-cache-store.js",
		import.meta.url,
	).href
);

// Client close policy and its acknowledgement codec must also survive Node ESM emission.
await import(
	new URL("../dist-electron/electron/client-retirement.js", import.meta.url)
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

// Launcher persistence and terminal events must remain consumable by Electron's Node runtime.
await import(
	new URL("../dist-electron/electron/app-updates.js", import.meta.url).href
);
await import(
	new URL("../dist-electron/electron/app-settings.js", import.meta.url).href
);
await import(
	new URL("../dist-electron/electron/server-directory.js", import.meta.url).href
);
await import(
	new URL("../dist-electron/electron/launcher-store.js", import.meta.url).href
);
await import(
	new URL(
		"../dist-electron/src/client/client-exit-contract.js",
		import.meta.url,
	).href
);

// Resolved bootstrap defaults must also be consumable from Electron Node ESM.
await import(
	new URL("../dist-electron/src/app/hardware-info-contract.js", import.meta.url)
		.href
);
await import(
	new URL("../dist-electron/electron/client-settings-store.js", import.meta.url)
		.href
);
