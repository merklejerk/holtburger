import {
	copyFileSync,
	cpSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { verifyElectronPackage } from "../verify-electron-package.mjs";
import {
	distributionKindSchema,
	releaseVersionSchema,
} from "../../src/app/app-build-contract.ts";
import { APP_ROOT, readJson, run, runResult, type Runner } from "./native.ts";
/** Stable application identity used by installer compilation. */
const WINDOWS_APP_ID = "io.github.merklejerk.holtburger-3d";
/** Start-menu identity shared by all distribution versions. */
const WINDOWS_APP_NAME = "Holtburger 3D";
/** Allow macOS disk-image resources to settle without rebuilding the installer. */
export const DMG_VERIFY_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;
/** Bound each verification attempt, including the initial attempt. */
export const DMG_VERIFY_TIMEOUT_MS = 60_000;

/** Retry only macOS's explicit temporary resource refusal; verification remains mandatory. */
export async function verifyDmg(
	destination: string,
	command: typeof runResult = runResult,
	wait: (milliseconds: number) => Promise<void> = setTimeout,
): Promise<void> {
	for (let attempt = 0; ; attempt++) {
		const result = command(
			"hdiutil",
			["verify", destination],
			APP_ROOT,
			DMG_VERIFY_TIMEOUT_MS,
		);
		if (result.exitCode === 0) return;
		const diagnostic = `${result.stdout.toString()}${result.stderr.toString()}`;
		const delay = DMG_VERIFY_RETRY_DELAYS_MS[attempt];
		// Exit status 1 also covers invalid images; only this diagnostic admits a retry.
		if (
			delay === undefined ||
			!result.stderr
				.toString()
				.split(/\r?\n/)
				.includes("hdiutil: verify failed - Resource temporarily unavailable")
		)
			throw new Error(`hdiutil exited ${result.exitCode}: ${diagnostic}`);
		console.warn(
			`${diagnostic.trim()}\nRetrying DMG verification in ${delay} ms.`,
		);
		await wait(delay);
	}
}

/** Native bundle identity used to compile installers. */
const installerInput = z.object({
	/** Only this application has desktop installers. */
	product: z.literal("3d"),
	/** Display and numeric-resource version source. */
	version: releaseVersionSchema,
	/** Source identity compared with the packaged application. */
	commit: z.string().regex(/^[0-9a-f]{40}$/),
	/** Distribution identity admitted from the native bundle. */
	kind: distributionKindSchema,
	/** Supported native installer target. */
	target: z.enum(["x86_64-pc-windows-msvc", "aarch64-apple-darwin"]),
});

/** Windows resource versions have four unsigned 16-bit components, without SemVer labels. */
export function numericVersion(version: string): string {
	releaseVersionSchema.parse(version);
	const parts = version.split("-", 1)[0].split(".");
	if (parts.some((part) => Number(part) > 65535))
		throw new Error("Suite version exceeds Windows installer resource limits");
	return [...parts, "0"].join(".");
}

/** Compile the verified native payload into a Windows installer. */
export function compileWindows(
	appRoot: string,
	native: string,
	version: string,
	destination: string,
	compiler: string,
	command: Runner = run,
): void {
	command(
		compiler,
		[
			"/Qp",
			`/DPayloadDir=${native}`,
			`/DInstallerAppId=${WINDOWS_APP_ID}`,
			`/DDisplayName=${WINDOWS_APP_NAME}`,
			`/DReleaseVersion=${version}`,
			`/DNumericVersion=${numericVersion(version)}`,
			`/DInstallerName=${parse(destination).name}`,
			`/DInstallerDir=${dirname(destination)}`,
			join(appRoot, "packaging/windows.iss"),
		],
		appRoot,
	);
}

/** Preserve release documents and Electron's package-level version marker. */
export function dmgDocuments(native: string): ReadonlyMap<string, string> {
	const documents = [
		...readdirSync(native)
			.filter((name) => name !== "h3d")
			.map((name) => join(native, name)),
		...readdirSync(join(native, "h3d"))
			.filter((name) => name !== "holtburger-3d.app")
			.map((name) => join(native, "h3d", name)),
	];
	const inventory = new Map<string, string>();
	for (const path of documents) {
		if (!lstatSync(path).isFile())
			throw new Error("DMG companion documents must be regular files");
		const name = basename(path);
		if (inventory.has(name))
			throw new Error("DMG companion document names collide");
		inventory.set(name, path);
	}
	return inventory;
}

/** Only the app location is flattened; original documents remain alongside it. */
export function dmgLayout(native: string, staging: string): void {
	cpSync(
		join(native, "h3d/holtburger-3d.app"),
		join(staging, "holtburger-3d.app"),
		{ recursive: true, verbatimSymlinks: true },
	);
	for (const [name, source] of dmgDocuments(native))
		copyFileSync(source, join(staging, name));
	symlinkSync("/Applications", join(staging, "Applications"), "dir");
}

/** Wrap an admitted native bundle; source identity and suite receipts remain the caller's responsibility. */
export async function buildInstaller(
	native: string,
	destination: string,
	compiler: string | undefined,
): Promise<string> {
	const info = installerInput.parse(readJson(join(native, "build-info.json")));
	const platform =
		info.target === "x86_64-pc-windows-msvc" ? "win32" : "darwin";
	if (platform !== process.platform)
		throw new Error("Generate desktop installers on their native platform");
	const packaged = await verifyElectronPackage(join(native, "h3d"));
	if (
		packaged.version !== info.version ||
		packaged.kind !== info.kind ||
		packaged.revision !== info.commit.slice(0, 8)
	)
		throw new Error(
			"Installer input identity differs from the packaged application",
		);
	mkdirSync(dirname(destination), { recursive: true });
	const work = mkdtempSync(join(tmpdir(), "holtburger-installer-"));
	try {
		if (process.platform === "win32") {
			if (compiler === undefined)
				throw new Error("Windows installer generation requires --iscc");
			compileWindows(APP_ROOT, native, info.version, destination, compiler);
		} else {
			const staging = join(work, "dmg");
			mkdirSync(staging);
			dmgLayout(native, staging);
			run(
				"hdiutil",
				[
					"create",
					"-volname",
					"Holtburger 3D",
					"-srcfolder",
					staging,
					"-format",
					"UDZO",
					destination,
				],
				APP_ROOT,
			);
			await verifyDmg(destination);
		}

		if (statSync(destination).size === 0)
			throw new Error("Generated installer is empty");
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	return destination;
}

if (
	process.argv[1] !== undefined &&
	resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	const { values } = parseArgs({
		options: {
			native: { type: "string" },
			output: { type: "string" },
			iscc: { type: "string" },
		},
	});
	await buildInstaller(
		resolve(z.string().min(1).parse(values.native)),
		resolve(z.string().min(1).parse(values.output)),
		values.iscc === undefined ? undefined : resolve(values.iscc),
	);
}
