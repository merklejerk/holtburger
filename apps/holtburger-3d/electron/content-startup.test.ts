import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ContentStartup,
	type HostContentSelection,
	type StartupHost,
} from "./content-startup.js";
import { ContentPreferenceStore } from "./content-preference-store.js";
import { ContentStartupError } from "./host-protocol.js";
import type { ContentFailure } from "../src/app/content-startup-contract.js";

const requiredFailure: ContentFailure = {
	kind: "resource",
	namespace: "eor/portal",
	file_id: 0x01000001,
	source: "/assets",
	message: "Required model missing",
};

type HostBehavior =
	"ready" | "missing" | "invalid" | "pending" | "early_failure";

class FakeHost implements StartupHost {
	readonly contentLocation: string;
	readonly #completionListeners: Array<
		(status: { code: number | null; signal: string | null }) => void
	> = [];
	readonly completed = new Promise<{
		code: number | null;
		signal: string | null;
	}>((resolve) => {
		this.#completionListeners.push(resolve);
	});
	readonly #failures = new Set<(failure: ContentFailure) => void>();
	readonly #connecting: Array<(error: Error) => void> = [];
	readonly connect = vi.fn(async () => {
		if (this.#behavior === "pending")
			return new Promise<void>((_resolve, reject) => {
				this.#connecting.push(reject);
			});
		if (this.#behavior === "missing" || this.#behavior === "invalid")
			throw new ContentStartupError({
				kind: "selection",
				reason: this.#behavior === "missing" ? "absent" : "invalid",
				message: this.#behavior,
			});
		if (this.#behavior === "early_failure") this.fail(requiredFailure);
	});
	readonly shutdown = vi.fn(async () => {
		for (const reject of this.#connecting) reject(new Error("cancelled"));
		for (const complete of this.#completionListeners)
			complete({ code: 0, signal: null });
	});
	readonly #behavior: HostBehavior;
	constructor(location: string, behavior: HostBehavior) {
		this.contentLocation = location;
		this.#behavior = behavior;
	}
	listenContentFailures(
		handler: (failure: ContentFailure) => void,
	): () => void {
		this.#failures.add(handler);
		return () => {
			this.#failures.delete(handler);
		};
	}
	fail(failure: ContentFailure): void {
		for (const listener of this.#failures) listener(failure);
	}
}

let root: string;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "h3d-content-startup-"));
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

function fixture(
	hosts: FakeHost[],
	overridePath: string | null,
	policy = { noContentSearch: false, clearContent: false },
) {
	const path = join(root, "selection.json");
	const store = new ContentPreferenceStore(path);
	const launch = vi.fn<(selection: HostContentSelection) => FakeHost>(() => {
		const host = hosts.shift();
		if (host === undefined) throw new Error("Unexpected extra host launch");
		return host;
	});
	const pickFolder = vi
		.fn<(previous: string | null) => Promise<string | null>>()
		.mockResolvedValue(null);
	const admit = vi.fn<(host: FakeHost) => Promise<void>>(async () => {});
	const startup = new ContentStartup({
		store,
		overridePath,
		...policy,
		portableRoot: "/portable",
		launch,
		admit,
		pickFolder,
	});
	return { path, store, launch, pickFolder, admit, startup };
}

describe("content startup", () => {
	it("treats exhausted automatic discovery as ordinary setup", async () => {
		const { startup } = fixture([new FakeHost("/portable", "missing")], null);
		await startup.start();
		expect(startup.snapshot.phase).toEqual({
			kind: "needs_assets",
			choosing: false,
			location: null,
			canRetry: true,
			message: null,
		});
		await startup.close();
	});
	it("retains the diagnostic when an explicit selection is missing", async () => {
		const { startup } = fixture(
			[new FakeHost("/missing", "missing")],
			"/missing",
		);
		await startup.start();
		expect(startup.snapshot.phase).toEqual({
			kind: "needs_assets",
			choosing: false,
			location: "/missing",
			canRetry: true,
			message: "missing",
		});
		await startup.close();
	});
	it("disables discovery throughout setup retries but accepts an explicit picker choice", async () => {
		const { startup, launch, pickFolder, store } = fixture(
			[new FakeHost("/chosen", "ready")],
			null,
			{ noContentSearch: true, clearContent: false },
		);
		await startup.start();
		await startup.retry();
		expect(launch).not.toHaveBeenCalled();
		expect(startup.snapshot.phase).toMatchObject({
			kind: "needs_assets",
			choosing: false,
			canRetry: false,
			location: null,
		});
		pickFolder.mockResolvedValueOnce("/chosen");
		await startup.choose();
		expect(launch).toHaveBeenCalledExactlyOnceWith({
			kind: "explicit",
			path: "/chosen",
		});
		expect(await store.load()).toMatchObject({
			kind: "selected",
			location: "/chosen",
		});
		await startup.close();
	});
	it("still uses a saved source with search disabled", async () => {
		const { startup, store, launch } = fixture(
			[new FakeHost("/saved", "ready")],
			null,
			{ noContentSearch: true, clearContent: false },
		);
		await store.select("/saved");
		await startup.start();
		expect(launch).toHaveBeenCalledExactlyOnceWith({
			kind: "explicit",
			path: "/saved",
		});
		await startup.close();
	});
	it("does not discover after a saved source disappears when search is disabled", async () => {
		const { startup, store, launch } = fixture(
			[new FakeHost("/saved", "missing")],
			null,
			{ noContentSearch: true, clearContent: false },
		);
		await store.select("/saved");
		await startup.start();
		expect(launch).toHaveBeenCalledOnce();
		expect(startup.snapshot.phase).toMatchObject({
			kind: "needs_assets",
			choosing: false,
			canRetry: true,
			location: "/saved",
		});
		await startup.close();
	});
	it("clears a corrupt preference and goes straight to setup when both controls are supplied", async () => {
		const { startup, path, launch } = fixture([], null, {
			noContentSearch: true,
			clearContent: true,
		});
		await writeFile(path, "invalid preference");
		await startup.start();
		expect(launch).not.toHaveBeenCalled();
		expect(await new ContentPreferenceStore(path).load()).toEqual({
			kind: "unselected",
		});
		await startup.close();
	});
	it("allows ordinary discovery after clearing the saved source", async () => {
		const { startup, store, launch } = fixture(
			[new FakeHost("/discovered", "ready")],
			null,
			{ noContentSearch: false, clearContent: true },
		);
		await store.select("/saved");
		await store.markFailure("/saved", requiredFailure);
		await startup.start();
		expect(launch).toHaveBeenCalledExactlyOnceWith({
			kind: "automatic",
			root: "/portable",
		});
		expect(await store.load()).toMatchObject({
			location: "/discovered",
			health: { kind: "ready" },
		});
		await startup.close();
	});
	it("honors explicit content after clearing without saving a temporary override", async () => {
		const { startup, store, launch } = fixture(
			[new FakeHost("/override", "ready")],
			"/override",
			{ noContentSearch: true, clearContent: true },
		);
		await store.select("/saved");
		await startup.start();
		expect(launch).toHaveBeenCalledExactlyOnceWith({
			kind: "explicit",
			path: "/override",
		});
		expect(await store.load()).toEqual({ kind: "unselected" });
		await startup.close();
	});
	it("requires the clear write to succeed before proceeding and supports retry saving", async () => {
		const { startup, store, launch } = fixture([], null, {
			noContentSearch: true,
			clearContent: true,
		});
		await store.select("/saved");
		const clear = store.clear.bind(store);
		vi.spyOn(store, "clear")
			.mockImplementation(clear)
			.mockRejectedValueOnce(new Error("disk unavailable"));
		await startup.start();
		expect(startup.snapshot.phase.kind).toBe("persistence_failed");
		expect(launch).not.toHaveBeenCalled();
		await startup.retry();
		expect(startup.snapshot.phase.kind).toBe("needs_assets");
		expect(await store.load()).toEqual({ kind: "unselected" });
		await startup.close();
	});

	it("does not admit a host that exits while its successful preference is being saved", async () => {
		const host = new FakeHost("/assets", "ready");
		const { startup, store } = fixture([host], null);
		const select = store.select.bind(store);
		vi.spyOn(store, "select").mockImplementation(async (location) => {
			await select(location);
			await host.shutdown();
		});
		await startup.start();
		expect(startup.activeHost).toBeNull();
		expect(startup.snapshot.phase).toEqual({
			kind: "fatal",
			message: "Host stopped during startup (code=0, signal=null).",
		});
		expect(await store.load()).toMatchObject({ health: { kind: "ready" } });
		await startup.close();
	});

	it("discovers and saves the canonical successful location before game admission", async () => {
		const host = new FakeHost("/resolved/assets", "ready");
		const { startup, path, launch } = fixture([host], null);
		await startup.start();
		expect(launch).toHaveBeenCalledWith({
			kind: "automatic",
			root: "/portable",
		});
		expect(startup.activeHost).toBe(host);
		expect(startup.snapshot.phase).toEqual({
			kind: "ready",
			location: "/resolved/assets",
		});
		expect(await new ContentPreferenceStore(path).load()).toEqual({
			kind: "selected",
			location: "/resolved/assets",
			health: { kind: "ready" },
		});
		await startup.close();
	});

	it("forces marked selections into setup and clears attention only after explicit retry", async () => {
		const { startup, store, launch, path } = fixture(
			[new FakeHost("/saved", "ready")],
			null,
		);
		await store.select("/saved");
		await store.markFailure("/saved", requiredFailure);
		await startup.start();
		expect(launch).not.toHaveBeenCalled();
		expect(startup.snapshot.phase).toEqual({
			kind: "needs_assets",
			choosing: false,
			canRetry: true,
			location: "/saved",
			message: requiredFailure.message,
		});
		await startup.retry();
		expect(launch).toHaveBeenCalledWith({ kind: "explicit", path: "/saved" });
		expect(await new ContentPreferenceStore(path).load()).toEqual({
			kind: "selected",
			location: "/saved",
			health: { kind: "ready" },
		});
		await startup.close();
	});

	it("reaps a missing saved selection before attempting automatic discovery", async () => {
		const missing = new FakeHost("/saved", "missing");
		const found = new FakeHost("/portable", "ready");
		const { startup, store, launch } = fixture([missing, found], null);
		await store.select("/saved");
		await startup.start();
		expect(missing.shutdown).toHaveBeenCalledOnce();
		expect(launch.mock.calls.map(([selection]) => selection)).toEqual([
			{ kind: "explicit", path: "/saved" },
			{ kind: "automatic", root: "/portable" },
		]);
		expect(startup.activeHost).toBe(found);
		await startup.close();
	});

	it("keeps invalid saved archives visible and persists attention instead of discovering another installation", async () => {
		const { startup, store, path, launch } = fixture(
			[new FakeHost("/saved", "invalid")],
			null,
		);
		await store.select("/saved");
		await startup.start();
		expect(launch).toHaveBeenCalledOnce();
		expect(startup.snapshot.phase.kind).toBe("needs_assets");
		expect(await new ContentPreferenceStore(path).load()).toMatchObject({
			health: { kind: "needs_attention", failure: { reason: "invalid" } },
		});
	});

	it("keeps the entire override session temporary, including a replacement picked after failure", async () => {
		const { startup, store, path, pickFolder } = fixture(
			[
				new FakeHost("/override", "invalid"),
				new FakeHost("/replacement", "ready"),
			],
			"/override",
		);
		await store.select("/saved");
		await startup.start();
		pickFolder.mockResolvedValue("/replacement");
		await startup.choose();
		expect(startup.snapshot.phase.kind).toBe("ready");
		expect(startup.snapshot.temporary).toBe(true);
		expect(await new ContentPreferenceStore(path).load()).toEqual({
			kind: "selected",
			location: "/saved",
			health: { kind: "ready" },
		});
		await startup.close();
	});

	it("marks required runtime failure and forces setup on the next launch", async () => {
		const host = new FakeHost("/assets", "ready");
		const { startup, path } = fixture([host], null);
		await startup.start();
		host.fail(requiredFailure);
		await vi.waitFor(() =>
			expect(startup.snapshot.phase.kind).toBe("restart_required"),
		);
		await startup.close();
		const launch = vi.fn<(_selection: HostContentSelection) => FakeHost>(() => {
			throw new Error("Unexpected host launch");
		});
		const next = new ContentStartup({
			store: new ContentPreferenceStore(path),
			overridePath: null,
			noContentSearch: false,
			clearContent: false,
			portableRoot: "/portable",
			launch,
			admit: async () => {},
			pickFolder: async () => null,
		});
		await next.start();
		expect(launch).not.toHaveBeenCalled();
		expect(next.snapshot.phase).toMatchObject({
			kind: "needs_assets",
			choosing: false,
			canRetry: true,
			location: "/assets",
		});
	});

	it("latches a failure alongside handshake and never admits that host", async () => {
		const host = new FakeHost("/assets", "early_failure");
		const { startup, path } = fixture([host], null);
		await startup.start();
		expect(startup.activeHost).toBeNull();
		expect(startup.snapshot.phase.kind).toBe("needs_assets");
		expect(host.shutdown).toHaveBeenCalledOnce();
		expect(await new ContentPreferenceStore(path).load()).toEqual({
			kind: "unselected",
		});
	});

	it("keeps setup visible while browsing and restores it on cancellation", async () => {
		const { startup, launch, pickFolder } = fixture([], null, {
			noContentSearch: true,
			clearContent: false,
		});
		await startup.start();
		const previous = startup.snapshot.phase;
		let cancel: (path: string | null) => void = () => {
			throw new Error("Picker was not opened");
		};
		pickFolder.mockImplementation(
			() =>
				new Promise((resolve) => {
					cancel = resolve;
				}),
		);
		const choosing = startup.choose();
		await vi.waitFor(() => expect(pickFolder).toHaveBeenCalledOnce());
		expect(startup.snapshot.phase).toEqual({ ...previous, choosing: true });
		expect(launch).not.toHaveBeenCalled();
		await expect(startup.retry()).rejects.toThrow("already running");
		cancel(null);
		await choosing;
		expect(startup.snapshot.phase).toEqual(previous);
		await startup.close();
	});
	it("begins loading only after the picker supplies a location", async () => {
		const host = new FakeHost("/chosen", "pending");
		const { startup, pickFolder, launch } = fixture([host], null, {
			noContentSearch: true,
			clearContent: false,
		});
		await startup.start();
		let select: (path: string) => void = () => {
			throw new Error("Picker was not opened");
		};
		pickFolder.mockImplementation(
			() =>
				new Promise((resolve) => {
					select = resolve;
				}),
		);
		const choosing = startup.choose();
		await vi.waitFor(() => expect(pickFolder).toHaveBeenCalledOnce());
		expect(startup.snapshot.phase).toMatchObject({
			kind: "needs_assets",
			choosing: true,
		});
		expect(launch).not.toHaveBeenCalled();
		select("/chosen");
		await vi.waitFor(() => expect(host.connect).toHaveBeenCalledOnce());
		expect(startup.snapshot.phase).toMatchObject({
			kind: "loading",
			location: "/chosen",
		});
		await startup.close();
		await choosing;
	});

	it("cancels a pending handshake and rejects overlapping startup actions", async () => {
		const host = new FakeHost("/assets", "pending");
		const { startup } = fixture([host], "/assets");
		const starting = startup.start();
		await vi.waitFor(() => expect(host.connect).toHaveBeenCalledOnce());
		await expect(startup.choose()).rejects.toThrow("already running");
		await startup.close();
		await starting;
		expect(host.shutdown).toHaveBeenCalledOnce();
		expect(startup.activeHost).toBeNull();
	});

	it("does not wait for a native picker to resolve before closing", async () => {
		const { startup, pickFolder } = fixture(
			[new FakeHost("/portable", "missing")],
			null,
		);
		await startup.start();
		pickFolder.mockImplementation(() => new Promise(() => {}));
		void startup.choose();
		await vi.waitFor(() => expect(pickFolder).toHaveBeenCalledOnce());
		await startup.close();
		expect(startup.activeHost).toBeNull();
	});

	it("retries a failed preference write without restarting the initialized host", async () => {
		const host = new FakeHost("/assets", "ready");
		const { startup, path, launch } = fixture([host], null);
		launch.mockImplementation(() => {
			mkdirSync(path);
			return host;
		});
		await startup.start();
		expect(startup.snapshot.phase.kind).toBe("persistence_failed");
		expect(startup.activeHost).toBeNull();
		await rm(path, { recursive: true });
		await startup.retry();
		expect(host.connect).toHaveBeenCalledOnce();
		expect(startup.activeHost).toBe(host);
		expect(await new ContentPreferenceStore(path).load()).toMatchObject({
			kind: "selected",
			location: "/assets",
		});
		await startup.close();
	});

	it("serializes success and failure writes and preserves the first failure reason", async () => {
		const store = new ContentPreferenceStore(join(root, "selection.json"));
		const success = store.select("/assets");
		const failure = store.markFailure("/assets", requiredFailure);
		await Promise.all([success, failure]);
		await store.markFailure("/different", {
			kind: "integrity",
			message: "unrelated",
		});
		await store.markFailure("/assets", { kind: "integrity", message: "later" });
		expect(await store.load()).toEqual({
			kind: "selected",
			location: "/assets",
			health: { kind: "needs_attention", failure: requiredFailure },
		});
	});
});
