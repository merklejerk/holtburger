#!/usr/bin/env node
import { extractFile, listPackage } from "@electron/asar";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import {
	access,
	lstat,
	open,
	readFile,
	readdir,
	readlink,
	stat,
} from "node:fs/promises";
import { join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyMacPackage } from "./mac-package.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
// Mirrors holtburger-weenie-catalog and root scripts/release/content.ts across the standalone app boundary.
export const WEENIE_CATALOG_MAGIC = Buffer.from([
	0x48, 0x42, 0x57, 0x43, 0x41, 0x54, 0x00, 0x1a,
]);
export const WEENIE_CATALOG_FORMAT_VERSION = 11;
export const WEENIE_CATALOG_HEADER_SIZE = 64;

/** Verify the native host and compiled application payload in one Forge package directory. */
export async function verifyElectronPackage(packageRoot) {
	const normalizedPackageRoot = resolve(packageRoot);
	if (process.platform === "win32")
		execFileSync("python", [
			join(appRoot, "scripts/windows_gpu_hints.py"),
			"verify",
			join(normalizedPackageRoot, "holtburger-3d.exe"),
		]);
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
	/** @param {string} entry Archive-relative path; ASAR's index uses native separators. */
	const readArchiveFile = (entry) => extractFile(archivePath, normalize(entry));
	const licensePath = join(resourcesDirectory, "LICENSE.md");
	const electronNoticeRoot =
		process.platform === "darwin" ? resourcesDirectory : normalizedPackageRoot;
	const hostExecutable =
		process.platform === "win32"
			? "holtburger-3d-host.exe"
			: "holtburger-3d-host";
	const hostPath = join(resourcesDirectory, hostExecutable);
	const weenieCatalogPath = join(resourcesDirectory, "weenies.hwc");

	const hostMetadata = await requireNonEmptyFile(hostPath, constants.X_OK);
	const weenieCatalogMetadata = await requireNonEmptyFile(
		weenieCatalogPath,
		constants.R_OK,
	);
	await verifyWeenieCatalogHeader(weenieCatalogPath);
	if (process.env.HOLTBURGER_PACKAGE_WEENIE_CATALOG !== undefined) {
		const expectedCatalog = await readFile(
			resolve(process.env.HOLTBURGER_PACKAGE_WEENIE_CATALOG),
		);
		if (!(await readFile(weenieCatalogPath)).equals(expectedCatalog)) {
			throw new Error(
				"packaged weenies.hwc differs from HOLTBURGER_PACKAGE_WEENIE_CATALOG",
			);
		}
	}

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
		await verifyMacFrameworkLinks(normalizedPackageRoot);
		await verifyMacPackage(normalizedPackageRoot);
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
	const packageMetadata = JSON.parse(
		readArchiveFile("package.json").toString("utf8"),
	);
	for (const name of Object.keys(packageMetadata.dependencies)) {
		const entry = `/node_modules/${name}/package.json`;
		if (!archiveEntries.has(entry))
			throw new Error(`packaged ASAR is missing runtime dependency ${name}`);
	}
	for (const requiredEntry of [
		"/package.json",
		"/dist/client/index.html",
		"/dist/launcher/index.html",
		"/dist/explorer/index.html",
		"/dist/favicon.png",
		"/dist/build-info.json",
		"/dist-electron/electron/host-protocol.js",
		"/dist-electron/electron/main.js",
		"/dist-electron/electron/preload.cjs",
		"/dist-electron/scripts/entry-paths.mjs",
	]) {
		if (!archiveEntries.has(requiredEntry)) {
			throw new Error(`packaged ASAR is missing ${requiredEntry}`);
		}
		// ASAR lists absolute-style entries but extracts by archive-relative name.
		if (readArchiveFile(requiredEntry.slice(1)).length === 0) {
			throw new Error(`packaged ASAR contains an empty file: ${requiredEntry}`);
		}
	}
	const sourcePackage = JSON.parse(
		await readFile(join(appRoot, "package.json"), "utf8"),
	);
	if (packageMetadata.desktopName !== sourcePackage.desktopName)
		throw new Error(
			"Packaged desktop filename differs from the application manifest",
		);
	const buildMetadata = JSON.parse(
		readArchiveFile("dist/build-info.json").toString(),
	);
	const sourceChannel = JSON.parse(
		await readFile(resolve(appRoot, "../../release/channel.json"), "utf8"),
	);
	if (buildMetadata.kind !== (process.env.HOLTBURGER_DISTRIBUTION ?? "release"))
		throw new Error("Packaged distribution kind differs from the build policy");
	if (buildMetadata.channel !== sourceChannel)
		throw new Error("Packaged release channel differs from the source channel");
	if (
		buildMetadata.version !== packageMetadata.version ||
		buildMetadata.development !== false
	)
		throw new Error(
			"Packaged renderer identity does not match the Electron release version",
		);
	if (
		process.env.HOLTBURGER_SOURCE_REVISION !== undefined &&
		buildMetadata.revision !==
			process.env.HOLTBURGER_SOURCE_REVISION.slice(0, 8)
	)
		throw new Error(
			"Packaged renderer revision differs from the release source",
		);
	if (
		process.env.HOLTBURGER_SOURCE_MODIFIED === "0" &&
		buildMetadata.modified !== false
	)
		throw new Error("Packaged renderer was built from modified source");
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
		if (!readArchiveFile(archiveEntry).equals(await readFile(sourcePath))) {
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
		version: buildMetadata.version,
		channel: buildMetadata.channel,
		kind: buildMetadata.kind,
		revision: buildMetadata.revision,
		modified: buildMetadata.modified,
		packageRoot: normalizedPackageRoot,
		hostExecutable,
		hostBytes: hostMetadata.size,
		weenieCatalogBytes: weenieCatalogMetadata.size,
		archiveEntryCount: archiveEntries.size,
	};
}

/** Validate the bundled HWC binary header without duplicating full catalog decoding. */
export async function verifyWeenieCatalogHeader(path) {
	const handle = await open(path, "r");
	const header = Buffer.alloc(WEENIE_CATALOG_HEADER_SIZE);
	try {
		const { bytesRead } = await handle.read(
			header,
			0,
			WEENIE_CATALOG_HEADER_SIZE,
			0,
		);
		if (bytesRead < WEENIE_CATALOG_HEADER_SIZE) {
			throw new Error(`packaged weenie catalog header is truncated: ${path}`);
		}
	} finally {
		await handle.close();
	}
	if (!header.subarray(0, 8).equals(WEENIE_CATALOG_MAGIC)) {
		throw new Error(`packaged weenie catalog has invalid magic: ${path}`);
	}
	const version = header.readUInt32LE(8);
	if (version !== WEENIE_CATALOG_FORMAT_VERSION) {
		throw new Error(
			`packaged weenie catalog format ${version} is unsupported: ${path}`,
		);
	}
	const headerLength = header.readUInt32LE(12);
	if (headerLength !== WEENIE_CATALOG_HEADER_SIZE) {
		throw new Error(
			`packaged weenie catalog header length ${headerLength} is unsupported: ${path}`,
		);
	}
	if (
		!header.subarray(20, 24).equals(Buffer.alloc(4)) ||
		!header.subarray(56, 64).equals(Buffer.alloc(8))
	) {
		throw new Error(
			`packaged weenie catalog reserved header bytes are nonzero: ${path}`,
		);
	}
}

async function requireNonEmptyFile(path, mode) {
	await access(path, mode);
	const metadata = await stat(path);
	if (!metadata.isFile() || metadata.size === 0) {
		throw new Error(`packaged resource is not a non-empty file: ${path}`);
	}
	return metadata;
}

async function verifyMacFrameworkLinks(packageRoot) {
	const frameworkRoot = join(
		packageRoot,
		"holtburger-3d.app",
		"Contents",
		"Frameworks",
		"Electron Framework.framework",
	);
	for (const [relativePath, expectedTarget] of [
		["Versions/Current", "A"],
		["Electron Framework", "Versions/Current/Electron Framework"],
		["Helpers", "Versions/Current/Helpers"],
		["Libraries", "Versions/Current/Libraries"],
		["Resources", "Versions/Current/Resources"],
	]) {
		const linkPath = join(frameworkRoot, relativePath);
		if (!(await lstat(linkPath)).isSymbolicLink())
			throw new Error(`macOS framework path is not a symlink: ${linkPath}`);
		const target = await readlink(linkPath);
		if (target !== expectedTarget)
			throw new Error(
				`macOS framework link ${linkPath} targets ${target}, expected ${expectedTarget}`,
			);
	}
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
