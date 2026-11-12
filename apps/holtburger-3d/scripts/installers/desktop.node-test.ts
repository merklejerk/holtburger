import assert from "node:assert/strict";
import {
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
	DMG_VERIFY_RETRY_DELAYS_MS,
	DMG_VERIFY_TIMEOUT_MS,
} from "./desktop.ts";

const temporaryDmgRefusal = {
	exitCode: 1,
	stdout: Buffer.alloc(0),
	stderr: Buffer.from(
		'hdiutil: verify: unable to recognize "/tmp/image.dmg" as a disk image. (Resource temporarily unavailable)\n' +
			"hdiutil: verify failed - Resource temporarily unavailable\n",
	),
};

test("DMG verification accepts immediate success without waiting", async () => {
	await verifyDmg(
		"image with spaces.dmg",
		(program, args, cwd, timeoutMs) => {
			assert.equal(program, "hdiutil");
			assert.deepEqual(args, ["verify", "image with spaces.dmg"]);
			assert.equal(cwd, APP_ROOT);
			assert.equal(timeoutMs, DMG_VERIFY_TIMEOUT_MS);
			return { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
		},
		async () => assert.fail("Successful verification must not wait"),
	);
});

test("DMG verification recovers after temporary refusals", async () => {
	let attempts = 0;
	const delays: number[] = [];
	await verifyDmg(
		"image.dmg",
		() => {
			attempts++;
			return attempts <= DMG_VERIFY_RETRY_DELAYS_MS.length
				? temporaryDmgRefusal
				: { exitCode: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
		},
		async (delay) => {
			delays.push(delay);
		},
	);
	assert.equal(attempts, DMG_VERIFY_RETRY_DELAYS_MS.length + 1);
	assert.deepEqual(delays, [...DMG_VERIFY_RETRY_DELAYS_MS]);
});

test("DMG verification exhausts its bounded retries and preserves diagnostics", async () => {
	let attempts = 0;
	const delays: number[] = [];
	await assert.rejects(
		verifyDmg(
			"image.dmg",
			() => {
				attempts++;
				return temporaryDmgRefusal;
			},
			async (delay) => {
				delays.push(delay);
			},
		),
		{
			message: `hdiutil exited ${temporaryDmgRefusal.exitCode}: ${temporaryDmgRefusal.stderr.toString()}`,
		},
	);
	assert.equal(attempts, DMG_VERIFY_RETRY_DELAYS_MS.length + 1);
	assert.deepEqual(delays, [...DMG_VERIFY_RETRY_DELAYS_MS]);
});

test("DMG verification immediately rejects permanent failures, even after a temporary refusal", async () => {
	let attempts = 0;
	const delays: number[] = [];
	await assert.rejects(
		verifyDmg(
			"image.dmg",
			() => {
				attempts++;
				return attempts === 1
					? temporaryDmgRefusal
					: {
							exitCode: 1,
							stdout: Buffer.from("checksum mismatch\n"),
							stderr: Buffer.from(
								"hdiutil: verify failed - image data corrupted\n",
							),
						};
			},
			async (delay) => {
				delays.push(delay);
			},
		),
		/exited 1: checksum mismatch\nhdiutil: verify failed - image data corrupted/,
	);
	assert.equal(attempts, 2);
	assert.deepEqual(delays, DMG_VERIFY_RETRY_DELAYS_MS.slice(0, 1));
});

test("DMG verification propagates execution failures without retrying", async () => {
	const timeout = new Error("ETIMEDOUT");
	await assert.rejects(
		verifyDmg(
			"image.dmg",
			() => {
				throw timeout;
			},
			async () => assert.fail("Execution failures must not wait"),
		),
		(error) => error === timeout,
	);
});

test("Windows compilation uses the native payload and distribution version", () => {
	compileWindows(
		APP_ROOT,
		"payload with spaces",
		"0.2.1-nightly-abcdef12",
		"output/setup.exe",
		"ISCC.exe",
		(program, args, cwd) => {
			assert.equal(program, "ISCC.exe");
			assert.ok(args.includes("/DPayloadDir=payload with spaces"));
			assert.ok(args.includes("/DReleaseVersion=0.2.1-nightly-abcdef12"));
			assert.ok(args.includes("/DNumericVersion=0.2.1.0"));
			assert.equal(cwd, APP_ROOT);
			return "";
		},
	);
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
		writeFileSync(join(native, "version"), "collision");
		assert.throws(() => dmgDocuments(native), /collide/);
		rmSync(join(native, "version"));
		symlinkSync("build-info.json", join(native, "linked"));
		assert.throws(() => dmgDocuments(native), /regular files/);
	},
);

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
