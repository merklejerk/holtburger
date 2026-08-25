import { describe, expect, it } from "vitest";
import {
	MAX_FRAME_BYTES,
	PROTOCOL_VERSION,
	SidecarFrameDecoder,
	SidecarHostClient,
	encodeSidecarFrame,
	wireCommand,
	type SidecarProcessLike,
} from "./host-protocol.js";

class FakeStream {
	readonly writes: Uint8Array[] = [];
	#dataListeners: Array<(chunk: Uint8Array) => void> = [];
	#errorListeners: Array<(error: Error) => void> = [];

	write(chunk: Uint8Array): boolean {
		this.writes.push(chunk);
		return true;
	}

	end(): void {}

	on(event: "data", listener: (chunk: Uint8Array) => void): this;
	on(event: "error", listener: (error: Error) => void): this;
	on(
		event: "data" | "error",
		listener: ((chunk: Uint8Array) => void) | ((error: Error) => void),
	): this {
		if (event === "data")
			this.#dataListeners.push(listener as (chunk: Uint8Array) => void);
		else this.#errorListeners.push(listener as (error: Error) => void);
		return this;
	}

	push(chunk: Uint8Array): void {
		for (const listener of this.#dataListeners) listener(chunk);
	}

	fail(error: Error): void {
		for (const listener of this.#errorListeners) listener(error);
	}
}

class FakeProcess implements SidecarProcessLike {
	readonly stdin = new FakeStream();
	readonly stdout = new FakeStream();
	readonly stderr = new FakeStream();
	#exitListeners: Array<(code: number | null, signal: string | null) => void> =
		[];
	#errorListeners: Array<(error: Error) => void> = [];
	killCount = 0;

	on(
		event: "exit",
		listener: (code: number | null, signal: string | null) => void,
	): this;
	on(event: "error", listener: (error: Error) => void): this;
	on(
		event: "exit" | "error",
		listener:
			| ((code: number | null, signal: string | null) => void)
			| ((error: Error) => void),
	): this {
		if (event === "exit") {
			this.#exitListeners.push(
				listener as (code: number | null, signal: string | null) => void,
			);
		} else {
			this.#errorListeners.push(listener as (error: Error) => void);
		}
		return this;
	}

	kill(): boolean {
		this.killCount += 1;
		for (const listener of this.#exitListeners) listener(0, null);
		return true;
	}

	failSpawn(error: Error): void {
		for (const listener of this.#errorListeners) listener(error);
	}
}

function decodeWritten(stream: FakeStream): Record<string, unknown> {
	const frame = stream.writes.at(-1);
	if (!frame) throw new Error("fake process did not receive a frame");
	const length = new DataView(frame.buffer, frame.byteOffset, 4).getUint32(
		0,
		true,
	);
	return JSON.parse(
		JSON.stringify({ length, payload: frame.subarray(4, 4 + length) }),
	) as Record<string, unknown>;
}

describe("SidecarFrameDecoder", () => {
	it("handles fragmented and coalesced frames", () => {
		const decoder = new SidecarFrameDecoder();
		const first = encodeSidecarFrame({
			kind: "handshake",
			protocol_version: 1,
			host_name: "holtburger-3d-host",
			host_version: "test",
		});
		const second = encodeSidecarFrame({ kind: "shutdown_ack", id: 4 });
		const merged = new Uint8Array(first.length + second.length);
		merged.set(first);
		merged.set(second, first.length);
		expect(decoder.push(merged.subarray(0, 3))).toEqual([]);
		expect(decoder.push(merged.subarray(3))).toHaveLength(2);
	});

	it("validates a frame assembled from one-byte chunks", () => {
		const decoder = new SidecarFrameDecoder();
		const encoded = encodeSidecarFrame({ kind: "shutdown_ack", id: 9 });
		const frames = [];
		for (const byte of encoded)
			frames.push(...decoder.push(Uint8Array.of(byte)));
		expect(frames).toEqual([{ kind: "shutdown_ack", id: 9 }]);
	});

	it("rejects the exact announced oversize before allocation", () => {
		const decoder = new SidecarFrameDecoder();
		const prefix = new Uint8Array(4);
		new DataView(prefix.buffer).setUint32(0, MAX_FRAME_BYTES + 1, true);
		expect(() => decoder.push(prefix)).toThrow(/exceeding/);
	});
});

describe("wireCommand", () => {
	it("unwraps the existing capability envelopes at the Rust protocol boundary", () => {
		expect(
			wireCommand("load_animation", { request: { animationId: "0x01000001" } }),
		).toEqual({
			command: "load_animation",
			request: { animationId: "0x01000001" },
		});
		expect(
			wireCommand("start_physical_fly", {
				registration: { residency: {}, scenePosition: [0, 0, 0] },
			}),
		).toEqual({
			command: "start_physical_fly",
			registration: { residency: {}, scenePosition: [0, 0, 0] },
		});
		expect(
			wireCommand("despawn_explorer_entity", { guid: 7, generation: 2 }),
		).toEqual({ command: "despawn_explorer_entity", guid: 7, generation: 2 });
	});
});

describe("SidecarHostClient", () => {
	it("negotiates, multiplexes responses, delivers events, and shuts down", async () => {
		const process = new FakeProcess();
		const client = new SidecarHostClient(process);
		const connected = client.connect();
		process.stdout.push(
			encodeSidecarFrame({
				kind: "handshake",
				protocol_version: PROTOCOL_VERSION,
				host_name: "holtburger-3d-host",
				host_version: "test",
			}),
		);
		await connected;
		expect(process.stdin.writes).toHaveLength(1);

		const events: unknown[] = [];
		await client.listen("explorer-fixed-tick", (payload) =>
			events.push(payload),
		);
		const first = client.invoke("host_status");
		const second = client.invoke("start_simulation_interest_session");
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(process.stdin.writes).toHaveLength(3);
		process.stdout.push(
			encodeSidecarFrame({
				kind: "event",
				event: { event: "fixed-tick", payload: { epoch: 1 } },
			}),
		);
		process.stdout.push(
			encodeSidecarFrame({
				kind: "response",
				id: 1,
				result: { Ok: { kind: "json", value: { status: "ready" } } },
			}),
		);
		process.stdout.push(
			encodeSidecarFrame({
				kind: "response",
				id: 2,
				result: { Ok: { kind: "json", value: 17 } },
			}),
		);
		expect(await first).toEqual({ status: "ready" });
		expect(await second).toBe(17);
		expect(events).toEqual([{ epoch: 1 }]);

		const shutdown = client.shutdown();
		const shutdownFrame = decodeWritten(process.stdin);
		expect(shutdownFrame.length).toBeGreaterThan(0);
		process.stdout.push(encodeSidecarFrame({ kind: "shutdown_ack", id: 3 }));
		await shutdown;
	});

	it("rejects pending and future requests after malformed host output", async () => {
		const process = new FakeProcess();
		const client = new SidecarHostClient(process);
		process.stdout.push(
			encodeSidecarFrame({
				kind: "handshake",
				protocol_version: PROTOCOL_VERSION,
				host_name: "holtburger-3d-host",
				host_version: "test",
			}),
		);
		await client.connect();
		const pending = client.invoke("host_status");
		process.stdout.push(
			encodeSidecarFrame({
				kind: "response",
				id: "not-a-request-id",
				result: { Ok: { kind: "unit" } },
			}),
		);
		await expect(pending).rejects.toMatchObject({ code: "malformed_frame" });
		await expect(client.invoke("host_status")).rejects.toMatchObject({
			code: "malformed_frame",
		});
		expect(process.killCount).toBe(1);
	});

	it("reports a child spawn failure instead of waiting forever for a handshake", async () => {
		const process = new FakeProcess();
		const client = new SidecarHostClient(process);
		process.failSpawn(new Error("executable missing"));
		await expect(client.connect()).rejects.toMatchObject({
			code: "host_spawn",
		});
	});

	it("turns a broken stdout stream into one terminal client failure", async () => {
		const process = new FakeProcess();
		const client = new SidecarHostClient(process);
		process.stdout.fail(new Error("read failed"));
		await expect(client.connect()).rejects.toMatchObject({
			code: "host_stdout",
		});
		expect(process.killCount).toBe(1);
	});
});
