import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { LauncherStore } from "../dist-electron/electron/launcher-store.js";

const [operation, suppliedRoot] = process.argv.slice(2);
if (!["seed", "verify"].includes(operation) || !suppliedRoot)
	throw new Error(
		"Usage: installer-profile.mjs seed|verify <owned-profile-root>",
	);
const root = resolve(suppliedRoot);
const appName = JSON.parse(
	await readFile(new URL("../package.json", import.meta.url), "utf8"),
).name;
const profile = join(root, appName);
const marker = join(root, "upgrade-fixture.json");
const userFile = join(profile, "user-owned.txt");
await mkdir(profile, { recursive: true });
// Construct real settings through their owner, so fixture schemas cannot drift independently.
const store = new LauncherStore(join(profile, "launcher-settings.json"), {
	normalBounds: { width: 967, height: 733 },
	maximized: false,
});
await store.load();
if (operation === "seed") {
	const server = {
		id: randomUUID(),
		name: "Installer retained server",
		contentPath: null,
		endpoint: { host: "retained.invalid", port: 9 },
	};
	const preset = {
		id: randomUUID(),
		name: "Installer retained profile",
		serverId: server.id,
		credentials: { account: "upgrade-probe", password: "synthetic-password" },
	};
	await store.saveServer(server);
	await store.saveProfile(preset);
	await writeFile(marker, JSON.stringify({ server, preset }));
	await writeFile(userFile, "Retained across upgrade and uninstall\n");
	console.log(JSON.stringify({ serverName: server.name }));
} else {
	const fixture = JSON.parse(await readFile(marker, "utf8"));
	const snapshot = store.snapshot(null, true);
	assert.equal(snapshot.failure, null);
	assert.deepEqual(
		snapshot.servers.find((item) => item.id === fixture.server.id),
		fixture.server,
	);
	assert.equal(
		snapshot.profiles.find((item) => item.id === fixture.preset.id)
			?.credentialStatus,
		"saved",
	);
	assert.deepEqual(
		store.credentials({
			serverId: fixture.server.id,
			profileId: fixture.preset.id,
		}),
		fixture.preset.credentials,
	);
	assert.equal(
		await readFile(userFile, "utf8"),
		"Retained across upgrade and uninstall\n",
	);
	console.log(
		JSON.stringify({
			retainedServer: true,
			retainedCredentials: true,
			retainedUserFile: true,
		}),
	);
}
