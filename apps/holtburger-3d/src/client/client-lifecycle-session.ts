import {
	decodeClientCurrentState,
	decodeClientCameraStartReceipt,
	decodeClientCameraTick,
	decodeClientDriveRequest,
	decodeClientExitRequested,
	decodeClientLifecycle,
	decodeClientServerTime,
	decodeClientWorldDiscontinuity,
	type ClientCurrentState,
	type ClientCameraIdentity,
	type ClientCameraClearanceRequest,
	type ClientCameraIntentRequest,
	type ClientCameraStartReceipt,
	type ClientCameraStartRequest,
	type ClientCameraTick,
	type ClientDriveRequest,
	type ClientExitRequested,
	type ClientLifecycle,
	type ClientWorldDiscontinuity,
} from "./client-host-contract";
import {
	DynamicEntityMirror,
	type DynamicEntityEvent,
} from "../lib/game/runtime/dynamic-entity-feed";
import { DynamicEntitySession } from "../lib/game/runtime/dynamic-entity-session";
import {
	type HostCommandArguments,
	type HostCommandName,
	type HostEventName,
	type HostTransport,
} from "../lib/host/host-transport";

type ClientCommandName = Extract<
	HostCommandName,
	| "request_client_current_state"
	| "select_client_character"
	| "replace_client_drive"
	| "start_client_camera"
	| "set_client_camera_intent"
	| "set_client_camera_clearance"
	| "stop_client_camera"
	| "disconnect_client"
>;
type ClientEventName = Extract<
	HostEventName,
	| "client-current-state"
	| "client-lifecycle-changed"
	| "client-server-time-updated"
	| "client-dynamic-entity"
	| "client-camera-started"
	| "client-camera"
	| "client-world-discontinuity"
	| "client-exit-requested"
>;

/** Narrow injected seam used by the client lifecycle owner and its browser tests. */
export interface ClientLifecycleTransport {
	invoke(
		command: ClientCommandName,
		args?: HostCommandArguments,
	): Promise<unknown>;
	listen(
		event: ClientEventName,
		handler: (payload: unknown) => void,
	): Promise<() => void>;
}

/** Renderer-visible lifecycle values held independently of Svelte and presentation resources. */
export interface ClientLifecycleSessionState {
	readonly lifecycle: ClientLifecycle | null;
	readonly serverTime: number | null;
	readonly worldGeneration: number;
	readonly exit: ClientExitRequested | null;
}

/** One accepted authority update delivered to app-local lifecycle consumers. */
export type ClientLifecycleSessionEvent =
	| { readonly type: "current-state"; readonly state: ClientCurrentState }
	| { readonly type: "lifecycle"; readonly lifecycle: ClientLifecycle }
	| { readonly type: "server-time"; readonly time: number }
	| { readonly type: "dynamic"; readonly event: DynamicEntityEvent }
	| {
			readonly type: "camera-started";
			readonly receipt: ClientCameraStartReceipt;
	  }
	| { readonly type: "camera"; readonly tick: ClientCameraTick }
	| {
			readonly type: "world-discontinuity";
			readonly discontinuity: ClientWorldDiscontinuity;
	  }
	| { readonly type: "exit-requested"; readonly exit: ClientExitRequested };

/**
 * Owns the first-cut client lifecycle projection and focused dynamic mirror.
 *
 * The host listener set is installed before the first current-state request. Dynamic deltas are
 * ignored by the injected mirror while a replacement snapshot is pending, so receiver loss cannot
 * leave a plausible but incomplete client scene.
 */
export class ClientLifecycleSession {
	readonly mirror: DynamicEntityMirror;
	readonly #transport: ClientLifecycleTransport;
	readonly #listeners = new Set<(event: ClientLifecycleSessionEvent) => void>();
	readonly #dynamicSession: DynamicEntitySession;
	#unlisten: readonly (() => void)[] | null = null;
	#state: ClientLifecycleSessionState = emptyState();
	#entryRequestGuid: number | null = null;

	constructor(
		transport: ClientLifecycleTransport,
		mirror = new DynamicEntityMirror(),
	) {
		this.#transport = transport;
		this.mirror = mirror;
		this.#dynamicSession = new DynamicEntitySession(
			{
				subscribe: (handler) =>
					this.#transport.listen("client-dynamic-entity", handler),
				requestCurrentState: async () => {
					await this.#transport.invoke("request_client_current_state");
				},
			},
			mirror,
		);
		this.#dynamicSession.subscribe((event) => {
			this.#emit({ type: "dynamic", event });
		});
	}

	/** Install every authority listener, then request one atomic replacement snapshot. */
	async start(): Promise<void> {
		if (this.#unlisten !== null) return;
		this.#state = emptyState();
		let siblingUnlisteners: readonly (() => void)[] = [];
		try {
			await this.#dynamicSession.start({
				beforeRequest: async () => {
					siblingUnlisteners = await this.#listenToSiblingEvents();
					this.#unlisten = siblingUnlisteners;
				},
			});
		} catch (error) {
			for (const unlisten of siblingUnlisteners) unlisten();
			this.#unlisten = null;
			this.#dynamicSession.stop();
			throw error;
		}
	}

	/** Stop all listeners and require replacement state if this owner starts again. */
	stop(): void {
		for (const unlisten of this.#unlisten ?? []) unlisten();
		this.#unlisten = null;
		this.#dynamicSession.stop();
		this.#entryRequestGuid = null;
	}

	/** Read the latest lifecycle facts without exposing the host transport or protocol types. */
	state(): ClientLifecycleSessionState {
		return this.#state;
	}

	/** Observe accepted lifecycle, time, dynamic, correction, and terminal updates. */
	subscribe(
		listener: (event: ClientLifecycleSessionEvent) => void,
	): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Request replacement state after a declared receiver loss; deltas are suppressed first. */
	async requestCurrentState(): Promise<void> {
		this.#dynamicSession.invalidate();
		await this.#transport.invoke("request_client_current_state");
	}

	/** Submit one exact authority-provided character identity for the explicit enter action. */
	async enterWorld(guid: number): Promise<void> {
		if (this.#entryRequestGuid === guid) return;
		this.#entryRequestGuid = guid;
		try {
			await this.#transport.invoke("select_client_character", { guid });
		} catch (error) {
			this.#entryRequestGuid = null;
			throw error;
		}
	}

	/** Replace the held local drive; core owns cadence, sequence numbers, and movement limits. */
	async replaceDrive(request: ClientDriveRequest): Promise<void> {
		const validated = decodeClientDriveRequest(request);
		await this.#transport.invoke("replace_client_drive", {
			request: validated,
		});
	}

	/** Register a client camera generation; its authority receipt arrives on the sibling event. */
	async startCamera(request: ClientCameraStartRequest): Promise<void> {
		await this.#transport.invoke("start_client_camera", { request });
	}

	async setCameraIntent(request: ClientCameraIntentRequest): Promise<void> {
		await this.#transport.invoke("set_client_camera_intent", { request });
	}

	async setCameraClearance(
		request: ClientCameraClearanceRequest,
	): Promise<void> {
		await this.#transport.invoke("set_client_camera_clearance", { request });
	}

	async stopCamera(request: ClientCameraIdentity): Promise<void> {
		await this.#transport.invoke("stop_client_camera", { request });
	}

	/** Ask the authority to disconnect this one client attempt. */
	async disconnect(): Promise<void> {
		await this.#transport.invoke("disconnect_client");
	}

	async #listenToSiblingEvents(): Promise<(() => void)[]> {
		const unlisteners: (() => void)[] = [];
		try {
			unlisteners.push(
				await this.#transport.listen("client-current-state", (payload) =>
					this.#receiveCurrentState(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-lifecycle-changed", (payload) =>
					this.#receiveLifecycle(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-server-time-updated", (payload) =>
					this.#receiveServerTime(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-world-discontinuity", (payload) =>
					this.#receiveDiscontinuity(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-camera-started", (payload) =>
					this.#receiveCameraStarted(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-camera", (payload) =>
					this.#receiveCamera(payload),
				),
			);
			unlisteners.push(
				await this.#transport.listen("client-exit-requested", (payload) =>
					this.#receiveExit(payload),
				),
			);
			return unlisteners;
		} catch (error) {
			for (const unlisten of unlisteners) unlisten();
			throw error;
		}
	}

	#receiveCurrentState(payload: unknown): void {
		const state = decodeClientCurrentState(payload);
		if (state.lifecycle.kind !== "entering-world") {
			this.#entryRequestGuid = null;
		}
		this.#state = {
			...this.#state,
			lifecycle: state.lifecycle,
			serverTime: state.serverTime,
			worldGeneration: state.worldGeneration,
			exit: null,
		};
		const dynamic: DynamicEntityEvent = {
			kind: "snapshot",
			snapshot: state.dynamic,
		};
		if (!this.mirror.apply(dynamic)) {
			throw new Error(
				"Client current-state snapshot was rejected by the dynamic mirror.",
			);
		}
		this.#emit({ type: "current-state", state });
		this.#emit({ type: "dynamic", event: dynamic });
	}

	#receiveLifecycle(payload: unknown): void {
		const lifecycle = decodeClientLifecycle(payload);
		if (lifecycle.kind !== "entering-world") {
			this.#entryRequestGuid = null;
		}
		this.#state = { ...this.#state, lifecycle };
		this.#emit({ type: "lifecycle", lifecycle });
	}

	#receiveServerTime(payload: unknown): void {
		const { time } = decodeClientServerTime(payload);
		this.#state = { ...this.#state, serverTime: time };
		this.#emit({ type: "server-time", time });
	}

	#receiveDiscontinuity(payload: unknown): void {
		const discontinuity = decodeClientWorldDiscontinuity(payload);
		if (discontinuity.worldGeneration < this.#state.worldGeneration) return;
		this.#state = {
			...this.#state,
			worldGeneration: discontinuity.worldGeneration,
		};
		this.#emit({ type: "world-discontinuity", discontinuity });
	}

	#receiveCameraStarted(payload: unknown): void {
		this.#emit({
			type: "camera-started",
			receipt: decodeClientCameraStartReceipt(payload),
		});
	}

	#receiveCamera(payload: unknown): void {
		this.#emit({ type: "camera", tick: decodeClientCameraTick(payload) });
	}

	#receiveExit(payload: unknown): void {
		const exit = decodeClientExitRequested(payload);
		const lifecycle: ClientLifecycle = { kind: "exiting", cause: exit.cause };
		this.#state = { ...this.#state, lifecycle, exit };
		this.#emit({ type: "lifecycle", lifecycle });
		this.#emit({ type: "exit-requested", exit });
	}

	#emit(event: ClientLifecycleSessionEvent): void {
		for (const listener of this.#listeners) listener(event);
	}
}

function emptyState(): ClientLifecycleSessionState {
	return {
		lifecycle: null,
		serverTime: null,
		worldGeneration: 0,
		exit: null,
	};
}

export function hostClientLifecycleTransport(
	host: HostTransport,
): ClientLifecycleTransport {
	return {
		invoke: (command, args) => host.invoke(command, args),
		listen: (event, handler) => host.listen(event, handler),
	};
}
