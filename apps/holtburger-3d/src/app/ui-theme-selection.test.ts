import { afterEach, expect, it, vi } from "vitest";
import { CLIENT_CLOSE_PREPARATION_TIMEOUT_MS } from "../../electron/client-retirement";
import { UiThemeSelection } from "./ui-theme-selection";
import {
	UI_THEME_LOAD_TIMEOUT_MS,
	type UiThemeTransport,
} from "./ui-theme-contract";

afterEach(() => vi.useRealTimers());

function deferred<Value>() {
	let resolve: (value: Value) => void = () => {
		throw new Error("Deferred not initialized");
	};
	const promise = new Promise<Value>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function fixture() {
	const transport: UiThemeTransport = {
		initialIds: [],
		list: vi.fn(async () => ["night"]),
		resolve: vi.fn(async (id) => `https://fixture/${id}.css`),
		openDirectory: vi.fn(async () => {}),
	};
	const loader = {
		replace: vi.fn(
			async (_url: string | null, _override: null, signal: AbortSignal) => {
				signal.throwIfAborted();
			},
		),
	};
	const owner = new UiThemeSelection(transport, loader);
	return { owner, transport, loader };
}

it("refreshes choices independently and applies Base without resolving a stylesheet", async () => {
	const { owner, transport, loader } = fixture();
	await owner.refresh();
	expect(owner.read().catalog.ids).toEqual(["night"]);
	expect(await owner.select("night")).toBe(true);
	expect(await owner.select(null)).toBe(true);
	expect(transport.resolve).toHaveBeenCalledTimes(1);
	expect(loader.replace.mock.calls.map(([url]) => url)).toEqual([
		"https://fixture/night.css",
		null,
	]);
	expect(owner.read().selection).toEqual({ kind: "ready", activeId: null });
});

it("keeps the active appearance on resolution failure and supports retry outside the last catalog", async () => {
	const { owner, transport } = fixture();
	await owner.select("night");
	vi.mocked(transport.resolve).mockRejectedValueOnce(
		new Error("Theme removed"),
	);
	expect(await owner.select("missing")).toBe(false);
	expect(owner.read().selection).toMatchObject({
		kind: "failed",
		activeId: "night",
		requestedId: "missing",
	});
	expect(await owner.select("missing")).toBe(true);
	expect(owner.read().selection).toEqual({
		kind: "ready",
		activeId: "missing",
	});
});

it("retains earlier choices and selection when catalog refresh fails", async () => {
	const { owner, transport } = fixture();
	await owner.refresh();
	await owner.select("night");
	vi.mocked(transport.list).mockRejectedValueOnce(
		new Error("Directory unreadable"),
	);
	expect(await owner.refresh()).toBe(false);
	expect(owner.read().catalog).toMatchObject({
		kind: "failed",
		ids: ["night"],
	});
	expect(owner.read().selection.activeId).toBe("night");
});

it("serializes selections and lets completion merge into the caller's latest settings", async () => {
	const { owner, transport } = fixture();
	const gate = deferred<string>();
	vi.mocked(transport.resolve).mockImplementationOnce(() => gate.promise);
	let settings = { themeId: "old", font: "theme" };
	const first = owner.select("night").then((accepted) => {
		if (accepted) settings = { ...settings, themeId: "night" };
	});
	const second = owner.select("later");
	await vi.waitFor(() => expect(transport.resolve).toHaveBeenCalledTimes(1));
	settings = { ...settings, font: "mono" };
	gate.resolve("https://fixture/night.css");
	await first;
	await second;
	expect(settings).toEqual({ themeId: "night", font: "mono" });
	expect(owner.read().selection.activeId).toBe("later");
});

it("bounds stalled resolution, ignores its late result, and releases subsequent selections", async () => {
	vi.useFakeTimers();
	const { owner, transport, loader } = fixture();
	const gate = deferred<string>();
	vi.mocked(transport.resolve).mockImplementationOnce(() => gate.promise);
	const stalled = owner.select("night");
	await vi.advanceTimersByTimeAsync(UI_THEME_LOAD_TIMEOUT_MS);
	expect(await stalled).toBe(false);
	expect(owner.read().selection).toMatchObject({
		kind: "failed",
		activeId: null,
	});
	gate.resolve("https://fixture/late.css");
	await Promise.resolve();
	expect(loader.replace).not.toHaveBeenCalled();
	expect(await owner.select(null)).toBe(true);
});

it("retirement aborts active work and discards queued requests and preference commits", async () => {
	const { owner, transport, loader } = fixture();
	const gate = deferred<string>();
	vi.mocked(transport.resolve).mockImplementationOnce(() => gate.promise);
	const notify = vi.fn();
	owner.subscribe(notify);
	const pending = owner.select("night");
	const queued = owner.select("later");
	await vi.waitFor(() => expect(transport.resolve).toHaveBeenCalledTimes(1));
	const publications = notify.mock.calls.length;
	await owner.retire();
	expect(await pending).toBe(false);
	expect(await queued).toBe(false);
	gate.resolve("https://fixture/late.css");
	await owner.retire();
	expect(notify).toHaveBeenCalledTimes(publications);
	expect(loader.replace).not.toHaveBeenCalled();
});

it("keeps the theme operation deadline within the native close preparation budget", () => {
	expect(UI_THEME_LOAD_TIMEOUT_MS).toBeLessThan(
		CLIENT_CLOSE_PREPARATION_TIMEOUT_MS,
	);
});
