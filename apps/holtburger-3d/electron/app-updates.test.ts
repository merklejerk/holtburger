import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBuild } from "../src/app/app-build-contract.js";
import {
	AppUpdates,
	loadUpdateBuild,
	UPDATE_CHECK_INTERVAL_MS,
	UPDATE_CHECK_TIMEOUT_MS,
} from "./app-updates.js";

const build: AppBuild = {
	development: false,
	modified: false,
	version: "0.1.4-alpha.1",
	channel: "alpha",
	revision: "abcdef12",
};
const feed = {
	schemaVersion: 1,
	version: "0.1.4",
	tag: "candidate-20261103-abcdef123",
};

function fixture(identity: AppBuild | null) {
	const request = vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json(feed));
	const publish = vi.fn();
	const report = vi.fn();
	const openExternal = vi
		.fn<(url: string) => Promise<void>>()
		.mockResolvedValue(undefined);
	const updates = new AppUpdates(identity, {
		request,
		publish,
		report,
		openExternal,
		now: Date.now,
	});
	return { updates, request, publish, report, openExternal };
}

describe("application update ownership", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});
	afterEach(() => vi.useRealTimers());

	it("checks once at startup, compares SemVer and opens only its confirmed release", async () => {
		const { updates, request, openExternal } = fixture(build);
		updates.start();
		updates.start();
		updates.setWindowVisible(true);
		updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(request).toHaveBeenCalledOnce();
		expect(request.mock.calls[0][0]).toBe(
			"https://merklejerk.github.io/holtburger/updates/alpha.json",
		);
		expect(updates.snapshot.availability).toEqual({
			kind: "available",
			version: feed.version,
			tag: feed.tag,
		});
		await updates.openDownloads();
		expect(openExternal).toHaveBeenCalledExactlyOnceWith(
			`https://github.com/merklejerk/holtburger/releases/tag/${feed.tag}`,
		);
		updates.stop();
	});

	it("uses one hourly timer for all pregame registrations and defers during gameplay", async () => {
		const { updates, request } = fixture(build);
		updates.start();
		updates.setWindowVisible(true);
		const first = updates.registerPregame(true);
		const second = updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1);
		expect(request).toHaveBeenCalledOnce();
		updates.releasePregame(first);
		await vi.advanceTimersByTimeAsync(1);
		expect(request).toHaveBeenCalledTimes(2);
		updates.releasePregame(second);
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 2);
		expect(request).toHaveBeenCalledTimes(2);
		updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(request).toHaveBeenCalledTimes(3);
		updates.stop();
	});

	it("retains availability across native navigation and rejects old visibility tokens", async () => {
		const { updates, request } = fixture(build);
		updates.start();
		updates.setWindowVisible(true);
		const old = updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(0);
		updates.clearPregame();
		const current = updates.registerPregame(true);
		expect(updates.releasePregame(old)).toBe("retired");
		expect(updates.setPregameVisible(old, true)).toBe("retired");
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
		expect(request).toHaveBeenCalledTimes(2);
		expect(updates.snapshot.availability.kind).toBe("available");
		updates.releasePregame(current);
		updates.stop();
	});

	it("minimize and document visibility suppress checks; focus/resume reevaluates due work", async () => {
		const { updates, request } = fixture(build);
		updates.start();
		updates.setWindowVisible(true);
		const token = updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(0);
		updates.setWindowVisible(false);
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
		expect(request).toHaveBeenCalledOnce();
		updates.setPregameVisible(token, false);
		updates.setWindowVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(request).toHaveBeenCalledOnce();
		updates.setPregameVisible(token, true);
		await vi.advanceTimersByTimeAsync(0);
		expect(request).toHaveBeenCalledTimes(2);
		vi.setSystemTime(Date.now() + UPDATE_CHECK_INTERVAL_MS);
		updates.setWindowVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(request).toHaveBeenCalledTimes(3);
		updates.stop();
	});

	it("keeps a confirmed update on failure and replaces it after successful reconciliation", async () => {
		const { updates, request } = fixture(build);
		updates.start();
		updates.setWindowVisible(true);
		updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(0);
		request.mockRejectedValueOnce(new Error("offline"));
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
		expect(updates.snapshot.availability.kind).toBe("available");
		expect(updates.snapshot.diagnostic).toContain("offline");
		request.mockResolvedValueOnce(
			Response.json({ ...feed, version: build.version }),
		);
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
		expect(updates.snapshot.availability.kind).toBe("current");
		expect(updates.snapshot.diagnostic).toBeNull();
		await expect(updates.openDownloads()).rejects.toThrow(
			"No confirmed update",
		);
		updates.stop();
	});

	it("bounds both acquisition and body reading, deduplicates in-flight work, and retries only when due", async () => {
		for (const stalledBody of [false, true]) {
			const { updates, request } = fixture(build);
			if (stalledBody)
				request.mockImplementation(() =>
					Promise.resolve(new Response(new ReadableStream())),
				);
			else request.mockImplementation(() => new Promise(() => {}));
			updates.start();
			updates.setWindowVisible(true);
			updates.registerPregame(true);
			await vi.advanceTimersByTimeAsync(UPDATE_CHECK_TIMEOUT_MS - 1);
			expect(updates.snapshot.availability.kind).toBe("unknown");
			updates.setWindowVisible(true);
			await vi.advanceTimersByTimeAsync(1);
			expect(request).toHaveBeenCalledOnce();
			expect(updates.snapshot.diagnostic).toContain("timed out");
			updates.stop();
		}
	});

	it("invalid feeds remain unknown and never enable arbitrary downloads", async () => {
		for (const response of [
			new Response("not json"),
			new Response("unavailable", { status: 503 }),
			Response.json({ ...feed, version: "bad" }),
			Response.json({ ...feed, tag: "https://example.invalid/download" }),
		]) {
			const { updates, request, openExternal } = fixture(build);
			request.mockResolvedValueOnce(response);
			updates.start();
			await vi.advanceTimersByTimeAsync(0);
			expect(updates.snapshot.availability.kind).toBe("unknown");
			expect(updates.snapshot.diagnostic).not.toBeNull();
			await expect(updates.openDownloads()).rejects.toThrow();
			expect(openExternal).not.toHaveBeenCalled();
			updates.stop();
		}
	});

	it("shutdown cancels optional work and publishes nothing afterward", async () => {
		const { updates, request, publish } = fixture(build);
		request.mockImplementation(() => new Promise(() => {}));
		updates.start();
		await vi.advanceTimersByTimeAsync(0);
		updates.stop();
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
		expect(publish).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("disabled builds never request the network", async () => {
		const { updates, request } = fixture(null);
		updates.start();
		updates.setWindowVisible(true);
		updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
		expect(request).not.toHaveBeenCalled();
		updates.stop();
	});

	it("beta uses its explicit feed and equal or older versions remain current", async () => {
		for (const version of ["0.1.4", "0.1.3"]) {
			const { updates, request } = fixture({
				...build,
				version: "0.1.4",
				channel: "beta",
			});
			request.mockResolvedValueOnce(Response.json({ ...feed, version }));
			updates.start();
			await vi.advanceTimersByTimeAsync(0);
			expect(request.mock.calls[0][0]).toBe(
				"https://merklejerk.github.io/holtburger/updates/beta.json",
			);
			expect(updates.snapshot.availability.kind).toBe("current");
			updates.stop();
		}
	});

	it("backward clock correction postpones checks without timer overflow or request bursts", async () => {
		const { updates, request } = fixture(build);
		updates.start();
		updates.setWindowVisible(true);
		updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(0);
		vi.setSystemTime(-UPDATE_CHECK_INTERVAL_MS * 1000);
		updates.setWindowVisible(true);
		await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
		expect(request).toHaveBeenCalledOnce();
		expect(vi.getTimerCount()).toBe(1);
		updates.stop();
	});
});

it("loads only valid, clean packaged metadata for the checking owner", () => {
	const root = mkdtempSync(join(tmpdir(), "holtburger-update-build-"));
	try {
		const path = join(root, "build-info.json");
		const report = vi.fn();
		writeFileSync(path, JSON.stringify(build));
		expect(loadUpdateBuild(path, report)).toEqual(build);
		for (const overrides of [
			{ development: true },
			{ modified: true },
			{ channel: "unknown" },
		]) {
			writeFileSync(path, JSON.stringify({ ...build, ...overrides }));
			expect(loadUpdateBuild(path, report)).toBeNull();
		}
		expect(loadUpdateBuild(join(root, "missing.json"), report)).toBeNull();
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
