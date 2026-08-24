#!/usr/bin/env node
/**
 * Reduce the CEF distribution that `cef-dll-sys` downloaded to what this app ships.
 *
 * Three reductions, all applied by default so a development tree matches a shipped bundle. A
 * runtime that differs between the two is how a performance or driver problem hides until release.
 *
 * 1. Strip `libcef.so`. CEF's Linux `minimal` archive is a Release build, but the library ships
 *    with DWARF attached: roughly 1.15 GB of debug sections inside 1.4 GB. Stripping leaves
 *    ~249 MB with every `cef_*` dynamic symbol intact. Windows keeps debug info in separate `.pdb`
 *    files and macOS in `.dSYM` bundles, so neither platform needs this.
 * 2. Keep only the locales this app ships. The full set is 220 files and ~48 MB.
 * 3. Remove the SwiftShader software rasterizer. A client that cannot reach the GPU should fail
 *    visibly rather than fall back to a software path that merely looks like a performance bug.
 *
 * Both cache and per-profile copies are processed, because a cached build script does not re-run
 * to propagate a change made in the cache alone.
 *
 * Removal is one way: `cef-dll-sys` only re-downloads when the version directory is missing
 * entirely. To restore the full distribution, delete `<CEF_PATH>/<version>/` and build again.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, join, resolve } from "node:path";

/** Locales this app ships. Anything else is removed from the distribution. */
const DEFAULT_LOCALES = ["en-US"];

/** Software rasterizer payload, removed together so no ICD points at a missing library. */
const SWIFTSHADER_FILES = ["libvk_swiftshader.so", "vk_swiftshader_icd.json"];

const workspaceRoot = resolve(
	fileURLToPath(new URL("../../../", import.meta.url)),
);
const options = parseArgs(process.argv.slice(2));

if (process.platform !== "linux") {
	console.info(
		`Nothing to do on ${process.platform}: only the Linux CEF distribution ships unstripped.`,
	);
	process.exit(0);
}

const libraries = [...findCacheLibraries(), ...findProfileLibraries()].filter(
	(path) => path !== null,
);

if (libraries.length === 0) {
	console.error(
		"Found no libcef.so. Build once first so cef-dll-sys downloads the distribution.",
	);
	process.exit(1);
}

let reclaimed = 0;
for (const library of libraries) {
	const directory = join(library, "..");
	reclaimed += stripLibrary(library);
	reclaimed += trimLocales(join(directory, "locales"));
	if (!options.keepSwiftShader) {
		reclaimed += removeSwiftShader(directory);
	}
}

console.info(`\nReclaimed ${megabytes(reclaimed)}.`);
console.info(
	`Kept locales: ${options.locales.join(", ")}. SwiftShader ${
		options.keepSwiftShader ? "kept" : "removed"
	}.`,
);

/** The shared distribution, whose layout is `<CEF_PATH>/<version>/<os-arch>/`. */
function findCacheLibraries() {
	const root = process.env.CEF_PATH
		? resolve(process.env.CEF_PATH)
		: join(workspaceRoot, ".cef-cache");
	return directoriesIn(root)
		.flatMap((version) => directoriesIn(version))
		.map((osArch) => existingFile(join(osArch, "libcef.so")));
}

/** Copies the build script places beside each profile's binary so the loader can find them. */
function findProfileLibraries() {
	return directoriesIn(join(workspaceRoot, "target")).map((profile) =>
		existingFile(join(profile, "libcef.so")),
	);
}

function stripLibrary(path) {
	const before = statSync(path).size;
	// `--strip-unneeded` keeps `.dynsym`, which is what callers link against, and additionally drops
	// symbols no relocation references.
	const result = spawnSync("strip", ["--strip-unneeded", path], {
		encoding: "utf8",
	});
	if (result.error) {
		throw new Error(`Could not run strip: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`strip failed for ${path}: ${result.stderr.trim() || `exit ${result.status}`}`,
		);
	}
	const after = statSync(path).size;
	console.info(
		`${path}\n  libcef.so ${megabytes(before)} -> ${megabytes(after)}${
			before === after ? " (already stripped)" : ""
		}`,
	);
	return before - after;
}

function trimLocales(directory) {
	if (!isDirectory(directory)) return 0;
	let reclaimed = 0;
	let removed = 0;
	for (const name of readdirSync(directory)) {
		if (options.locales.includes(basename(name, ".pak"))) continue;
		const path = join(directory, name);
		reclaimed += statSync(path).size;
		rmSync(path);
		removed += 1;
	}
	if (removed > 0) {
		console.info(
			`  locales   removed ${removed} files, ${megabytes(reclaimed)}`,
		);
	}
	return reclaimed;
}

function removeSwiftShader(directory) {
	let reclaimed = 0;
	for (const name of SWIFTSHADER_FILES) {
		const path = join(directory, name);
		if (!existingFile(path)) continue;
		reclaimed += statSync(path).size;
		rmSync(path);
	}
	if (reclaimed > 0) {
		console.info(`  swiftshader removed, ${megabytes(reclaimed)}`);
	}
	return reclaimed;
}

function parseArgs(args) {
	let locales = DEFAULT_LOCALES;
	let keepSwiftShader = false;
	for (const arg of args) {
		if (arg === "--keep-swiftshader") {
			keepSwiftShader = true;
			continue;
		}
		if (arg.startsWith("--locales=")) {
			locales = arg
				.slice("--locales=".length)
				.split(",")
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0);
			if (locales.length === 0) {
				throw new Error(
					"--locales needs at least one locale, for example en-US.",
				);
			}
			continue;
		}
		throw new Error(
			`Unknown argument "${arg}". Expected --locales=<list> or --keep-swiftshader.`,
		);
	}
	return { keepSwiftShader, locales };
}

function directoriesIn(path) {
	if (!isDirectory(path)) return [];
	return readdirSync(path)
		.map((name) => join(path, name))
		.filter((entry) => isDirectory(entry));
}

function existingFile(path) {
	try {
		return statSync(path).isFile() ? path : null;
	} catch {
		return null;
	}
}

function isDirectory(path) {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function megabytes(bytes) {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
