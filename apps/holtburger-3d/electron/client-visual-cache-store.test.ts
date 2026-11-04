import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientVisualCacheStore } from "./client-visual-cache-store";
import * as replacement from "./replace-local-file";
import { playerVisualCaptureSchema } from "../src/client/client-object-preview-contract";
import fixture from "../src/client/fixtures/object-preview-wire.json";

const endpoint = { host: "LOCALHOST", port: 9000 };
const delayMs = 60_000;
const directories: string[] = [];
const stores: ClientVisualCacheStore[] = [];

async function directory(): Promise<string> {
	const result = await mkdtemp(join(tmpdir(), "h3d-visual-cache-"));
	directories.push(result);
	return result;
}

function capture(guid: number) {
	return playerVisualCaptureSchema.parse({
		guid,
		source: fixture.equipped.outcome.source,
	});
}

function store(path: string, scope = endpoint, failure = vi.fn()) {
	const result = new ClientVisualCacheStore(path, scope, delayMs, failure);
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

describe("main-owned character visual cache", () => {
	it("does not discard a newer accepted appearance while an older atomic write is in flight", async () => {
		const path = await directory();
		const cache = store(path);
		cache.stage(capture(1));
		const replace = replacement.replaceLocalFile;
		let admitWrite: () => void = () => {
			throw new Error("Expected write admission");
		};
		const admitted = new Promise<void>((resolve) => {
			admitWrite = resolve;
		});
		let finishWrite: () => void = () => {
			throw new Error("Expected write completion");
		};
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
		const newer = capture(1);
		newer.source.body.scale = 4;
		cache.stage(newer);
		const shutdown = cache.close();
		finishWrite();
		await Promise.all([olderWrite, shutdown]);
		expect(await store(path).read(1)).toEqual({
			kind: "ready",
			capture: newer,
		});
	});
	it("flushes the last accepted immutable capture when the renderer disappears before debounce", async () => {
		const path = await directory();
		const cache = store(path);
		const original = capture(1);
		cache.stage(original);
		original.source.body.scale = 9;
		expect(await readdir(path)).toEqual([]);
		await cache.close();
		expect(() => cache.stage(capture(2))).toThrow("not accepted");
		const reloaded = store(path, { host: "localhost", port: endpoint.port });
		expect(await reloaded.read(1)).toEqual({
			kind: "ready",
			capture: capture(1),
		});
		expect(await reloaded.read(1)).toMatchObject({
			capture: { source: { attachments: [{ parentLocation: "right-hand" }] } },
		});
	});

	it("coalesces within a character while preserving other characters and endpoint scopes", async () => {
		const path = await directory();
		const cache = store(path);
		cache.stage(capture(1));
		const replacementCapture = capture(1);
		replacementCapture.source.body.scale = 2;
		cache.stage(replacementCapture);
		cache.stage(capture(2));
		await cache.flush();
		expect(await store(path).read(1)).toEqual({
			kind: "ready",
			capture: replacementCapture,
		});
		expect(await store(path).read(2)).toEqual({
			kind: "ready",
			capture: capture(2),
		});
		expect(
			await store(path, { host: "localhost", port: 9001 }).read(1),
		).toEqual({ kind: "missing" });
		expect(
			await store(path, { host: "other-server", port: endpoint.port }).read(1),
		).toEqual({ kind: "missing" });
	});

	it("keeps a successful disk value and writes siblings when a replacement fails, then permits retry", async () => {
		const path = await directory();
		const cache = store(path);
		cache.stage(capture(1));
		await cache.flush();
		const [file] = await readdir(path);
		if (file === undefined) throw new Error("Expected saved appearance file");
		const previous = await readFile(join(path, file), "utf8");
		const next = capture(1);
		next.source.body.scale = 3;
		cache.stage(next);
		cache.stage(capture(2));
		vi.spyOn(replacement, "replaceLocalFile").mockRejectedValueOnce(
			new Error("disk full"),
		);
		await expect(cache.flush()).rejects.toThrow("1 character appearance");
		expect(await readFile(join(path, file), "utf8")).toBe(previous);
		expect(await store(path).read(2)).toEqual({
			kind: "ready",
			capture: capture(2),
		});
		await cache.flush();
		expect(await store(path).read(1)).toEqual({ kind: "ready", capture: next });
	});

	it.each([
		"{invalid json",
		JSON.stringify({ version: 2, capture: capture(1) }),
		JSON.stringify({ version: 1, capture: { guid: 1, source: {} } }),
	])(
		"reports optional corrupt or unsupported cache without affecting siblings: %s",
		async (invalid) => {
			const path = await directory();
			const cache = store(path);
			cache.stage(capture(1));
			await cache.flush();
			const [file] = await readdir(path);
			if (file === undefined) throw new Error("Expected saved appearance file");
			await writeFile(join(path, file), invalid);
			expect(await cache.read(1)).toMatchObject({
				kind: "unavailable",
				message: expect.stringContaining("appearance"),
			});
			expect(await cache.read(2)).toEqual({ kind: "missing" });
			cache.stage(capture(1));
			await cache.flush();
			expect(await store(path).read(1)).toEqual({
				kind: "ready",
				capture: capture(1),
			});
		},
	);
});
