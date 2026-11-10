import {
	copyFileSync,
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, parse, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { fileURLToPath } from "node:url";
import { digest, verifyPayload } from "../../../../scripts/filesystem.ts";
import { verifyElectronPackage } from "../verify-electron-package.mjs";
import {
	distributionKindSchema,
	releaseVersionSchema,
	SOURCE_REVISION_LENGTH,
} from "../../src/app/app-build-contract.ts";
import {
	APP_ROOT,
	readJson,
	run,
	runResult,
	type Runner,
	type CommandResult,
} from "./native.ts";
import {
	registration,
	WINDOWS_APP_ID,
	WINDOWS_APP_NAME,
	withDeleteLock,
} from "./windows-native.ts";

/** App facts used by compilation and installation-order probes. */
const installerInput = z.object({
	/** Only this application has desktop installers. */
	product: z.literal("3d"),
	/** Display and numeric-resource version source. */
	version: releaseVersionSchema,
	/** Source identity used to exercise alternate nightly installation. */
	commit: z.string().regex(/^[0-9a-f]{40}$/),
	/** Chooses the alternate distribution used by the installer probe. */
	kind: distributionKindSchema,
	/** Supported native installer target. */
	target: z.enum(["x86_64-pc-windows-msvc", "aarch64-apple-darwin"]),
});
/** Admitted facts are carried into probes without reading metadata again. */
type InstallerInput = z.infer<typeof installerInput>;

/** Windows resource versions have four unsigned 16-bit components, without SemVer labels. */
export function numericVersion(version: string): string {
	releaseVersionSchema.parse(version);
	const parts = version.split("-", 1)[0].split(".");
	if (parts.some((part) => Number(part) > 65535))
		throw new Error("Suite version exceeds Windows installer resource limits");
	return [...parts, "0"].join(".");
}

/** Use the same installation recipe for published installers and uncompressed test fixtures. */
export function compileWindows(
	appRoot: string,
	native: string,
	version: string,
	destination: string,
	compiler: string,
	purpose: "distribution" | "fixture",
	command: Runner = run,
): void {
	command(
		compiler,
		[
			"/Qp",
			...(purpose === "fixture" ? ["/DFixtureInstaller"] : []),
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

/** Always detach a mounted image, including after a failed installed-app probe. */
export async function withMountedDmg<T>(
	image: string,
	mount: string,
	operation: (mount: string) => T | Promise<T>,
): Promise<T> {
	mkdirSync(mount);
	run(
		"hdiutil",
		["attach", "-readonly", "-nobrowse", "-mountpoint", mount, image],
		APP_ROOT,
	);
	try {
		return await operation(mount);
	} finally {
		run("hdiutil", ["detach", mount], APP_ROOT);
	}
}

/** Check the DMG, then replace the whole installed app to remove obsolete files. */
export function verifyDmg(
	appRoot: string,
	native: string,
	mounted: string,
	installed: string,
	command: Runner = run,
): void {
	const documents = dmgDocuments(native),
		expected = [
			...documents.keys(),
			"holtburger-3d.app",
			"Applications",
		].sort();
	if (JSON.stringify(readdirSync(mounted).sort()) !== JSON.stringify(expected))
		throw new Error("DMG contains unexpected or missing entries");
	const shortcut = join(mounted, "Applications");
	if (
		!lstatSync(shortcut).isSymbolicLink() ||
		readlinkSync(shortcut) !== "/Applications"
	)
		throw new Error("DMG Applications shortcut is incorrect");
	verifyPayload(
		join(native, "h3d/holtburger-3d.app"),
		join(mounted, "holtburger-3d.app"),
	);
	for (const [name, source] of documents)
		if (digest(source) !== digest(join(mounted, name)))
			throw new Error(`DMG document differs from its native input: ${name}`);
	const app = join(installed, "h3d/holtburger-3d.app");
	rmSync(app, { recursive: true, force: true });
	mkdirSync(dirname(app), { recursive: true });
	command("ditto", [join(mounted, "holtburger-3d.app"), app], appRoot);
	for (const [name, source] of documents)
		copyFileSync(
			join(mounted, name),
			join(installed, relative(native, source)),
		);
	verifyPayload(native, installed);
}

/** The app's settings owner seeds and checks retained credentials and user data. */
function profileFixture(
	appRoot: string,
	operation: "seed" | "verify",
	profile: string,
): unknown {
	return JSON.parse(
		run("node", ["scripts/installer-profile.mjs", operation, profile], appRoot),
	);
}

/** Real installed startup must load the retained server and leave its profile intact. */
function probeInstalled(
	appRoot: string,
	executable: string,
	profile: string,
	server: string,
): void {
	const result = runResult(
		"node",
		[
			"scripts/content-startup-probe.mjs",
			"--package",
			executable,
			"--profile-root",
			profile,
			"--expected-server",
			server,
		],
		appRoot,
		180_000,
	);
	requireSuccess(result, "Installed application startup");
	profileFixture(appRoot, "verify", profile);
}

/** Keep native diagnostics visible when a silent operation fails. */
function requireSuccess(result: CommandResult, label: string): void {
	if (result.exitCode !== 0)
		throw new Error(
			`${label} exited ${result.exitCode}: ${result.stdout.toString()}${result.stderr.toString()}`,
		);
}

/** Exercise setup, repair, upgrades, locks and uninstall only in a disposable account. */
async function verifyWindowsInstaller(
	appRoot: string,
	native: string,
	installer: string,
	compiler: string,
	work: string,
	info: InstallerInput,
): Promise<void> {
	if (
		process.env.GITHUB_ACTIONS !== "true" &&
		process.env.HOLTBURGER_DISPOSABLE_INSTALL_TESTS !== "1"
	)
		throw new Error(
			"Windows installation tests require a disposable CI account or HOLTBURGER_DISPOSABLE_INSTALL_TESTS=1",
		);
	if (registration(appRoot) !== null)
		throw new Error(
			"Refusing to test over an existing Holtburger installation",
		);
	const shortcut = join(
		z.string().parse(process.env.APPDATA),
		"Microsoft/Windows/Start Menu/Programs",
		`${WINDOWS_APP_NAME}.lnk`,
	);
	if (existsSync(shortcut))
		throw new Error(
			"Refusing to overwrite an existing Holtburger Start menu shortcut",
		);
	const install = join(work, "installed application with spaces"),
		payload = join(install, "payload"),
		uninstaller = join(install, "unins000.exe"),
		profile = join(work, "retained profile");
	const { serverName } = z
		.object({ serverName: z.string() })
		.parse(profileFixture(appRoot, "seed", profile));
	const logs = join(dirname(dirname(installer)), "installer-logs");
	mkdirSync(logs, { recursive: true });
	const runInstaller = (program: string, options: readonly string[]) => {
		const log = join(logs, `operation-${randomUUID()}.log`);
		const result = runResult(
			program,
			[
				"/VERYSILENT",
				"/SUPPRESSMSGBOXES",
				"/NORESTART",
				...options,
				`/LOG=${log}`,
			],
			appRoot,
			180_000,
		);
		if (result.exitCode !== 0 && existsSync(log))
			console.log(readFileSync(log, "utf8").replace(/^\uFEFF/, ""));
		return result;
	};
	const setup = (
		program: string,
		selectDestination: boolean,
		version: string,
	) => {
		requireSuccess(
			runInstaller(program, selectDestination ? [`/DIR=${install}`] : []),
			"Installer",
		);
		verifyPayload(native, payload);
		const entry = registration(appRoot);
		if (entry === null)
			throw new Error("Installer did not register its application");
		if (resolve(entry.location) !== install)
			throw new Error(
				"Installer registry location differs from its destination",
			);
		if (entry.version !== version)
			throw new Error("Installer registry version differs from its payload");
		if (!statSync(shortcut).isFile())
			throw new Error("Installer did not create its Start menu shortcut");
		probeInstalled(
			appRoot,
			join(payload, "h3d/holtburger-3d.exe"),
			profile,
			serverName,
		);
	};
	try {
		setup(installer, true, info.version);
		requireSuccess(runInstaller(uninstaller, []), "Uninstaller");
		profileFixture(appRoot, "verify", profile);
		if (existsSync(payload) || existsSync(shortcut))
			throw new Error("Uninstall left owned program files or shortcut");
		const previous = join(work, "predecessor payload"),
			predecessor = join(work, "predecessor.exe");
		cpSync(native, previous, { recursive: true, verbatimSymlinks: true });
		writeFileSync(join(previous, "obsolete-upgrade-fixture.txt"), "obsolete");
		compileWindows(
			appRoot,
			previous,
			"0.0.0",
			predecessor,
			compiler,
			"fixture",
		);
		requireSuccess(
			runInstaller(predecessor, [`/DIR=${install}`]),
			"Predecessor installer",
		);
		verifyPayload(previous, payload);
		probeInstalled(
			appRoot,
			join(payload, "h3d/holtburger-3d.exe"),
			profile,
			serverName,
		);
		setup(installer, false, info.version);
		writeFileSync(join(payload, "QUICKSTART.md"), "damaged repair fixture");
		writeFileSync(join(payload, "obsolete-repair-fixture.txt"), "obsolete");
		setup(installer, false, info.version);
		const base = info.version.split("-", 1)[0],
			alternateVersion =
				info.kind === "release"
					? `${base}-nightly-${info.commit.slice(0, SOURCE_REVISION_LENGTH)}`
					: base,
			alternate = join(work, "alternate-distribution.exe");
		compileWindows(
			appRoot,
			native,
			alternateVersion,
			alternate,
			compiler,
			"fixture",
		);
		setup(alternate, false, alternateVersion);
		setup(installer, false, info.version);
		for (const executable of [
			"h3d/holtburger-3d.exe",
			"h3d/resources/holtburger-3d-host.exe",
		])
			for (const [program, options, label] of [
				[installer, [`/DIR=${install}`], "Installer"],
				[uninstaller, [], "Uninstaller"],
			] as const) {
				await withDeleteLock(appRoot, join(payload, executable), () => {
					if (runInstaller(program, options).exitCode === 0)
						throw new Error(`${label} accepted a locked payload`);
				});
				verifyPayload(native, payload);
			}
	} finally {
		if (existsSync(uninstaller))
			requireSuccess(runInstaller(uninstaller, []), "Final uninstaller");
	}
	profileFixture(appRoot, "verify", profile);
	if (existsSync(payload) || existsSync(shortcut))
		throw new Error("Final uninstall left owned program files or shortcut");
	if (registration(appRoot) !== null)
		throw new Error("Uninstall retained its application registration");
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
			compileWindows(
				APP_ROOT,
				native,
				info.version,
				destination,
				compiler,
				"distribution",
			);
			await verifyWindowsInstaller(
				APP_ROOT,
				native,
				destination,
				compiler,
				work,
				info,
			);
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
			run("hdiutil", ["verify", destination], APP_ROOT);
			await withMountedDmg(
				destination,
				join(work, "mounted"),
				async (mounted) => {
					const installed = join(work, "installed"),
						profile = join(work, "retained profile");
					verifyDmg(APP_ROOT, native, mounted, installed);
					await verifyElectronPackage(join(installed, "h3d"));
					const { serverName } = z
						.object({ serverName: z.string() })
						.parse(profileFixture(APP_ROOT, "seed", profile));
					const app = join(installed, "h3d/holtburger-3d.app"),
						executable = join(app, "Contents/MacOS/holtburger-3d");
					probeInstalled(APP_ROOT, executable, profile, serverName);
					const icon = join(app, "Contents/Resources/icon.png");
					writeFileSync(
						icon,
						Buffer.concat([
							readFileSync(icon),
							Buffer.from("tampered resource"),
						]),
					);
					if (
						runResult(
							"codesign",
							["--verify", "--deep", "--strict", app],
							APP_ROOT,
						).exitCode === 0
					)
						throw new Error(
							"Mac signature verification accepted a changed sealed resource",
						);
					writeFileSync(
						join(app, "Contents/Resources/obsolete-upgrade-fixture.txt"),
						"obsolete",
					);
					verifyDmg(APP_ROOT, native, mounted, installed);
					await verifyElectronPackage(join(installed, "h3d"));
					probeInstalled(APP_ROOT, executable, profile, serverName);
					const assessment = runResult(
						"spctl",
						["--assess", "--type", "execute", "--verbose=4", app],
						APP_ROOT,
					);
					console.log(
						JSON.stringify({
							gatekeeperExitCode: assessment.exitCode,
							gatekeeperDiagnostic:
								assessment.stdout.toString() + assessment.stderr.toString(),
						}),
					);
					rmSync(app, { recursive: true });
					profileFixture(APP_ROOT, "verify", profile);
				},
			);
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
