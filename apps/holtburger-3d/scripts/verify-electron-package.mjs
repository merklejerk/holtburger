#!/usr/bin/env node
import { extractFile, listPackage } from "@electron/asar";
import { constants } from "node:fs";
import { access, readFile, readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));

/** Verify the native host and compiled application payload in one Forge package directory. */
export async function verifyElectronPackage(packageRoot) {
	const normalizedPackageRoot = resolve(packageRoot);
	const resourcesDirectory =
		process.platform === "darwin"
			? join(
					normalizedPackageRoot,
					"holtburger-3d.app",
					"Contents",
					"Resources",
				)
			: join(normalizedPackageRoot, "resources");
	const archivePath = join(resourcesDirectory, "app.asar");
	const licensePath = join(resourcesDirectory, "LICENSE.md");
	const electronNoticeRoot =
		process.platform === "darwin" ? resourcesDirectory : normalizedPackageRoot;
	const hostExecutable =
		process.platform === "win32"
			? "holtburger-3d-host.exe"
			: "holtburger-3d-host";
	const hostPath = join(resourcesDirectory, hostExecutable);

	const hostMetadata = await requireNonEmptyFile(hostPath, constants.X_OK);

	await access(archivePath, constants.R_OK);
	await requireNonEmptyFile(licensePath, constants.R_OK);
	await requireNonEmptyFile(
		join(resourcesDirectory, "icon.png"),
		constants.R_OK,
	);
	if (process.platform === "darwin") {
		await requireNonEmptyFile(
			join(resourcesDirectory, "holtburger.icns"),
			constants.R_OK,
		);
	}
	await requireNonEmptyFile(
		join(electronNoticeRoot, "LICENSE"),
		constants.R_OK,
	);
	await requireNonEmptyFile(
		join(electronNoticeRoot, "LICENSES.chromium.html"),
		constants.R_OK,
	);
	const archiveEntries = new Set(
		listPackage(archivePath, { isPack: false }).map((entry) =>
			entry.replaceAll("\\", "/"),
		),
	);
	for (const requiredEntry of [
		"/package.json",
		"/dist/client/index.html",
		"/dist/explorer/index.html",
		"/dist/favicon.svg",
		"/dist-electron/electron/host-protocol.js",
		"/dist-electron/electron/main.js",
		"/dist-electron/electron/preload.cjs",
		"/dist-electron/scripts/entry-paths.mjs",
	]) {
		if (!archiveEntries.has(requiredEntry)) {
			throw new Error(`packaged ASAR is missing ${requiredEntry}`);
		}
		// ASAR lists absolute-style entries but extracts by archive-relative name.
		if (extractFile(archivePath, requiredEntry.slice(1)).length === 0) {
			throw new Error(`packaged ASAR contains an empty file: ${requiredEntry}`);
		}
	}
	// Compare the source tree, including notices, without maintaining a second font inventory.
	const fontsRoot = join(appRoot, "public/fonts");
	for (const entry of await readdir(fontsRoot, {
		recursive: true,
		withFileTypes: true,
	})) {
		if (!entry.isFile()) continue;
		const sourcePath = join(entry.parentPath, entry.name);
		const archiveEntry = `dist/fonts/${relative(fontsRoot, sourcePath).replaceAll("\\", "/")}`;
		if (!archiveEntries.has(`/${archiveEntry}`)) {
			throw new Error(`packaged ASAR is missing /${archiveEntry}`);
		}
		if (
			!extractFile(archivePath, archiveEntry).equals(await readFile(sourcePath))
		) {
			throw new Error(`packaged ASAR differs from source: /${archiveEntry}`);
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

	return {
		platform: process.platform,
		architecture: process.arch,
		packageRoot: normalizedPackageRoot,
		hostExecutable,
		hostBytes: hostMetadata.size,
		archiveEntryCount: archiveEntries.size,
	};
}

async function requireNonEmptyFile(path, mode) {
	await access(path, mode);
	const metadata = await stat(path);
	if (!metadata.isFile() || metadata.size === 0) {
		throw new Error(`packaged resource is not a non-empty file: ${path}`);
	}
	return metadata;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === scriptPath) {
	const packageRootArgument = process.argv[2];
	if (process.argv.length > 3) {
		throw new Error("usage: verify-electron-package.mjs [package-root]");
	}
	// The optional root lets callers inspect an extracted package through this same contract.
	const packageRoot = packageRootArgument
		? resolve(packageRootArgument)
		: join(appRoot, "out", `holtburger-3d-${process.platform}-${process.arch}`);
	console.log(JSON.stringify(await verifyElectronPackage(packageRoot)));
}
