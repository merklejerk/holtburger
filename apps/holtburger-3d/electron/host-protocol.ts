import { decode, encode } from "@msgpack/msgpack";
import { z } from "zod";
import type { ClientLaunchConfiguration } from "./client-launch.js";
import { MAX_PENDING_REQUESTS } from "../src/lib/host/host-limits.js";
export { MAX_PENDING_REQUESTS } from "../src/lib/host/host-limits.js";
import type {
	HostCommandArguments,
	HostCommandName,
	HostEventName,
	HostEventPayloadMap,
	HostMode,
} from "../src/lib/host/host-transport.js";

/** Must match the Rust sidecar's encoded payload ceiling. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;
/** Version negotiated before any command is accepted. */
export const PROTOCOL_VERSION = 1;
/** Grace period before a sidecar that ignored shutdown is terminated. */
const SHUTDOWN_GRACE_MS = 2_000;
/** Startup bound for a child that spawned but never produced a handshake. */
const HANDSHAKE_GRACE_MS = 15_000;

interface WritableStreamLike {
	write(chunk: Uint8Array): boolean;
	end(): void;
	on(event: "error", listener: (error: Error) => void): this;
}

interface ReadableStreamLike {
	on(event: "data", listener: (chunk: Uint8Array) => void): this;
	on(event: "error", listener: (error: Error) => void): this;
}

/** Minimal child-process surface needed by the protocol; keeps tests independent of Electron. */
export interface SidecarProcessLike {
	stdin: WritableStreamLike;
	stdout: ReadableStreamLike;
	on(
		event: "exit",
		listener: (code: number | null, signal: string | null) => void,
	): this;
	on(event: "error", listener: (error: Error) => void): this;
	kill(signal?: NodeJS.Signals): boolean;
}

const wireIdSchema = z
	.number()
	.int()
	.nonnegative()
	.max(Number.MAX_SAFE_INTEGER);
const wireErrorSchema = z.object({ code: z.string(), message: z.string() });
const wireResponseSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("unit") }),
	z.object({ kind: z.literal("json"), value: z.unknown() }),
	z.object({ kind: z.literal("binary"), value: z.instanceof(Uint8Array) }),
]);
const wireFrameSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("handshake"),
		protocol_version: z.number().int().nonnegative(),
		host_name: z.string(),
		host_version: z.string(),
		host_mode: z.enum(["explorer", "client"]),
	}),
	z.object({
		kind: z.literal("response"),
		id: wireIdSchema,
		result: z.union([
			z.object({ Ok: wireResponseSchema }),
			z.object({ Err: wireErrorSchema }),
		]),
	}),
	z.object({
		kind: z.literal("event"),
		event: z.object({
			event: z.enum([
				"explorer-dynamic-entity",
				"client-current-state",
				"client-lifecycle-changed",
				"client-server-time-updated",
				"client-dynamic-entity",
				"client-camera-started",
				"client-camera",
				"client-world-discontinuity",
				"client-exit-requested",
				"explorer-fixed-tick",
				"explorer-possession-event-outcomes",
				"explorer-physical-fly-motion",
				"explorer-physical-fly-failure",
			]),
			payload: z.unknown(),
		}),
	}),
	z.object({ kind: z.literal("shutdown_ack"), id: wireIdSchema }),
	z.object({ kind: z.literal("rejected"), error: wireErrorSchema }),
]);

type WireFrame = z.infer<typeof wireFrameSchema>;

/** Error reported when the sidecar violates the framing or negotiated protocol contract. */
export class SidecarProtocolError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.name = "SidecarProtocolError";
		this.code = code;
	}
}

/** Incremental decoder that accepts fragmented and coalesced child-process stdout chunks. */
export class SidecarFrameDecoder {
	readonly #chunks: Uint8Array[] = [];
	#headOffset = 0;
	#bufferedBytes = 0;

	push(chunk: Uint8Array): WireFrame[] {
		if (chunk.length !== 0) {
			this.#chunks.push(chunk);
			this.#bufferedBytes += chunk.length;
		}
		const frames: WireFrame[] = [];
		while (this.#bufferedBytes >= 4) {
			const prefix = this.#peek(4);
			const length = new DataView(
				prefix.buffer,
				prefix.byteOffset,
				prefix.byteLength,
			).getUint32(0, true);
			if (length > MAX_FRAME_BYTES) {
				throw new SidecarProtocolError(
					"oversize_frame",
					`sidecar announced ${length} bytes, exceeding ${MAX_FRAME_BYTES}`,
				);
			}
			if (this.#bufferedBytes < length + 4) break;
			this.#read(4);
			const payload = this.#read(length);
			const parsed = wireFrameSchema.safeParse(decode(payload));
			if (!parsed.success) {
				throw new SidecarProtocolError(
					"malformed_frame",
					`sidecar emitted an invalid frame: ${z.prettifyError(parsed.error)}`,
				);
			}
			frames.push(parsed.data);
		}
		return frames;
	}

	#peek(length: number): Uint8Array {
		const head = this.#chunks[0];
		if (head !== undefined && head.length - this.#headOffset >= length) {
			return head.subarray(this.#headOffset, this.#headOffset + length);
		}
		const value = new Uint8Array(length);
		let written = 0;
		let chunkIndex = 0;
		let chunkOffset = this.#headOffset;
		while (written < length) {
			const chunk = this.#chunks[chunkIndex];
			if (chunk === undefined)
				throw new Error("frame decoder peek exceeded buffered bytes");
			const copied = Math.min(length - written, chunk.length - chunkOffset);
			value.set(chunk.subarray(chunkOffset, chunkOffset + copied), written);
			written += copied;
			chunkIndex += 1;
			chunkOffset = 0;
		}
		return value;
	}

	#read(length: number): Uint8Array {
		const value = this.#peek(length);
		let remaining = length;
		while (remaining > 0) {
			const head = this.#chunks[0];
			if (head === undefined)
				throw new Error("frame decoder read exceeded buffered bytes");
			const consumed = Math.min(remaining, head.length - this.#headOffset);
			remaining -= consumed;
			this.#headOffset += consumed;
			if (this.#headOffset === head.length) {
				this.#chunks.shift();
				this.#headOffset = 0;
			}
		}
		this.#bufferedBytes -= length;
		return value;
	}
}

/** Encode one MessagePack frame with a little-endian u32 payload length. */
export function encodeSidecarFrame(frame: unknown): Uint8Array {
	const payload = encode(frame);
	if (payload.length > MAX_FRAME_BYTES) {
		throw new SidecarProtocolError(
			"oversize_frame",
			`sidecar payload is ${payload.length} bytes, exceeding ${MAX_FRAME_BYTES}`,
		);
	}
	const framed = new Uint8Array(payload.length + 4);
	new DataView(framed.buffer).setUint32(0, payload.length, true);
	framed.set(payload, 4);
	return framed;
}

export function wireCommand(
	command: HostCommandName,
	args: HostCommandArguments,
): Record<string, unknown> {
	const base = { command };
	if (args === undefined) return base;
	if (
		command === "despawn_explorer_entity" ||
		command === "stop_physical_fly"
	) {
		return { ...base, ...args };
	}
	if (command === "select_client_character") {
		return { ...base, guid: args.guid };
	}
	if (command === "replace_client_drive") {
		return { ...base, request: args.request };
	}
	if (command === "start_physical_fly") {
		return { ...base, registration: args.registration };
	}
	if (command === "set_physical_fly_intent") {
		return { ...base, intent: args.intent };
	}
	if ("request" in args) return { ...base, request: args.request };
	return { ...base, ...args };
}

/** Main-process client that owns one sidecar, request multiplexer, and event fanout. */
export class SidecarHostClient {
	readonly #process: SidecarProcessLike;
	readonly #expectedMode: HostMode | undefined;
	readonly #decoder = new SidecarFrameDecoder();
	readonly #pending = new Map<
		number,
		{
			resolve: (value: unknown) => void;
			reject: (reason: unknown) => void;
		}
	>();
	readonly #listeners = new Map<
		HostEventName,
		Set<(payload: unknown) => void>
	>();
	#nextRequestId = 1;
	#connected: Promise<void>;
	#resolveConnected!: () => void;
	#rejectConnected!: (reason: unknown) => void;
	#shutdown: Promise<void> | undefined;
	#failure: SidecarProtocolError | undefined;
	#handshakeComplete = false;
	readonly #handshakeTimeout: ReturnType<typeof setTimeout>;

	constructor(process: SidecarProcessLike, expectedMode?: HostMode) {
		this.#process = process;
		this.#expectedMode = expectedMode;
		this.#connected = new Promise<void>((resolve, reject) => {
			this.#resolveConnected = resolve;
			this.#rejectConnected = reject;
		});
		this.#handshakeTimeout = setTimeout(() => {
			this.#fail(
				new SidecarProtocolError(
					"handshake_timeout",
					"host did not complete its protocol handshake",
				),
				true,
			);
		}, HANDSHAKE_GRACE_MS);
		process.stdout.on("data", (chunk) => this.#receive(chunk));
		process.stdin.on("error", (error) => {
			this.#fail(new SidecarProtocolError("host_stdin", error.message), true);
		});
		process.stdout.on("error", (error) => {
			this.#fail(new SidecarProtocolError("host_stdout", error.message), true);
		});
		process.on("error", (error) => {
			this.#fail(
				new SidecarProtocolError(
					"host_spawn",
					`failed to start host sidecar: ${error.message}`,
				),
				false,
			);
		});
		process.on("exit", (code, signal) => {
			this.#fail(
				new SidecarProtocolError(
					"host_exit",
					`host exited before completing the protocol (code=${code ?? "none"}, signal=${signal ?? "none"})`,
				),
				false,
			);
		});
	}

	/** Waits for the host handshake and acknowledges the negotiated protocol version. */
	async connect(): Promise<void> {
		await this.#connected;
		if (this.#failure) throw this.#failure;
	}

	/** Sends one typed command and resolves its matching response. */
	async invoke(
		command: HostCommandName,
		args?: HostCommandArguments,
	): Promise<unknown> {
		return this.#invokeWire(wireCommand(command, args));
	}

	/** Sends the one launch-only client command; this method is not part of the preload bridge. */
	async startClient(startup: ClientLaunchConfiguration): Promise<void> {
		try {
			await this.#invokeWire({ command: "start_client", startup });
		} finally {
			// Release the caller's retained credential as soon as the encoded startup request settles.
			startup.password = "";
		}
	}

	/** Registers one allowlisted event listener and returns its disposal function. */
	async listen<K extends HostEventName>(
		event: K,
		handler: (payload: HostEventPayloadMap[K]) => void,
	): Promise<() => void> {
		await this.#connected;
		if (this.#failure) throw this.#failure;
		const listeners = this.#listeners.get(event) ?? new Set();
		listeners.add(handler as (payload: unknown) => void);
		this.#listeners.set(event, listeners);
		return () => listeners.delete(handler as (payload: unknown) => void);
	}

	async #invokeWire(command: Record<string, unknown>): Promise<unknown> {
		await this.#connected;
		if (this.#failure) throw this.#failure;
		if (this.#pending.size >= MAX_PENDING_REQUESTS) {
			throw new SidecarProtocolError(
				"pending_limit",
				`host already has ${MAX_PENDING_REQUESTS} pending requests`,
			);
		}
		const id = this.#nextRequestId++;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			try {
				this.#write({ kind: "request", id, command });
			} catch (error) {
				this.#pending.delete(id);
				reject(error);
			}
		});
	}

	/** Requests an orderly host shutdown and force-kills only after the bounded grace period. */
	async shutdown(): Promise<void> {
		if (this.#shutdown) return this.#shutdown;
		if (this.#failure) return;
		this.#shutdown = new Promise<void>((resolve, reject) => {
			const id = this.#nextRequestId++;
			const timeout = setTimeout(() => {
				this.#pending.delete(id);
				this.#process.kill();
				reject(
					new SidecarProtocolError(
						"shutdown_timeout",
						"host did not acknowledge shutdown",
					),
				);
			}, SHUTDOWN_GRACE_MS);
			this.#pending.set(id, {
				resolve: () => {
					clearTimeout(timeout);
					resolve();
				},
				reject: (error) => {
					clearTimeout(timeout);
					reject(error);
				},
			});
			try {
				this.#write({ kind: "shutdown", id });
			} catch (error) {
				clearTimeout(timeout);
				this.#pending.delete(id);
				reject(error);
			}
		});
		return this.#shutdown;
	}

	#write(frame: unknown): void {
		if (!this.#process.stdin.write(encodeSidecarFrame(frame))) {
			// Node retains the frame until drain; the pending-request limit bounds this queue.
		}
	}

	#receive(chunk: Uint8Array): void {
		let frames: WireFrame[];
		try {
			frames = this.#decoder.push(chunk);
		} catch (error) {
			this.#fail(
				error instanceof SidecarProtocolError
					? error
					: new SidecarProtocolError("malformed_frame", String(error)),
				true,
			);
			return;
		}
		try {
			for (const frame of frames) {
				if (frame.kind === "handshake") {
					if (this.#handshakeComplete) {
						this.#fail(
							new SidecarProtocolError(
								"duplicate_handshake",
								"host emitted more than one protocol handshake",
							),
							true,
						);
						return;
					}
					if (frame.protocol_version !== PROTOCOL_VERSION) {
						this.#fail(
							new SidecarProtocolError(
								"incompatible_protocol",
								"host protocol version is unsupported",
							),
							true,
						);
						return;
					}
					if (
						this.#expectedMode !== undefined &&
						frame.host_mode !== this.#expectedMode
					) {
						this.#fail(
							new SidecarProtocolError(
								"host_mode_mismatch",
								`host selected ${frame.host_mode} mode, expected ${this.#expectedMode}`,
							),
							true,
						);
						return;
					}
					this.#write({
						kind: "handshake_ack",
						protocol_version: PROTOCOL_VERSION,
					});
					this.#handshakeComplete = true;
					clearTimeout(this.#handshakeTimeout);
					this.#resolveConnected();
					continue;
				}
				if (!this.#handshakeComplete) {
					this.#fail(
						new SidecarProtocolError(
							"handshake_required",
							"host emitted application traffic before its handshake",
						),
						true,
					);
					return;
				}
				if (frame.kind === "response") {
					const pending = this.#pending.get(frame.id);
					if (!pending) {
						this.#fail(
							new SidecarProtocolError(
								"unknown_response",
								`host responded to unknown request ${frame.id}`,
							),
							true,
						);
						return;
					}
					this.#pending.delete(frame.id);
					if ("Err" in frame.result) {
						pending.reject(
							new SidecarProtocolError(
								frame.result.Err.code,
								frame.result.Err.message,
							),
						);
						continue;
					}
					const result = frame.result.Ok;
					pending.resolve(result.kind === "unit" ? undefined : result.value);
					continue;
				}
				if (frame.kind === "event") {
					const event: HostEventName = frame.event.event;
					for (const listener of this.#listeners.get(event) ?? [])
						listener(frame.event.payload);
					continue;
				}
				if (frame.kind === "shutdown_ack") {
					const pending = this.#pending.get(frame.id);
					if (!pending) {
						this.#fail(
							new SidecarProtocolError(
								"unknown_shutdown",
								`host acknowledged unknown shutdown ${frame.id}`,
							),
							true,
						);
						return;
					}
					this.#pending.delete(frame.id);
					pending.resolve(undefined);
					this.#process.stdin.end();
					continue;
				}
				if (frame.kind === "rejected") {
					this.#fail(
						new SidecarProtocolError(frame.error.code, frame.error.message),
						true,
					);
					return;
				}
			}
		} catch (error) {
			this.#fail(
				new SidecarProtocolError(
					"protocol_processing",
					error instanceof Error ? error.message : String(error),
				),
				true,
			);
		}
	}

	#fail(error: SidecarProtocolError, terminate: boolean): void {
		if (this.#failure) return;
		this.#failure = error;
		clearTimeout(this.#handshakeTimeout);
		this.#rejectConnected(error);
		for (const pending of this.#pending.values()) pending.reject(error);
		this.#pending.clear();
		if (terminate) this.#process.kill();
	}
}
