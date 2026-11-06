import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { launcherSettingsSchema } from "../src/launcher/launcher-contract.js";
import { encryptCredentials } from "./launcher-credentials.js";
import { repairLauncherSettings } from "./launcher-settings-repair.js";
import * as repair from "./launcher-settings-repair.js";
import { LauncherStore } from "./launcher-store.js";
import * as replacement from "./replace-local-file.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof fs>();
	return { ...actual, copyFile: vi.fn(actual.copyFile) };
});

const window = { normalBounds: { width: 900, height: 650 }, maximized: false };
const directories: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		directories
			.splice(0)
			.map((path) => fs.rm(path, { recursive: true, force: true })),
	);
});

function catalog() {
	const serverId = randomUUID();
	const profileId = randomUUID();
	return launcherSettingsSchema.parse({
		version: launcherSettingsSchema.shape.version.value,
		servers: [
			{
				id: serverId,
				name: "Test",
				endpoint: { host: "test.local", port: 9000 },
				contentPath: null,
			},
		],
		profiles: [
			{
				id: profileId,
				name: "Account",
				serverId,
				credentials: encryptCredentials(profileId, {
					account: "account",
					password: "password",
				}),
			},
		],
		window,
		lastSelection: { serverId, profileId },
		lastProfileByServer: { [serverId]: profileId },
		serverCredentials: {
			[serverId]: encryptCredentials(`server:${serverId}`, {
				account: "account",
				password: "",
			}),
		},
	});
}

async function fixture(source: string) {
	const directory = await fs.mkdtemp(join(tmpdir(), "h3d-launcher-repair-"));
	directories.push(directory);
	const path = join(directory, "launcher.json");
	await fs.writeFile(path, source);
	return { directory, path, store: new LauncherStore(path, window) };
}

describe("bounded launcher settings repair", () => {
	it("fills missing preferences, removes retired fields and preserves credentials and valid siblings", () => {
		const original = catalog();
		const raw = {
			...original,
			retired: true,
			servers: original.servers.map((server) => ({
				id: server.id,
				name: server.name,
				endpoint: server.endpoint,
				retired: true,
			})),
			window: {
				normalBounds: { width: -1, height: window.normalBounds.height },
				maximized: true,
			},
		};
		const repaired = repairLauncherSettings(raw, window);
		expect(repaired.document).toEqual({
			...original,
			window: { ...window, maximized: true },
		});
		expect(repaired.notices).toContain(
			"launcher.retired: removed unknown field",
		);
	});

	it("isolates malformed entries, credentials and orphaned references without changing valid owners", () => {
		const original = catalog();
		const damagedProfile = {
			id: randomUUID(),
			name: "Damaged",
			serverId: original.servers[0]?.id,
			credentials: { broken: true },
		};
		const repaired = repairLauncherSettings(
			{
				...original,
				servers: [
					...original.servers,
					{
						id: randomUUID(),
						name: "Broken",
						endpoint: { host: "test", port: -1 },
					},
				],
				profiles: [
					...original.profiles,
					damagedProfile,
					{ ...damagedProfile, id: randomUUID(), serverId: randomUUID() },
				],
				lastSelection: { serverId: randomUUID(), profileId: null },
				lastProfileByServer: {
					...original.lastProfileByServer,
					[randomUUID()]: null,
				},
				serverCredentials: {
					...original.serverCredentials,
					[randomUUID()]: { broken: true },
				},
			},
			window,
		);
		expect(repaired.document).toEqual({
			...original,
			profiles: [
				...original.profiles,
				{ ...damagedProfile, credentials: null },
			],
			lastSelection: null,
		});
	});

	it("refuses ambiguous identities and unsupported formats", () => {
		const original = catalog();
		for (const raw of [
			{ ...original, version: original.version + 1 },
			{ ...original, servers: null },
			{ ...original, servers: [...original.servers, ...original.servers] },
			{ ...original, profiles: [...original.profiles, ...original.profiles] },
		])
			expect(() => repairLauncherSettings(raw, window)).toThrow();
	});

	it.each([1, 2, 3, 4, 5])(
		"reconciles version %i while preserving identities, credentials and launch history",
		async (version) => {
			const original = catalog();
			const contentPath = "/legacy/content";
			const legacy: Record<string, unknown> = {
				...original,
				version,
				servers: original.servers.map((server) => ({
					id: server.id,
					name: server.name,
					endpoint: server.endpoint,
				})),
				profiles: original.profiles.map((profile) =>
					version === 5 ? { ...profile, contentPath } : profile,
				),
			};
			if (version === 1) {
				delete legacy.lastSelection;
				legacy.lastProfileId = original.profiles[0]?.id;
			}
			if (version <= 2) delete legacy.lastProfileByServer;
			if (version <= 3) delete legacy.serverCredentials;
			const source = JSON.stringify(legacy);
			const { store, path, directory } = await fixture(source);
			await store.load();
			const saved = launcherSettingsSchema.parse(
				JSON.parse(await fs.readFile(path, "utf8")),
			);
			expect(saved).toEqual({
				...original,
				servers: original.servers.map((server) => ({
					...server,
					contentPath: version === 5 ? contentPath : null,
				})),
				serverCredentials: version <= 3 ? {} : original.serverCredentials,
			});
			const backups = (await fs.readdir(directory)).filter((name) =>
				name.includes(".backup-"),
			);
			expect(backups).toHaveLength(1);
			for (const backup of backups)
				expect(await fs.readFile(join(directory, backup), "utf8")).toBe(source);
			expect(store.snapshot(null, true).canPlay).toBe(true);
		},
	);

	it("retains profiles when historical content choices conflict and reports the reset override", () => {
		const original = catalog();
		const profiles = original.profiles.flatMap((profile) => [
			{ ...profile, contentPath: "/first" },
			{
				...profile,
				id: randomUUID(),
				credentials: null,
				contentPath: "/second",
			},
		]);
		const repaired = repairLauncherSettings(
			{ ...original, version: 5, profiles },
			window,
		);
		expect(repaired.document.servers).toEqual(original.servers);
		expect(repaired.document.profiles).toHaveLength(profiles.length);
		expect(
			repaired.notices.some((notice) =>
				notice.includes("conflicting profile overrides"),
			),
		).toBe(true);
	});

	it("clears and reports a stale version-one selection without discarding the catalog", () => {
		const original = catalog();
		const repaired = repairLauncherSettings(
			{
				...original,
				version: 1,
				lastProfileId: randomUUID(),
				lastProfileByServer: undefined,
			},
			window,
		);
		expect(repaired.document).toEqual({
			...original,
			lastSelection: null,
			lastProfileByServer: {},
		});
		expect(repaired.notices).toContain(
			"lastProfileId: cleared invalid selection",
		);
	});

	it("backs up the exact source before repair and leaves a repaired reload untouched", async () => {
		const source = JSON.stringify({ ...catalog(), retired: true });
		const { store, path, directory } = await fixture(source);
		await store.load();
		expect(store.snapshot(null, true)).toMatchObject({
			canPlay: true,
		});
		expect(store.snapshot(null, true).failure).toContain("retired");
		await expect(store.flush()).resolves.toBeUndefined();
		const backups = (await fs.readdir(directory)).filter((name) =>
			name.includes(".backup-"),
		);
		expect(backups).toHaveLength(1);
		for (const backup of backups)
			expect(await fs.readFile(join(directory, backup), "utf8")).toBe(source);
		const normalized = await fs.readFile(path, "utf8");
		const reopened = new LauncherStore(path, window);
		await reopened.load();
		expect(reopened.snapshot(null, true).failure).toBeNull();
		expect(await fs.readFile(path, "utf8")).toBe(normalized);
		expect(await fs.readdir(directory)).toHaveLength(2);
	});

	it("repairs malformed historical content paths before reconciling server ownership and reports discarded choices", () => {
		const original = catalog();
		const profiles = original.profiles.flatMap((profile) => [
			{ ...profile, contentPath: 42 },
			{
				...profile,
				id: randomUUID(),
				credentials: null,
				contentPath: "/valid",
			},
		]);
		const repaired = repairLauncherSettings(
			{ ...original, version: 5, profiles },
			window,
		);
		expect(repaired.document.servers).toEqual(original.servers);
		expect(repaired.document.profiles).toEqual(
			profiles.map(({ id, name, serverId, credentials }) => ({
				id,
				name,
				serverId,
				credentials,
			})),
		);
		expect(
			repaired.notices.some((notice) =>
				notice.includes("contentPath: reset invalid value"),
			),
		).toBe(true);
		expect(
			repaired.notices.some((notice) =>
				notice.includes("conflicting profile overrides"),
			),
		).toBe(true);
	});

	it("preserves the catalog and reports unexpected repair failures instead of resetting it", async () => {
		const source = JSON.stringify(catalog());
		const { store, path, directory } = await fixture(source);
		vi.spyOn(repair, "repairLauncherSettings").mockImplementationOnce(() => {
			throw new Error("Unexpected repair failure");
		});
		await store.load();
		expect(store.snapshot(null, true).canPlay).toBe(false);
		expect(store.snapshot(null, true).failure).toContain(
			"Unexpected repair failure",
		);
		expect(await fs.readFile(path, "utf8")).toBe(source);
		expect(await fs.readdir(directory)).toEqual(["launcher.json"]);
	});

	it("does not rewrite a valid catalog with reordered keys", async () => {
		const source = JSON.stringify(
			Object.fromEntries(Object.entries(catalog()).reverse()),
		);
		const { store, path, directory } = await fixture(source);
		await store.load();
		expect(store.snapshot(null, true).failure).toBeNull();
		expect(await fs.readFile(path, "utf8")).toBe(source);
		expect(await fs.readdir(directory)).toEqual(["launcher.json"]);
	});

	it("retains the original and blocks writes if backup or repair replacement fails", async () => {
		for (const fail of [
			() =>
				vi
					.mocked(fs.copyFile)
					.mockRejectedValueOnce(new Error("backup unavailable")),
			() =>
				vi
					.mocked(fs.copyFile)
					.mockRejectedValueOnce(
						Object.assign(new Error("source disappeared"), { code: "ENOENT" }),
					),
			() =>
				vi
					.spyOn(replacement, "replaceLocalFile")
					.mockRejectedValueOnce(new Error("disk full")),
		]) {
			const source = JSON.stringify({ ...catalog(), retired: true });
			const { store, path } = await fixture(source);
			fail();
			await store.load();
			expect(store.snapshot(null, true)).toMatchObject({
				canPlay: false,
			});
			expect(await fs.readFile(path, "utf8")).toBe(source);
			const [server] = catalog().servers;
			await expect(store.saveServer(server)).rejects.toThrow(
				"could not be loaded",
			);
			vi.restoreAllMocks();
		}
	});

	it("automatically backs up and resets undecodable catalogs, then accepts saved servers", async () => {
		const original = catalog();
		for (const source of [
			"broken",
			JSON.stringify({ ...original, version: original.version + 1 }),
			JSON.stringify({
				...original,
				servers: [...original.servers, ...original.servers],
			}),
		]) {
			const { store, path, directory } = await fixture(source);
			await store.load();
			expect(store.snapshot(null, true)).toMatchObject({
				canPlay: true,
				servers: [],
				profiles: [],
			});
			expect(store.snapshot(null, true).failure).toContain("Reset catalog");
			const backups = (await fs.readdir(directory)).filter((name) =>
				name.includes(".backup-"),
			);
			expect(backups).toHaveLength(1);
			for (const backup of backups)
				expect(await fs.readFile(join(directory, backup), "utf8")).toBe(source);
			const document = launcherSettingsSchema.parse(
				JSON.parse(await fs.readFile(path, "utf8")),
			);
			expect(document.servers).toEqual([]);
			for (const server of original.servers) await store.saveServer(server);
			expect(store.snapshot(null, true).servers).toEqual(original.servers);
			await expect(store.flush()).resolves.toBeUndefined();
		}
	});
});
