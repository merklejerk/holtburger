import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientEquipmentCacheStore } from "./client-equipment-cache-store";
import * as replacement from "./replace-local-file";

const endpoint = { host: "LOCALHOST", port: 9000 };
const delayMs = 60_000;
const directories: string[] = [];
const stores: ClientEquipmentCacheStore[] = [];

async function directory(): Promise<string> {
	const result = await mkdtemp(join(tmpdir(), "h3d-equipment-cache-"));
	directories.push(result);
	return result;
}

function makeStore(
	path: string,
	scope = endpoint,
	failure = vi.fn(),
	maxEntries?: number,
) {
	const result = new ClientEquipmentCacheStore(
		path,
		scope,
		delayMs,
		failure,
		maxEntries,
	);
	stores.push(result);
	return result;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(stores.splice(0).map((entry) => entry.close()));
	await Promise.all(
		directories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

describe("main-owned equipment cantrip cache", () => {
	it("persists null and ranked tiers per server scope and reuses across logins", async () => {
		const path = await directory();
		const writer = makeStore(path, { host: "LocalHost", port: 9000 });
		writer.stage({ guid: 101, highestTier: "legendary" });
		writer.stage({ guid: 202, highestTier: null });
		await writer.close();

		expect(
			await makeStore(path, { host: "localhost", port: 9000 }).readAll(),
		).toEqual({
			"101": "legendary",
			"202": null,
		});
		expect(
			await makeStore(path, { host: "localhost", port: 9001 }).readAll(),
		).toEqual({});
	});

	it("preserves newer staged updates while an older atomic write is in flight", async () => {
		const path = await directory();
		const cache = makeStore(path);
		cache.stage({ guid: 1, highestTier: "minor" });

		const replace = replacement.replaceLocalFile;
		let admitWrite!: () => void;
		const admitted = new Promise<void>((resolve) => {
			admitWrite = resolve;
		});
		let finishWrite!: () => void;
		const completion = new Promise<void>((resolve) => {
			finishWrite = resolve;
		});
		vi.spyOn(replacement, "replaceLocalFile").mockImplementationOnce(
			async (file, source) => {
				admitWrite();
				await completion;
				await replace(file, source);
			},
		);

		const olderWrite = cache.flush();
		await admitted;
		cache.stage({ guid: 1, highestTier: "epic" });
		let followupSettled = false;
		const followupFlush = cache.flush().then(() => {
			followupSettled = true;
		});
		await Promise.resolve();
		expect(followupSettled).toBe(false);
		finishWrite();
		await Promise.all([olderWrite, followupFlush]);
		expect(followupSettled).toBe(true);

		expect(await makeStore(path).readAll()).toEqual({ "1": "epic" });
	});

	it("recovers cleanly from corrupt disk cache files and surfaces failures", async () => {
		const path = await directory();
		const first = makeStore(path);
		first.stage({ guid: 7, highestTier: "major" });
		await first.close();

		const [filename] = await readdir(path);
		await writeFile(join(path, filename!), "{not valid json", "utf8");

		const failure = vi.fn();
		const second = makeStore(path, endpoint, failure);
		expect(await second.readAll()).toEqual({});
		expect(failure).toHaveBeenCalledTimes(1);
	});

	it("evicts oldest entries when bounded capacity is exceeded", async () => {
		const path = await directory();
		const cache = makeStore(path, endpoint, vi.fn(), 2);
		cache.stage({ guid: 1, highestTier: "feeble" });
		cache.stage({ guid: 2, highestTier: "minor" });
		cache.stage({ guid: 3, highestTier: "moderate" });
		await cache.close();

		expect(await makeStore(path).readAll()).toEqual({
			"2": "minor",
			"3": "moderate",
		});
	});
});
