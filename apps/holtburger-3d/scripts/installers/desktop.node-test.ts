import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
	readlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { APP_ROOT, run, runResult } from "./native.ts";
import {
	dmgDocuments,
	dmgLayout,
	compileWindows,
	numericVersion,
	verifyDmg,
} from "./desktop.ts";
import { withDeleteLock } from "./windows-native.ts";

test("fixture compilation passes its selector without changing the installer identity or payload", () => {
	const calls: { args: readonly string[]; cwd: string }[] = [];
	for (const purpose of ["distribution", "fixture"] as const)
		compileWindows(
			APP_ROOT,
			"payload with spaces",
			"0.2.1-nightly-abcdef12",
			"output/setup.exe",
			"ISCC.exe",
			purpose,
			(program, args, cwd) => {
				assert.equal(program, "ISCC.exe");
				calls.push({ args, cwd });
				return "";
			},
		);
	assert.equal(calls[0].args.includes("/DFixtureInstaller"), false);
	assert.equal(calls[1].args.includes("/DFixtureInstaller"), true);
	assert.deepEqual(
		calls[1].args.filter((arg) => arg !== "/DFixtureInstaller"),
		calls[0].args,
	);
	assert.ok(calls[0].args.includes("/DPayloadDir=payload with spaces"));
	assert.ok(calls[0].args.includes("/DReleaseVersion=0.2.1-nightly-abcdef12"));
	assert.ok(calls[0].args.includes("/DNumericVersion=0.2.1.0"));
	assert.equal(calls[0].cwd, APP_ROOT);
	assert.equal(calls[1].cwd, APP_ROOT);
});

test("installer resources keep SemVer display separate from unsigned 16-bit numeric version", () => {
	assert.equal(numericVersion("0.2.1"), "0.2.1.0");
	assert.equal(numericVersion("0.2.1-nightly-abcdef12"), "0.2.1.0");
	assert.throws(() => numericVersion("65536.0.0"), /limits/);
	assert.throws(() => numericVersion("0.2.1+metadata"), /metadata/);
});

test(
	"DMG flattens the app while retaining all documents and refuses colliding or linked documents",
	{ skip: process.platform === "win32" },
	(t) => {
		const root = mkdtempSync(join(tmpdir(), "holtburger-dmg-")),
			native = join(root, "native"),
			staging = join(root, "staging");
		t.after(() => rmSync(root, { recursive: true, force: true }));
		mkdirSync(join(native, "h3d/holtburger-3d.app/Contents"), {
			recursive: true,
		});
		mkdirSync(staging);
		writeFileSync(join(native, "build-info.json"), "{}");
		writeFileSync(join(native, "h3d/version"), "0.2.1");
		writeFileSync(join(native, "h3d/holtburger-3d.app/Contents/test"), "app");
		dmgLayout(native, staging);
		assert.equal(readFileSync(join(staging, "version"), "utf8"), "0.2.1");
		assert.equal(readlinkSync(join(staging, "Applications")), "/Applications");
		assert.equal(
			readFileSync(join(staging, "holtburger-3d.app/Contents/test"), "utf8"),
			"app",
		);
		const installed = join(root, "installed");
		const ditto = (program: string, args: readonly string[]) => {
			assert.equal(program, "ditto");
			cpSync(args[0], args[1], { recursive: true, verbatimSymlinks: true });
			return "";
		};
		verifyDmg(APP_ROOT, native, staging, installed, ditto);
		writeFileSync(
			join(installed, "h3d/holtburger-3d.app/Contents/obsolete"),
			"obsolete",
		);
		verifyDmg(APP_ROOT, native, staging, installed, ditto);
		writeFileSync(join(staging, "holtburger-3d.app/Contents/test"), "changed");
		assert.throws(
			() => verifyDmg(APP_ROOT, native, staging, installed, ditto),
			/payload file differs/,
		);
		writeFileSync(join(native, "version"), "collision");
		assert.throws(() => dmgDocuments(native), /collide/);
		rmSync(join(native, "version"));
		symlinkSync("build-info.json", join(native, "linked"));
		assert.throws(() => dmgDocuments(native), /regular files/);
	},
);

test("owned Windows lock helper waits for readiness and releases on success or callback failure", async () => {
	for (const fail of [false, true]) {
		let child: ReturnType<typeof spawn> | undefined;
		const operation = withDeleteLock(
			APP_ROOT,
			"fixture",
			() => {
				if (fail) throw new Error("probe failure");
				return 42;
			},
			() => {
				const launched = spawn(
					process.execPath,
					[
						"--eval",
						'console.log("locked");process.stdin.resume();process.stdin.on("end",()=>process.exit(0));',
					],
					{ stdio: "pipe" },
				);
				child = launched;
				return launched;
			},
		);
		if (fail) await assert.rejects(operation, /probe failure/);
		else assert.equal(await operation, 42);
		assert.equal(child?.exitCode, 0);
	}
});

test("owned Windows lock helper rejects early exit, startup timeout and failed cleanup", async () => {
	let called = false;
	await assert.rejects(
		withDeleteLock(
			APP_ROOT,
			"fixture",
			() => {
				called = true;
			},
			() =>
				spawn(process.execPath, ["--eval", "process.exit(2)"], {
					stdio: "pipe",
				}),
		),
		/exited 2/,
	);
	assert.equal(called, false);
	await assert.rejects(
		withDeleteLock(
			APP_ROOT,
			"fixture",
			() => {
				called = true;
			},
			() =>
				spawn(
					process.execPath,
					[
						"--eval",
						'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));',
					],
					{ stdio: "pipe" },
				),
			1_000,
		),
		/startup timed out/,
	);
	await assert.rejects(
		withDeleteLock(
			APP_ROOT,
			"fixture",
			() => {},
			() =>
				spawn(
					process.execPath,
					[
						"--eval",
						'console.log("locked");process.stdin.resume();process.stdin.on("end",()=>process.exit(3));',
					],
					{ stdio: "pipe" },
				),
		),
		/exited 3/,
	);
});

test("native installer commands retain diagnostics and distinguish refusal from execution failure", () => {
	const result = runResult(
		process.execPath,
		[
			"--eval",
			'process.stdout.write(Buffer.from([0,255]));process.stderr.write("refused");process.exit(19)',
		],
		APP_ROOT,
	);
	assert.equal(result.exitCode, 19);
	assert.deepEqual(result.stdout, Buffer.from([0, 255]));
	assert.equal(result.stderr.toString(), "refused");
	assert.throws(
		() =>
			run(
				process.execPath,
				["--eval", 'process.stderr.write("refused");process.exit(19)'],
				APP_ROOT,
			),
		/exited 19: refused/,
	);
	assert.throws(
		() =>
			runResult(
				process.execPath,
				["--eval", "setInterval(()=>{},1000)"],
				APP_ROOT,
				50,
			),
		/ETIMEDOUT/,
	);
});
