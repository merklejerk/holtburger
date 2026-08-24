#!/usr/bin/env node
/**
 * Shrink the CEF distribution that `cef-dll-sys` downloaded.
 *
 * CEF's Linux `minimal` archive is a Release build, but its `libcef.so` ships with DWARF attached:
 * roughly 1.15 GB of debug sections inside a 1.4 GB file. Stripping them leaves ~249 MB with every
 * `cef_*` dynamic symbol intact. Windows keeps debug info in separate `.pdb` files and macOS in
 * separate `.dSYM` bundles, so neither needs this.
 *
 * Idempotent, and safe to run whenever a build has repopulated the cache. Strips both the cache
 * (`CEF_PATH`, see .cargo/config.toml) and the per-profile copies the build script places beside
 * the binary in `target/`, because a cached build script does not re-run to propagate the change.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const workspaceRoot = resolve(
	fileURLToPath(new URL("../../../", import.meta.url)),
);

/** Locale files to retain, or null to keep all of them. */
const keptLocales = parseLocales(process.argv.slice(2));

if (process.platform !== "linux") {
	console.info(
		`Nothing to do on ${process.platform}: only the Linux CEF distribution ships unstripped.`,
	);
	process.exit(0);
}

const targets = [...findCacheLibraries(), ...findProfileLibraries()].filter(
	Boolean,
);

if (targets.length === 0) {
	console.error(
		"Found no libcef.so. Build once first so cef-dll-sys downloads the distribution.",
	);
	process.exit(1);
}

let reclaimed = 0;
for (const path of targets) {
	reclaimed += stripLibrary(path);
}
if (keptLocales) {
	for (const directory of findLocaleDirectories()) {
		reclaimed += trimLocales(directory);
	}
}

console.info(`\nReclaimed ${megabytes(reclaimed)}.`);
if (!keptLocales) {
	console.info(
		"Locales were left alone. Pass --locales=en-US,... to drop the rest; the full set is ~48 MB\n" +
			"across 220 files, which matters for a shipped bundle rather than for a build tree.",
	);
}

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

function findLocaleDirectories() {
	return [...findCacheLibraries(), ...findProfileLibraries()]
		.map((library) => join(library, "..", "locales"))
		.filter((directory) => isDirectory(directory));
}

function stripLibrary(path) {
	const before = statSync(path).size;
	// `--strip-unneeded` keeps `.dynsym`, which is what callers link against; a plain `strip` would
	// also do, but this additionally drops symbols no relocation references.
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
		`${path}\n  ${megabytes(before)} -> ${megabytes(after)}${
			before === after ? " (already stripped)" : ""
		}`,
	);
	return before - after;
}

function trimLocales(directory) {
	let reclaimed = 0;
	let removed = 0;
	for (const name of readdirSync(directory)) {
		const locale = name.replace(/\.pak$/, "");
		if (keptLocales.includes(locale)) continue;
		const path = join(directory, name);
		reclaimed += statSync(path).size;
		removed += 1;
		spawnSync("rm", ["-f", path]);
	}
	if (removed > 0) {
		console.info(`${directory}\n  removed ${removed} locale files`);
	}
	return reclaimed;
}

function parseLocales(args) {
	const flag = args.find((arg) => arg.startsWith("--locales="));
	if (!flag) return null;
	const value = flag.slice("--locales=".length);
	const locales = value
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
	if (locales.length === 0) {
		throw new Error("--locales needs at least one locale, for example en-US.");
	}
	return locales;
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
