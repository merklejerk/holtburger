#!/usr/bin/env node
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, lstat, readdir, readlink, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { verifyElectronPackage } from "./verify-electron-package.mjs";

const execFile = promisify(execFileCallback);
const appRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const makeDirectory = join(
	appRoot,
	"out",
	"make",
	"zip",
	process.platform,
	process.arch,
);
const archiveEntries = (await readdir(makeDirectory, { withFileTypes: true }))
	.filter((entry) => entry.isFile() && entry.name.endsWith(".zip"))
	.map((entry) => join(makeDirectory, entry.name));

if (archiveEntries.length !== 1) {
	throw new Error(
		`expected exactly one Forge ZIP in ${makeDirectory}, found ${archiveEntries.length}`,
	);
}

const [archivePath] = archiveEntries;
const extractionRoot = await mkdtemp(
	join(tmpdir(), "holtburger-3d-archive-inspection-"),
);

try {
	await extractArchive(archivePath, extractionRoot);
	const packageRoot = extractedPackageRoot(extractionRoot);
	console.log(JSON.stringify(await verifyElectronPackage(packageRoot)));

	if (process.platform === "darwin") {
		await verifyMacFrameworkLinks(packageRoot);
	}

	const archiveMetadata = await stat(archivePath);
	console.log(
		JSON.stringify({
			platform: process.platform,
			architecture: process.arch,
			archive: basename(archivePath),
			archiveBytes: archiveMetadata.size,
		}),
	);
} finally {
	await rm(extractionRoot, { recursive: true, force: true });
}

function extractedPackageRoot(extractionRoot) {
	if (process.platform === "darwin" || process.platform === "win32") {
		return extractionRoot;
	}
	return join(
		extractionRoot,
		`holtburger-3d-${process.platform}-${process.arch}`,
	);
}

async function extractArchive(archivePath, extractionRoot) {
	if (process.platform === "win32") {
		// Environment values avoid reinterpreting drive-letter paths as PowerShell source text.
		await execFile(
			"powershell.exe",
			[
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:HOLTBURGER_ARCHIVE_PATH -DestinationPath $env:HOLTBURGER_EXTRACTION_ROOT",
			],
			{
				env: {
					...process.env,
					HOLTBURGER_ARCHIVE_PATH: archivePath,
					HOLTBURGER_EXTRACTION_ROOT: extractionRoot,
				},
			},
		);
		return;
	}

	await execFile("unzip", ["-q", archivePath, "-d", extractionRoot]);
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
		const metadata = await lstat(linkPath);
		if (!metadata.isSymbolicLink()) {
			throw new Error(`macOS framework path is not a symlink: ${linkPath}`);
		}
		const target = await readlink(linkPath);
		if (target !== expectedTarget) {
			throw new Error(
				`macOS framework link ${linkPath} targets ${target}, expected ${expectedTarget}`,
			);
		}
	}
}
