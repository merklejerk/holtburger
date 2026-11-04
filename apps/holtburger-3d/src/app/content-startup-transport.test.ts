import { afterEach, expect, it, vi } from "vitest";
import { createContentStartupTransport } from "./content-startup-transport";
import type { ContentStartupSnapshot } from "./content-startup-contract";

afterEach(() => vi.unstubAllGlobals());

it("retains newer events when the initial IPC snapshot arrives late", async () => {
	const snapshots: Array<(snapshot: unknown) => void> = [];
	const events = new Set<(snapshot: unknown) => void>();
	vi.stubGlobal("window", {
		holtburgerContent: {
			snapshot: () =>
				new Promise<unknown>((resolve) => {
					snapshots.push(resolve);
				}),
			listen: (handler: (snapshot: unknown) => void) => {
				events.add(handler);
				return () => {
					events.delete(handler);
				};
			},
			choose: async () => {},
			retry: async () => {},
			quit: async () => {},
		},
	});
	const transport = createContentStartupTransport();
	const received: ContentStartupSnapshot[] = [];
	const failed = vi.fn();
	const dispose = transport.subscribe((state) => {
		received.push(state);
	}, failed);
	const current = {
		revision: 2,
		temporary: false,
		phase: { kind: "ready" as const, location: "/assets" },
	};
	for (const receive of events) receive(current);
	for (const resolve of snapshots)
		resolve({
			revision: 1,
			temporary: false,
			phase: { kind: "loading", location: null, message: "Loading" },
		});
	await Promise.resolve();
	expect(received).toEqual([current]);
	expect(failed).not.toHaveBeenCalled();
	dispose();
	expect(events.size).toBe(0);
});

it("does not deliver snapshots after its startup shell is disposed", async () => {
	const snapshots: Array<(snapshot: unknown) => void> = [];
	vi.stubGlobal("window", {
		holtburgerContent: {
			snapshot: () =>
				new Promise<unknown>((resolve) => {
					snapshots.push(resolve);
				}),
			listen: () => () => {},
			choose: async () => {},
			retry: async () => {},
			quit: async () => {},
		},
	});
	const received = vi.fn();
	const failed = vi.fn();
	const dispose = createContentStartupTransport().subscribe(received, failed);
	dispose();
	for (const resolve of snapshots) resolve({ invalid: "snapshot" });
	await Promise.resolve();
	expect(received).not.toHaveBeenCalled();
	expect(failed).not.toHaveBeenCalled();
});
