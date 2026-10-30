import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { LauncherStore } from "./launcher-store";
import { encryptCredentials, decryptCredentials } from "./launcher-credentials";

const directories: string[] = [];
const geometry = {
	normalBounds: { width: 900, height: 650 },
	maximized: false,
};
async function setup() {
	const directory = await mkdtemp(join(tmpdir(), "h3d-launcher-test-"));
	directories.push(directory);
	const path = join(directory, "launcher-settings.json");
	const store = new LauncherStore(path, geometry);
	await store.load();
	const server = {
		id: randomUUID(),
		name: "Test",
		endpoint: { host: "test.local", port: 9000 },
	};
	const profile = {
		id: randomUUID(),
		name: "Account",
		serverId: server.id,
		credentials: { account: "secret-account", password: "secret-password" },
	};
	return { store, path, server, profile };
}
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});
describe("launcher credentials", () => {
	it("round-trips empty passwords, randomizes envelopes, and rejects changed tags/profile association", () => {
		const id = randomUUID();
		const credentials = { account: "test", password: "" };
		const first = encryptCredentials(id, credentials);
		const second = encryptCredentials(id, credentials);
		expect(first.nonce).not.toBe(second.nonce);
		expect(decryptCredentials(id, first)).toEqual(credentials);
		expect(() => decryptCredentials(randomUUID(), first)).toThrow();
		expect(() => decryptCredentials(id, { ...first, version: 2 })).toThrow(
			"version is unsupported",
		);
		expect(() =>
			decryptCredentials(id, {
				...first,
				authenticationTag: Buffer.from(
					Buffer.from(first.authenticationTag, "base64").map(
						(byte) => byte ^ 1,
					),
				).toString("base64"),
			}),
		).toThrow();
	});
});
describe("independent launcher persistence", () => {
	it("keeps profile-free credentials isolated by server and independent of named profiles", async () => {
		const app = await setup();
		const other = {
			...app.server,
			id: randomUUID(),
			endpoint: { host: "other.local", port: 9000 },
		};
		await app.store.saveServer(app.server);
		await app.store.saveServer(other);
		await app.store.saveProfile(app.profile);
		const first = { account: "default-first", password: "first-secret" };
		const second = { account: "default-second", password: "" };
		for (const [serverId, credentials] of [
			[app.server.id, first],
			[other.id, second],
		] as const)
			await app.store.select({ serverId, profileId: null, credentials });
		await app.store.select({
			serverId: app.server.id,
			profileId: app.profile.id,
			credentials: app.profile.credentials,
		});
		await app.store.saveServer({ ...app.server, name: "Renamed" });
		expect(
			app.store.credentials({ serverId: app.server.id, profileId: null }),
		).toEqual(first);
		expect(
			app.store.credentials({ serverId: other.id, profileId: null }),
		).toEqual(second);
		expect(
			app.store.credentials({
				serverId: app.server.id,
				profileId: app.profile.id,
			}),
		).toEqual(app.profile.credentials);
		await expect(
			app.store.select({
				serverId: other.id,
				profileId: app.profile.id,
				credentials: first,
			}),
		).rejects.toThrow("different server");
		expect(() =>
			app.store.credentials({ serverId: other.id, profileId: app.profile.id }),
		).toThrow("different server");
		await app.store.select({
			serverId: app.server.id,
			profileId: null,
			credentials: second,
		});
		expect(
			app.store.credentials({ serverId: app.server.id, profileId: null }),
		).toEqual(second);
		await app.store.deleteServer(other.id);
		const saved = JSON.parse(await readFile(app.path, "utf8"));
		expect(Object.keys(saved.serverCredentials)).toEqual([app.server.id]);
		const envelope = saved.serverCredentials[app.server.id];
		expect(() => decryptCredentials(`server:${other.id}`, envelope)).toThrow();
		expect(() => decryptCredentials(app.profile.id, envelope)).toThrow();
	});
	it("migrates version-three catalogs without altering profiles or per-server selections", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		await app.store.saveProfile(app.profile);
		await app.store.select({
			serverId: app.server.id,
			profileId: app.profile.id,
			credentials: app.profile.credentials,
		});
		const saved = JSON.parse(await readFile(app.path, "utf8"));
		delete saved.serverCredentials;
		saved.version = 3;
		await writeFile(app.path, JSON.stringify(saved));
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		expect(reopened.snapshot(null, true).lastProfileByServer).toEqual(
			saved.lastProfileByServer,
		);
		expect(
			reopened.credentials({ serverId: app.server.id, profileId: null }),
		).toBeNull();
		expect(
			reopened.credentials({
				serverId: app.server.id,
				profileId: app.profile.id,
			}),
		).toEqual(app.profile.credentials);
	});
	it("surfaces damaged profile-free credentials and rejects credentials for unknown servers", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		const saved = JSON.parse(await readFile(app.path, "utf8"));
		saved.serverCredentials[app.server.id] = encryptCredentials(
			"wrong-owner",
			app.profile.credentials,
		);
		await writeFile(app.path, JSON.stringify(saved));
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		expect(reopened.snapshot(null, true).recoveryRequired).toBe(false);
		expect(() =>
			reopened.credentials({ serverId: app.server.id, profileId: null }),
		).toThrow();
		await reopened.select({
			serverId: app.server.id,
			profileId: null,
			credentials: app.profile.credentials,
		});
		expect(
			reopened.credentials({ serverId: app.server.id, profileId: null }),
		).toEqual(app.profile.credentials);
		saved.serverCredentials[randomUUID()] = encryptCredentials(
			"unknown",
			app.profile.credentials,
		);
		await writeFile(app.path, JSON.stringify(saved));
		const invalid = new LauncherStore(app.path, geometry);
		await invalid.load();
		expect(invalid.snapshot(null, true).recoveryRequired).toBe(true);
	});
	it("persists server launch recency across restarts without promoting metadata edits or new servers", async () => {
		const app = await setup();
		const second = {
			...app.server,
			id: randomUUID(),
			name: "Second",
			endpoint: { host: "second.local", port: 9000 },
		};
		const unused = {
			...app.server,
			id: randomUUID(),
			name: "Unused",
			endpoint: { host: "unused.local", port: 9000 },
		};
		for (const server of [app.server, second, unused])
			await app.store.saveServer(server);
		await app.store.saveProfile(app.profile);
		await app.store.select({
			serverId: second.id,
			profileId: null,
			credentials: app.profile.credentials,
		});
		await app.store.select({
			serverId: app.server.id,
			profileId: app.profile.id,
			credentials: app.profile.credentials,
		});
		await app.store.saveServer({ ...unused, name: "Renamed" });
		const importedId = await app.store.importServer({
			name: "Imported",
			endpoint: { host: "imported.local", port: 9000 },
		});
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		expect(
			reopened.snapshot(null, true).servers.map((server) => server.id),
		).toEqual([app.server.id, second.id, unused.id, importedId]);
		expect(reopened.snapshot(null, true).lastSelection?.serverId).toBe(
			app.server.id,
		);
		await reopened.select({
			serverId: second.id,
			profileId: null,
			credentials: app.profile.credentials,
		});
		expect(
			reopened.snapshot(null, true).servers.map((server) => server.id),
		).toEqual([second.id, app.server.id, unused.id, importedId]);
		await reopened.deleteServer(second.id);
		expect(
			reopened.snapshot(null, true).servers.map((server) => server.id),
		).toEqual([app.server.id, unused.id, importedId]);
	});
	it("remembers each server's last launched profile across reopen, metadata edits, and profile-free launches", async () => {
		const app = await setup();
		const other = {
			...app.server,
			id: randomUUID(),
			endpoint: { host: "other.local", port: 9000 },
		};
		const second = { ...app.profile, id: randomUUID(), name: "Second" };
		const otherProfile = {
			...app.profile,
			id: randomUUID(),
			serverId: other.id,
		};
		await app.store.saveServer(app.server);
		await app.store.saveServer(other);
		for (const profile of [app.profile, second, otherProfile])
			await app.store.saveProfile(profile);
		for (const profile of [app.profile, second, otherProfile])
			await app.store.select({
				serverId: profile.serverId,
				profileId: profile.id,
				credentials: profile.credentials,
			});
		await app.store.saveServer({ ...app.server, name: "Renamed" });
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		expect(reopened.snapshot(null, true).lastProfileByServer).toEqual({
			[app.server.id]: second.id,
			[other.id]: otherProfile.id,
		});
		await reopened.select({
			serverId: app.server.id,
			profileId: null,
			credentials: app.profile.credentials,
		});
		expect(reopened.snapshot(null, true).lastProfileByServer).toEqual({
			[app.server.id]: null,
			[other.id]: otherProfile.id,
		});
		await reopened.deleteProfile(otherProfile.id);
		expect(
			reopened.snapshot(null, true).lastProfileByServer[other.id],
		).toBeNull();
		await reopened.deleteServer(other.id);
		expect(reopened.snapshot(null, true).lastProfileByServer).toEqual({
			[app.server.id]: null,
		});
	});
	it("upgrades version-two selection to per-server memory without changing encrypted credentials", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		await app.store.saveProfile(app.profile);
		const saved = JSON.parse(await readFile(app.path, "utf8"));
		await writeFile(
			app.path,
			JSON.stringify({
				version: 2,
				servers: saved.servers,
				profiles: saved.profiles,
				window: {
					...geometry,
					normalBounds: { ...geometry.normalBounds, x: 250, y: 350 },
				},
				lastSelection: { serverId: app.server.id, profileId: app.profile.id },
			}),
		);
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		expect(reopened.window).toEqual(geometry);
		expect(reopened.snapshot(null, true).lastProfileByServer).toEqual({
			[app.server.id]: app.profile.id,
		});
		expect(
			reopened.credentials({
				serverId: app.server.id,
				profileId: app.profile.id,
			}),
		).toEqual(app.profile.credentials);
		await reopened.updateWindow(geometry);
		expect(JSON.parse(await readFile(app.path, "utf8")).profiles).toEqual(
			saved.profiles,
		);
	});
	it("requires recovery for remembered choices with unknown servers or profiles belonging to another server", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		await app.store.saveProfile(app.profile);
		const other = {
			...app.server,
			id: randomUUID(),
			endpoint: { host: "other.local", port: 9000 },
		};
		await app.store.saveServer(other);
		const saved = JSON.parse(await readFile(app.path, "utf8"));
		for (const lastProfileByServer of [
			{ [randomUUID()]: null },
			{ [other.id]: app.profile.id },
		]) {
			await writeFile(
				app.path,
				JSON.stringify({ ...saved, lastProfileByServer }),
			);
			const reopened = new LauncherStore(app.path, geometry);
			await reopened.load();
			expect(reopened.snapshot(null, true).recoveryRequired).toBe(true);
		}
	});
	it("adds a directory server immediately and preserves existing profiles and credentials on duplicates", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		await app.store.saveProfile(app.profile);
		const before = JSON.parse(await readFile(app.path, "utf8"));
		expect(
			await app.store.importServer({
				name: "Directory label",
				endpoint: {
					host: app.server.endpoint.host.toUpperCase(),
					port: app.server.endpoint.port,
				},
			}),
		).toBeNull();
		expect(JSON.parse(await readFile(app.path, "utf8"))).toEqual(before);
		const candidate = {
			name: "New server",
			endpoint: { host: "new.example.org", port: 9050 },
		};
		const id = await app.store.importServer(candidate);
		expect(id).toEqual(expect.any(String));
		const after = JSON.parse(await readFile(app.path, "utf8"));
		expect(after.profiles).toEqual(before.profiles);
		expect(after.servers).toEqual([app.server, { ...candidate, id }]);
		expect(
			await app.store.importServer({
				...candidate,
				endpoint: { ...candidate.endpoint, host: "NEW.EXAMPLE.ORG" },
			}),
		).toBeNull();
		await expect(
			app.store.importServer({
				name: "Broken",
				endpoint: { host: "bad", port: 0 },
			}),
		).rejects.toThrow();
		expect(JSON.parse(await readFile(app.path, "utf8"))).toEqual(after);
	});
	it("persists encrypted credentials and selection across reopen without exposing secret envelopes", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		await app.store.saveProfile(app.profile);
		expect(
			await app.store.select({
				serverId: app.server.id,
				profileId: app.profile.id,
				credentials: app.profile.credentials,
			}),
		).toMatchObject({
			account: "secret-account",
			password: "secret-password",
			host: "test.local",
		});
		await app.store.flush();
		const source = await readFile(app.path, "utf8");
		expect(source).not.toContain("secret-account");
		expect(source).not.toContain("secret-password");
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		expect(reopened.snapshot(null, true).profiles).toEqual([
			{
				id: app.profile.id,
				name: "Account",
				serverId: app.server.id,
				credentialStatus: "saved",
			},
		]);
		expect(reopened.snapshot(null, true).lastSelection).toEqual({
			serverId: app.server.id,
			profileId: app.profile.id,
		});
		expect(
			reopened.credentials({
				serverId: app.server.id,
				profileId: app.profile.id,
			}),
		).toEqual(app.profile.credentials);
		await reopened.saveProfile({
			...app.profile,
			credentials: { account: "updated-account", password: "" },
		});
		expect(
			reopened.credentials({
				serverId: app.server.id,
				profileId: app.profile.id,
			}),
		).toEqual({
			account: "updated-account",
			password: "",
		});
		const overwritten = await readFile(app.path, "utf8");
		expect(overwritten).not.toContain("updated-account");
	});
	it("encrypts profile-free credentials and restores them with the server across reopen", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		const credentials = {
			account: "unsaved-account",
			password: "unsaved-password",
		};
		await expect(
			app.store.select({
				serverId: app.server.id,
				profileId: null,
				credentials,
			}),
		).resolves.toEqual({ ...app.server.endpoint, ...credentials });
		const text = await readFile(app.path, "utf8");
		expect(text).not.toContain("unsaved-account");
		expect(text).not.toContain("unsaved-password");
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		expect(reopened.snapshot(null, true)).toMatchObject({
			profiles: [],
			lastSelection: { serverId: app.server.id, profileId: null },
		});
		expect(
			reopened.credentials({ serverId: app.server.id, profileId: null }),
		).toEqual(credentials);
	});
	it("uses current credentials without overwriting a selected profile and validates its server association", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		await app.store.saveProfile(app.profile);
		const before = JSON.parse(await readFile(app.path, "utf8")).profiles;
		const credentials = {
			account: "one-time-account",
			password: "one-time-password",
		};
		await expect(
			app.store.select({
				serverId: app.server.id,
				profileId: app.profile.id,
				credentials,
			}),
		).resolves.toMatchObject(credentials);
		expect(JSON.parse(await readFile(app.path, "utf8")).profiles).toEqual(
			before,
		);
		expect(
			app.store.credentials({
				serverId: app.server.id,
				profileId: app.profile.id,
			}),
		).toEqual(app.profile.credentials);
		const other = {
			...app.server,
			id: randomUUID(),
			endpoint: { host: "different.local", port: app.server.endpoint.port },
		};
		await app.store.saveServer(other);
		await expect(
			app.store.select({
				serverId: other.id,
				profileId: app.profile.id,
				credentials,
			}),
		).rejects.toThrow("different server");
		expect(() =>
			app.store.saveProfile({
				...app.profile,
				credentials: { account: "", password: "" },
			}),
		).toThrow();
	});
	it("upgrades version-one selection metadata without changing encrypted profiles, including incomplete legacy presets", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		await app.store.saveProfile(app.profile);
		const saved = JSON.parse(await readFile(app.path, "utf8"));
		const catalog = {
			servers: saved.servers,
			profiles: saved.profiles,
			window: saved.window,
		};
		const incomplete = {
			...saved.profiles[0],
			id: randomUUID(),
			name: "Incomplete",
			credentials: null,
		};
		const legacy = {
			...catalog,
			version: 1,
			lastProfileId: app.profile.id,
			profiles: [...saved.profiles, incomplete],
		};
		await writeFile(app.path, JSON.stringify(legacy));
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		expect(reopened.snapshot(null, true).lastSelection).toEqual({
			serverId: app.server.id,
			profileId: app.profile.id,
		});
		expect(
			reopened.credentials({
				serverId: app.server.id,
				profileId: app.profile.id,
			}),
		).toEqual(app.profile.credentials);
		expect(
			reopened.credentials({
				serverId: app.server.id,
				profileId: incomplete.id,
			}),
		).toBeNull();
		await reopened.updateWindow(geometry);
		const upgraded = JSON.parse(await readFile(app.path, "utf8"));
		expect(upgraded.version).toBe(4);
		expect(upgraded.profiles).toEqual(legacy.profiles);
		await reopened.deleteProfile(app.profile.id);
		expect(reopened.snapshot(null, true).lastSelection).toEqual({
			serverId: app.server.id,
			profileId: null,
		});
		await reopened.saveProfile({
			id: incomplete.id,
			name: incomplete.name,
			serverId: app.server.id,
			credentials: app.profile.credentials,
		});
		expect(reopened.snapshot(null, true).profiles[0]?.credentialStatus).toBe(
			"saved",
		);
	});
	it("preserves saved credentials through server renames and endpoint edits, and removes profiles on deletion", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		await app.store.saveProfile(app.profile);
		const originalProfiles = JSON.parse(
			await readFile(app.path, "utf8"),
		).profiles;
		await app.store.saveServer({ ...app.server, name: "Renamed" });
		expect(app.store.snapshot(null, true).profiles[0]?.credentialStatus).toBe(
			"saved",
		);
		await app.store.saveServer({
			...app.server,
			endpoint: { host: "other.local", port: 9050 },
		});
		expect(app.store.snapshot(null, true).profiles[0]?.credentialStatus).toBe(
			"saved",
		);
		expect(JSON.parse(await readFile(app.path, "utf8")).profiles).toEqual(
			originalProfiles,
		);
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		await expect(
			reopened.select({
				serverId: app.server.id,
				profileId: app.profile.id,
				credentials: app.profile.credentials,
			}),
		).resolves.toMatchObject({
			host: "other.local",
			port: 9050,
			account: "secret-account",
			password: "secret-password",
		});
		await app.store.select({
			serverId: app.server.id,
			profileId: app.profile.id,
			credentials: { account: "temporary", password: "ephemeral" },
		});
		expect(await readFile(app.path, "utf8")).not.toContain("ephemeral");
		await app.store.deleteServer(app.server.id);
		expect(app.store.snapshot(null, true)).toMatchObject({
			servers: [],
			profiles: [],
			lastSelection: null,
		});
	});
	it("rejects duplicate endpoints on Add and Edit without changing saved servers or credentials", async () => {
		const app = await setup();
		await app.store.saveServer(app.server);
		await app.store.saveProfile(app.profile);
		const other = {
			...app.server,
			id: randomUUID(),
			name: "Other",
			endpoint: { host: "other.local", port: app.server.endpoint.port },
		};
		await app.store.saveServer(other);
		const before = await readFile(app.path, "utf8");
		const duplicateEndpoint = {
			host: ` ${app.server.endpoint.host.toUpperCase()} `,
			port: app.server.endpoint.port,
		};
		await expect(
			app.store.saveServer({
				id: randomUUID(),
				name: "Duplicate",
				endpoint: duplicateEndpoint,
			}),
		).rejects.toThrow("already exists");
		await expect(
			app.store.saveServer({ ...other, endpoint: duplicateEndpoint }),
		).rejects.toThrow("already exists");
		expect(await readFile(app.path, "utf8")).toBe(before);
		await expect(app.store.flush()).resolves.toBeUndefined();
		await app.store.saveServer({
			...other,
			endpoint: {
				host: app.server.endpoint.host,
				port: app.server.endpoint.port + 1,
			},
		});
		expect(app.store.snapshot(null, true).servers).toHaveLength(2);
		expect(app.store.snapshot(null, true).profiles[0]?.credentialStatus).toBe(
			"saved",
		);
	});
	it("serializes duplicate checks so concurrent adds cannot persist the same endpoint twice", async () => {
		const app = await setup();
		const results = await Promise.allSettled([
			app.store.saveServer(app.server),
			app.store.saveServer({
				...app.server,
				id: randomUUID(),
				name: "Duplicate",
			}),
		]);
		expect(results.map((result) => result.status)).toEqual([
			"fulfilled",
			"rejected",
		]);
		expect(JSON.parse(await readFile(app.path, "utf8")).servers).toEqual([
			app.server,
		]);
		await expect(app.store.flush()).resolves.toBeUndefined();
	});
	it("retains malformed files until explicit recovery and reports profile-local credential corruption", async () => {
		const app = await setup();
		await writeFile(app.path, "broken");
		const store = new LauncherStore(app.path, geometry);
		await store.load();
		expect(store.snapshot(null, true)).toMatchObject({
			recoveryRequired: true,
			canPlay: false,
		});
		await expect(store.saveServer(app.server)).rejects.toThrow("Recover");
		expect(await readFile(app.path, "utf8")).toBe("broken");
		await store.recover();
		await store.saveServer(app.server);
		await store.saveProfile(app.profile);
		const document = JSON.parse(await readFile(app.path, "utf8"));
		document.profiles[0].credentials.authenticationTag = "broken";
		await writeFile(app.path, JSON.stringify(document));
		const reopened = new LauncherStore(app.path, geometry);
		await reopened.load();
		expect(reopened.snapshot(null, true).profiles[0]?.credentialStatus).toBe(
			"unavailable",
		);
		expect(reopened.snapshot(null, true).servers).toHaveLength(1);
	});
	it("does not publish an edit whose replacement failed", async () => {
		const app = await setup();
		await mkdir(app.path);
		await expect(app.store.saveServer(app.server)).rejects.toThrow();
		expect(app.store.snapshot(null, true).servers).toEqual([]);
		await expect(app.store.flush()).rejects.toThrow("could not be saved");
	});
});
