import { expect, it, vi } from "vitest";
import {
	createAppUpdateTransport,
	type AppUpdateBridge,
} from "./app-update-transport";
import type { UpdateSnapshot } from "./app-update-contract";

function fixture() {
	const listeners = new Set<(value: unknown) => void>();
	const initial: UpdateSnapshot = {
		revision: 0,
		availability: { kind: "unknown" },
		diagnostic: null,
	};
	const snapshot = vi.fn(async () => initial);
	const bridge: AppUpdateBridge = {
		snapshot,
		listen: (handler) => {
			listeners.add(handler);
			return () => {
				listeners.delete(handler);
			};
		},
		registerPregame: async () => "8c1963e2-cb15-437e-b612-a8863a1e3422",
		setPregameVisible: async () => "active",
		releasePregame: async () => "retired",
		openDownloads: vi.fn(async () => {}),
	};
	return {
		bridge,
		snapshot,
		listeners,
		transport: createAppUpdateTransport(bridge),
	};
}

it("an initial IPC response cannot overwrite a newer event", async () => {
	const { transport, listeners } = fixture();
	const receive = vi.fn();
	const failed = vi.fn();
	const stop = transport.subscribe(receive, failed);
	const newer: UpdateSnapshot = {
		revision: 1,
		availability: { kind: "current" },
		diagnostic: null,
	};
	for (const listener of listeners) listener(newer);
	await Promise.resolve();
	expect(receive).toHaveBeenCalledExactlyOnceWith(newer);
	expect(failed).not.toHaveBeenCalled();
	stop();
	expect(listeners.size).toBe(0);
});

it("retired subscribers ignore late responses and malformed events fail decoding", async () => {
	const { transport, listeners } = fixture();
	const receive = vi.fn();
	const failed = vi.fn();
	const stop = transport.subscribe(receive, failed);
	for (const listener of listeners)
		listener({
			revision: 5,
			availability: { kind: "available", version: "invalid", tag: "invalid" },
			diagnostic: null,
		});
	expect(failed).toHaveBeenCalledOnce();
	stop();
	await Promise.resolve();
	expect(receive).not.toHaveBeenCalled();
});

it("validates registration identity and delegates only the native confirmed-download action", async () => {
	const { bridge, transport } = fixture();
	expect(await transport.registerPregame(true)).toBe(
		"8c1963e2-cb15-437e-b612-a8863a1e3422",
	);
	bridge.registerPregame = async () => "not-a-registration";
	await expect(transport.registerPregame(true)).rejects.toThrow();
	await transport.openDownloads();
	expect(bridge.openDownloads).toHaveBeenCalledExactlyOnceWith();
});
