import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sign } from "@electron/osx-sign";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
	MAC_HOST_PROVENANCE_FILE,
	sealMacPackage,
	verifyMacPackage,
} from "./mac-package.mjs";

vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));
vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
	spawnSync: vi.fn(() => ({ status: 1, stdout: "", stderr: "synthetic unsigned app" })),
}));
const directories: string[] = [];

/** Synthetic bytes exercise provenance; actual signature validity is a native CI check. */
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "mac-package-test-"));
	directories.push(root);
	const app = join(root, "holtburger-3d.app");
	const host = join(app, "Contents/Resources/holtburger-3d-host");
	const source = join(root, "cargo-host");
	await mkdir(join(app, "Contents/Resources"), { recursive: true });
	await mkdir(join(app, "Contents/_CodeSignature"), { recursive: true });
	await writeFile(join(app, "Contents/_CodeSignature/CodeResources"), "seal");
	await writeFile(source, "cargo output");
	await writeFile(host, "cargo output");
	vi.mocked(execFileSync).mockImplementation((_command, args) => {
		if (Array.isArray(args) && args[0] === "--force")
			writeFileSync(host, "signed cargo output");
		return Buffer.alloc(0);
	});
	return { root, app, host, source };
}

afterEach(async () => {
	vi.clearAllMocks();
	await Promise.all(
		directories.splice(0).map((path) => rm(path, { recursive: true })),
	);
});

it("binds changed signed host bytes to the original Cargo input", async () => {
	const { root, source, app, host } = await fixture();
	await sealMacPackage(root, source);
	const record = JSON.parse(
		await readFile(join(app, MAC_HOST_PROVENANCE_FILE), "utf8"),
	);
	expect(record.sourceHostSha256).not.toEqual(record.packagedHostSha256);
	expect(await verifyMacPackage(root)).toEqual(record);
	expect(execFileSync).toHaveBeenCalledWith("codesign", [
		"--verify",
		"--deep",
		"--strict",
		"--verbose=2",
		app,
	]);
	expect(execFileSync).toHaveBeenCalledWith("codesign", [
		"--verify",
		"--deep",
		"--strict",
		"--verbose=2",
		host,
	]);
});

it("refuses a different unsigned host before signing it", async () => {
	const { root, source, host } = await fixture();
	await writeFile(host, "different build");
	await expect(sealMacPackage(root, source)).rejects.toThrow(
		"unsigned Cargo input",
	);
	expect(sign).not.toHaveBeenCalled();
});

it("rejects later host mutation and native signature rejection", async () => {
	const { root, source, host } = await fixture();
	await sealMacPackage(root, source);
	await writeFile(host, "mutated");
	await expect(verifyMacPackage(root)).rejects.toThrow("signing provenance");
	await writeFile(host, "signed cargo output");
	vi.mocked(execFileSync).mockImplementation(() => {
		throw new Error("sealed resource is missing or invalid");
	});
	await expect(verifyMacPackage(root)).rejects.toThrow("sealed resource");
});
