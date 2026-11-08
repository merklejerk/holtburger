import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBuild } from "../src/app/app-build-contract.js";
import { APP_UPDATE_TUNING } from "../src/app/app-tuning.js";
import { AppUpdates, loadUpdateBuild } from "./app-updates.js";

const build: AppBuild = {
	development: false,
	modified: false,
	version: "0.1.3",
	channel: "beta",
	kind: "release",
	revision: "abcdef12",
};
function history(version: string) {
	return {
		schemaVersion: 2,
		releases: [
			{ version, tag: `v${version}`, notes: `Changes for ${version}` },
		],
		omittedVersion: null,
	};
}
const feed = history("0.1.4");
const latestRelease = feed.releases[0];

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
			`${APP_UPDATE_TUNING.feedRootUrl}/v2/beta.json`,
		);
		expect(updates.snapshot.availability).toEqual({
			kind: "available",
			releases: feed.releases,
			historyIncomplete: false,
		});
		await updates.openDownloads();
		expect(openExternal).toHaveBeenCalledExactlyOnceWith(
			`${APP_UPDATE_TUNING.downloadsRootUrl}/${latestRelease.tag}`,
		);
		updates.stop();
	});

	it("refreshes its channel on click and opens a release published after the notification", async () => {
		const { updates, request, openExternal } = fixture(build);
		updates.start();
		await vi.advanceTimersByTimeAsync(0);
		const latest = history("0.1.5");
		request.mockResolvedValueOnce(Response.json(latest));

		await updates.openDownloads();

		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls[1]).toEqual([
			`${APP_UPDATE_TUNING.feedRootUrl}/v2/${build.channel}.json`,
			expect.objectContaining({ cache: "no-store" }),
		]);
		expect(updates.snapshot.availability).toEqual({
			kind: "available",
			releases: latest.releases,
			historyIncomplete: false,
		});
		expect(openExternal).toHaveBeenCalledExactlyOnceWith(
			`${APP_UPDATE_TUNING.downloadsRootUrl}/${latest.releases[0].tag}`,
		);
		updates.stop();
	});

	it("rejects a failed click refresh without opening stale downloads and allows immediate retry", async () => {
		const { updates, request, openExternal } = fixture(build);
		updates.start();
		await vi.advanceTimersByTimeAsync(0);
		const confirmed = updates.snapshot;
		request.mockRejectedValueOnce(new Error("offline"));

		await expect(updates.openDownloads()).rejects.toThrow("offline");
		expect(openExternal).not.toHaveBeenCalled();
		expect(updates.snapshot.availability).toEqual(confirmed.availability);
		expect(updates.snapshot.check.kind).toBe("failed");
		await updates.openDownloads();
		expect(request).toHaveBeenCalledTimes(3);
		expect(openExternal).toHaveBeenCalledOnce();
		updates.stop();
	});

	it("bounds click refreshes and cancels them on shutdown without opening stale downloads", async () => {
		for (const shutdown of [false, true]) {
			const { updates, request, openExternal } = fixture(build);
			updates.start();
			await vi.advanceTimersByTimeAsync(0);
			request.mockImplementationOnce(() => new Promise(() => {}));
			const opening = expect(updates.openDownloads()).rejects.toThrow(
				shutdown ? "shutdown" : "timed out",
			);
			if (shutdown) updates.stop();
			await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.requestTimeoutMs);
			await opening;
			expect(openExternal).not.toHaveBeenCalled();
			updates.stop();
		}
	});

	it("joins an active periodic refresh before opening downloads", async () => {
		const { updates, request, openExternal } = fixture(build);
		updates.start();
		updates.setWindowVisible(true);
		updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(0);
		let respond: (response: Response) => void = () => {
			throw new Error("Periodic refresh has not started");
		};
		request.mockImplementationOnce(
			() =>
				new Promise<Response>((resolve) => {
					respond = resolve;
				}),
		);
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs);
		const opening = updates.openDownloads();
		expect(openExternal).not.toHaveBeenCalled();
		respond(Response.json(history("0.1.5")));
		await opening;
		expect(request).toHaveBeenCalledTimes(2);
		expect(openExternal).toHaveBeenCalledExactlyOnceWith(
			`${APP_UPDATE_TUNING.downloadsRootUrl}/v0.1.5`,
		);
		updates.stop();
	});

	it("opens the latest confirmed release even when already current", async () => {
		const { updates, request, openExternal } = fixture(build);
		updates.start();
		await vi.advanceTimersByTimeAsync(0);
		request.mockResolvedValueOnce(Response.json(history(build.version)));
		await updates.openDownloads();
		expect(updates.snapshot.availability.kind).toBe("current");
		expect(openExternal).toHaveBeenCalledExactlyOnceWith(
			`${APP_UPDATE_TUNING.downloadsRootUrl}/v${build.version}`,
		);
		updates.stop();
	});

	it("uses one hourly timer for all pregame registrations and defers during gameplay", async () => {
		const { updates, request } = fixture(build);
		updates.start();
		updates.setWindowVisible(true);
		const first = updates.registerPregame(true);
		const second = updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs - 1);
		expect(request).toHaveBeenCalledOnce();
		updates.releasePregame(first);
		await vi.advanceTimersByTimeAsync(1);
		expect(request).toHaveBeenCalledTimes(2);
		updates.releasePregame(second);
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs * 2);
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
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs);
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
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs);
		expect(request).toHaveBeenCalledOnce();
		updates.setPregameVisible(token, false);
		updates.setWindowVisible(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(request).toHaveBeenCalledOnce();
		updates.setPregameVisible(token, true);
		await vi.advanceTimersByTimeAsync(0);
		expect(request).toHaveBeenCalledTimes(2);
		vi.setSystemTime(Date.now() + APP_UPDATE_TUNING.checkIntervalMs);
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
		const confirmed = updates.snapshot;
		request.mockRejectedValueOnce(new Error("offline"));
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs);
		expect(updates.snapshot.availability.kind).toBe("available");
		expect(updates.snapshot.availability).toEqual(confirmed.availability);
		expect(updates.snapshot.check.kind).toBe("failed");
		request.mockResolvedValueOnce(Response.json(history(build.version)));
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs);
		expect(updates.snapshot.availability.kind).toBe("current");
		await updates.openDownloads();
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
			await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.requestTimeoutMs - 1);
			expect(updates.snapshot.availability.kind).toBe("unknown");
			updates.setWindowVisible(true);
			await vi.advanceTimersByTimeAsync(1);
			expect(request).toHaveBeenCalledOnce();
			expect(request.mock.calls[0][1]?.signal?.aborted).toBe(true);
			await vi.advanceTimersByTimeAsync(
				APP_UPDATE_TUNING.checkIntervalMs - APP_UPDATE_TUNING.requestTimeoutMs,
			);
			expect(request).toHaveBeenCalledTimes(2);
			updates.stop();
		}
	});

	it("invalid feeds remain unknown and never enable arbitrary downloads", async () => {
		for (const response of [
			new Response("not json"),
			new Response("unavailable", { status: 503 }),
			Response.json(history("bad")),
			Response.json({
				...feed,
				releases: [
					{ ...latestRelease, tag: "https://example.invalid/download" },
				],
			}),
		]) {
			const { updates, request, openExternal } = fixture(build);
			request.mockResolvedValueOnce(response);
			updates.start();
			await vi.advanceTimersByTimeAsync(0);
			expect(updates.snapshot.availability.kind).toBe("unknown");
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
		publish.mockClear();
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs);
		expect(publish).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("disabled builds never request the network", async () => {
		const { updates, request } = fixture(null);
		updates.start();
		updates.setWindowVisible(true);
		updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs);
		await updates.refresh();
		expect(updates.snapshot.check.kind).toBe("disabled");
		expect(request).not.toHaveBeenCalled();
		updates.stop();
	});

	it("nightly builds ignore every update scheduling trigger", async () => {
		const { updates, request } = fixture({
			...build,
			kind: "nightly",
			version: `0.2.0-nightly-${build.revision}`,
		});
		updates.start();
		updates.setWindowVisible(true);
		const token = updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs * 2);
		updates.setWindowVisible(false);
		updates.setWindowVisible(true);
		updates.setPregameVisible(token, false);
		updates.setPregameVisible(token, true);
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs);
		expect(request).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
		updates.stop();
	});

	it("beta uses its explicit feed and equal or older versions remain current", async () => {
		for (const version of ["0.1.10", "0.1.9"]) {
			const { updates, request } = fixture({
				...build,
				version: "0.1.10",
				channel: "beta",
				kind: "release",
			});
			request.mockResolvedValueOnce(Response.json(history(version)));
			updates.start();
			await vi.advanceTimersByTimeAsync(0);
			expect(request.mock.calls[0][0]).toBe(
				`${APP_UPDATE_TUNING.feedRootUrl}/v2/beta.json`,
			);
			expect(updates.snapshot.availability.kind).toBe("current");
			updates.stop();
		}
	});

	it.each([
		{
			installed: "0.1.1",
			expected: {
				kind: "available",
				versions: ["0.1.4", "0.1.3"],
				historyIncomplete: true,
			},
		},
		{
			installed: "0.1.2",
			expected: {
				kind: "available",
				versions: ["0.1.4", "0.1.3"],
				historyIncomplete: false,
			},
		},
		{
			installed: "0.1.3",
			expected: {
				kind: "available",
				versions: ["0.1.4"],
				historyIncomplete: false,
			},
		},
		{ installed: "0.1.4", expected: { kind: "current", versions: ["0.1.4"] } },
		{ installed: "0.1.5", expected: { kind: "current", versions: ["0.1.4"] } },
	])(
		"selects changes since $installed and identifies omitted newer history",
		async ({ installed, expected }) => {
			const { updates, request } = fixture({ ...build, version: installed });
			request.mockResolvedValueOnce(
				Response.json({
					schemaVersion: 2,
					releases: [
						history("0.1.4").releases[0],
						history("0.1.3").releases[0],
					],
					omittedVersion: "0.1.2",
				}),
			);
			updates.start();
			await vi.advanceTimersByTimeAsync(0);
			const availability = updates.snapshot.availability;
			if (availability.kind === "unknown")
				throw new Error("Expected confirmed history");
			const { releases, ...selection } = availability;
			expect({
				...selection,
				versions: releases.map(({ version }) => version),
			}).toEqual(expected);
			updates.stop();
		},
	);

	it("exposes startup failure, permits explicit retry and opens only the fixed full history", async () => {
		const { updates, request, openExternal } = fixture(build);
		request.mockRejectedValueOnce(new Error("offline"));
		updates.start();
		await vi.advanceTimersByTimeAsync(0);
		expect(updates.snapshot.check).toEqual({
			kind: "failed",
			message: "offline",
		});
		await updates.refresh();
		expect(updates.snapshot.check.kind).toBe("ready");
		await updates.openHistory();
		expect(openExternal).toHaveBeenCalledExactlyOnceWith(
			APP_UPDATE_TUNING.historyUrl,
		);
		updates.stop();
	});

	it("backward clock correction postpones checks without timer overflow or request bursts", async () => {
		const { updates, request } = fixture(build);
		updates.start();
		updates.setWindowVisible(true);
		updates.registerPregame(true);
		await vi.advanceTimersByTimeAsync(0);
		vi.setSystemTime(-APP_UPDATE_TUNING.checkIntervalMs * 1000);
		updates.setWindowVisible(true);
		await vi.advanceTimersByTimeAsync(APP_UPDATE_TUNING.checkIntervalMs);
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
			{ kind: "nightly", version: `0.2.0-nightly-${build.revision}` },
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
