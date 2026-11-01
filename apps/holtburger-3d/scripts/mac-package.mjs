import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sign } from "@electron/osx-sign";
import { z } from "zod";

/** Written after signing the host and before sealing the app, including Forge's app-only ZIP. */
export const MAC_HOST_PROVENANCE_FILE =
	"Contents/Resources/host-provenance.json";
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const provenanceSchema = z.strictObject({
	sourceHostSha256: digestSchema,
	packagedHostSha256: digestSchema,
});

/** Hash the actual file bytes, including any embedded code signature. @param {string} path */
async function digest(path) {
	return createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
}

/**
 * Sign the final app after all resources have been copied, without a publisher certificate.
 * @param {string} packageRoot
 * @param {string} sourceHost
 */
export async function sealMacPackage(packageRoot, sourceHost) {
	const app = resolve(packageRoot, "holtburger-3d.app");
	const host = join(app, "Contents/Resources/holtburger-3d-host");
	const sourceHostSha256 = await digest(sourceHost);
	if ((await digest(host)) !== sourceHostSha256)
		throw new Error("Packaged Mac host differs from its unsigned Cargo input");
	// Record the incoming signature and publisher-policy state before replacing it.
	// Nonzero assessment results are evidence here; final integrity checks below are fatal.
	/** @type {[string, string[]][]} Native diagnostic commands; their exit status is recorded, not accepted. */
	const diagnostics = [
		["codesign", ["-d", "--verbose=4", app]],
		["codesign", ["--verify", "--deep", "--strict", app]],
		["spctl", ["--assess", "--type", "execute", "--verbose=4", app]],
	];
	for (const [command, args] of diagnostics) {
		const result = spawnSync(command, args, { encoding: "utf8" });
		if (result.error) throw result.error;
		console.log(
			JSON.stringify({
				phase: "before-mac-seal",
				command,
				args,
				exitCode: result.status,
				diagnostic: result.stdout + result.stderr,
			}),
		);
	}
	// Finish this standalone Rust executable first so its receipt can itself be
	// sealed. It does not need Electron's JIT entitlements or a publisher certificate.
	execFileSync("codesign", [
		"--force",
		"--sign",
		"-",
		"--timestamp=none",
		host,
	]);
	await writeFile(
		join(app, MAC_HOST_PROVENANCE_FILE),
		JSON.stringify(
			{ sourceHostSha256, packagedHostSha256: await digest(host) },
			null,
			2,
		) + "\n",
	);
	await sign({
		app,
		platform: "darwin",
		identity: "-",
		identityValidation: false,
		preAutoEntitlements: false,
		preEmbedProvisioningProfile: false,
		// Do not change the host after recording its final signed digest.
		ignore: (file) => file === host,
		optionsForFile: () => ({
			timestamp: "none",
			hardenedRuntime: false,
			entitlements: ["com.apple.security.cs.allow-jit"],
		}),
	});
	await verifyMacPackage(packageRoot);
}

/** Verify integrity separately from Gatekeeper's publisher-trust assessment. @param {string} packageRoot */
export async function verifyMacPackage(packageRoot) {
	const app = resolve(packageRoot, "holtburger-3d.app");
	const host = join(app, "Contents/Resources/holtburger-3d-host");
	const provenance = provenanceSchema.parse(
		JSON.parse(await readFile(join(app, MAC_HOST_PROVENANCE_FILE), "utf8")),
	);
	if ((await digest(host)) !== provenance.packagedHostSha256)
		throw new Error("Packaged Mac host differs from its signing provenance");
	const seal = await stat(join(app, "Contents/_CodeSignature/CodeResources"));
	if (!seal.isFile() || seal.size === 0)
		throw new Error("Mac application has no bundle resource seal");
	for (const path of [app, host])
		execFileSync("codesign", [
			"--verify",
			"--deep",
			"--strict",
			"--verbose=2",
			path,
		]);
	return provenance;
}
