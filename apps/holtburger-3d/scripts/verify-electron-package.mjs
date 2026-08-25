#!/usr/bin/env node
import { listPackage } from "@electron/asar";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const packageRoot = join(
	appRoot,
	"out",
	`holtburger-3d-${process.platform}-${process.arch}`,
);
const resourcesDirectory =
	process.platform === "darwin"
		? join(packageRoot, "holtburger-3d.app", "Contents", "Resources")
		: join(packageRoot, "resources");
const archivePath = join(resourcesDirectory, "app.asar");
const hostExecutable =
	process.platform === "win32"
		? "holtburger-3d-host.exe"
		: "holtburger-3d-host";
const hostPath = join(resourcesDirectory, hostExecutable);

await access(hostPath, constants.X_OK);
const hostMetadata = await stat(hostPath);
if (!hostMetadata.isFile() || hostMetadata.size === 0) {
	throw new Error(`packaged host is not a non-empty file: ${hostPath}`);
}

await access(archivePath, constants.R_OK);
const archiveEntries = new Set(listPackage(archivePath, { isPack: false }));
for (const requiredEntry of [
	"/package.json",
	"/dist/client/index.html",
	"/dist/explorer/index.html",
	"/dist-electron/electron/host-protocol.js",
	"/dist-electron/electron/main.js",
	"/dist-electron/electron/preload.cjs",
	"/dist-electron/scripts/entry-paths.mjs",
]) {
	if (!archiveEntries.has(requiredEntry)) {
		throw new Error(`packaged ASAR is missing ${requiredEntry}`);
	}
}
if (
	![...archiveEntries].some(
		(entry) => entry.startsWith("/dist/assets/") && entry.endsWith(".js"),
	)
) {
	throw new Error("packaged ASAR contains no compiled frontend JavaScript");
}
for (const forbiddenEntry of [
	"/electron/main.ts",
	"/scripts/electron-dev-entry.mjs",
	"/src/explorer/main.ts",
]) {
	if (archiveEntries.has(forbiddenEntry)) {
		throw new Error(
			`packaged ASAR retained source-only entry ${forbiddenEntry}`,
		);
	}
}

console.log(
	JSON.stringify({
		platform: process.platform,
		architecture: process.arch,
		packageRoot,
		hostExecutable,
		hostBytes: hostMetadata.size,
		archiveEntryCount: archiveEntries.size,
	}),
);
