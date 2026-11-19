import {
	cellId,
	type DynamicEntityTickBatch,
	type DynamicEntityView,
} from "../../lib/game/runtime/dynamic-entity-feed";
import type { ClientCameraTick, ClientCurrentState } from "./host-contract";
import { baselineCurrentState } from "./host-contract.test-support";
import type { ClientLifecycleTransport } from "./lifecycle-session";

export function controlledPromise<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve: (value: T) => void = () => {
		throw new Error("Controlled promise was not initialized.");
	};
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve: (value) => resolve(value) };
}

export function dynamicEntityViewFixture(
	guid: number,
	overrides: Partial<DynamicEntityView> = {},
): DynamicEntityView {
	return {
		generation: 1,
		identity: { guid, wcid: 42 },
		display: { name: "Drudge", level: null },
		presentation: {
			placementFrame: 0,
			entityClass: "other",
			content: {
				motionTableDid: null,
				setupDid: 0x0200_0001,
				soundTableDid: null,
				physicsEffectTableDid: null,
			},
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			objectScale: 1,
			radar: {
				behavior: null,
				category: "other",
				obviousRange: null,
			},
		},
		physics: {
			semanticMask: 0,
			participation: "pose-only",
			noDraw: false,
			hidden: false,
			cloaked: false,
			translucency: 0,
			lighting: false,
			defaultAnimation: false,
			defaultScript: false,
		},
		placement: {
			kind: "attached",
			parent: 0,
			parentLocation: "none",
			placement: "default",
		},
		motion: null,
		...overrides,
	};
}

export function worldDynamicEntityViewFixture(
	guid: number,
	landblockId = 0x0101_0100,
	overrides: Partial<DynamicEntityView> = {},
): DynamicEntityView {
	return dynamicEntityViewFixture(guid, {
		display: { name: "Player", level: null },
		placement: {
			kind: "world",
			pose: {
				landblockId: cellId(landblockId),
				coords: { x: 4, y: 5, z: 6 },
				rotation: { w: 1, x: 0, y: 0, z: 0 },
			},
			spatialMembership: {
				reachesOutdoors: false,
				reachedEnvCellIds: [cellId(0x0101_0001)],
			},
			contact: "grounded",
			sampleMode: "authoritative-only",
		},
		...overrides,
	});
}

export function advanceBatchFixture(
	guid: number,
	landblockId = 0x0101_0100,
	kind: "integrated" | "correction-snap" | "teleport" | "reset" = "integrated",
	hostTime = 76,
): DynamicEntityTickBatch {
	const entity = worldDynamicEntityViewFixture(guid, landblockId);
	if (entity.placement.kind !== "world")
		throw new Error("test view must be world placed");
	const endpoint = {
		pose: entity.placement.pose,
		spatialMembership: entity.placement.spatialMembership,
	};
	return {
		hostTime: { seconds: hostTime },
		durationMs: 100,
		advances: [
			{
				entity,
				kind,
				path: { initial: endpoint, legs: [{ endFraction: 1, end: endpoint }] },
			},
		],
		updates: [],
	};
}

function cameraTick(
	identity: {
		readonly cameraGeneration: number;
		readonly playerGuid: number;
		readonly entityGeneration: number;
	},
	kind: "reseeded" | "fallback",
): ClientCameraTick {
	const point = {
		landblockId: 0x0100_ffff,
		coords: { x: 12, y: 3, z: 2 },
	};
	const path = {
		initial: { position: point, visualPivot: point },
		legs: [{ endFraction: 1, end: { position: point, visualPivot: point } }],
	};
	if (kind === "fallback") {
		return {
			kind: "fallback",
			...identity,
			sequence: 1,
			durationMs: 30,
			targetSphereRole: "primary",
			desiredReach: 4.5,
			convergence: "converging",
			path,
			reason: "free-sphere-query",
			diagnostics: {
				collisionProof: { status: "covered" },
				controlLegs: 0,
				clearanceSweeps: 0,
				continuitySweeps: 0,
				contactPasses: 8,
			},
		};
	}
	return {
		kind: "reseeded",
		...identity,
		sequence: 1,
		durationMs: 30,
		targetSphereRole: "primary",
		clearance: { projectionRevision: 1, radius: 0.2 },
		desiredReach: 4.5,
		renderedReach: 4.5,
		convergence: "settled",
		path,
		reason: "initial-placement",
		diagnostics: {
			collisionProof: { status: "covered" },
			controlLegs: 0,
			clearanceSweeps: 0,
			continuitySweeps: 0,
			contactPasses: 0,
		},
	};
}

export class FakeClientTransport implements ClientLifecycleTransport {
	readonly calls: string[] = [];
	readonly invocations: Array<{
		command: string;
		args: Record<string, unknown> | undefined;
	}> = [];
	readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
	readonly acknowledgedWorldReveals: number[] = [];
	readonly cameraClearances: {
		projectionRevision: number;
		clearanceRadius: number;
	}[] = [];
	cameraStarts = 0;
	#currentState: ClientCurrentState;
	#emitLaggedDeltaBeforeSnapshot = false;
	#emitLaggedAdvance = false;
	#cameraGeneration = 0;
	#cameraOutput: "proven" | "fallback" | "none" | "wrong-generation" = "proven";

	constructor(
		currentState: ClientCurrentState = baselineCurrentState(0x5000_0001, {
			serverTime: 10,
			worldGeneration: 2,
			worldName: "Leafcull",
			playerName: "Drudge",
			dynamic: {
				hostTime: { seconds: 10 },
				entities: [dynamicEntityViewFixture(0x5000_0001)],
			},
		}),
	) {
		this.#currentState = currentState;
	}

	async listen(
		event: string,
		handler: (payload: unknown) => void,
	): Promise<() => void> {
		this.calls.push(`listen:${event}`);
		const handlers =
			this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
		handlers.add(handler);
		this.handlers.set(event, handlers);
		return () => {
			this.calls.push(`unlisten:${event}`);
			handlers.delete(handler);
			if (handlers.size === 0) this.handlers.delete(event);
		};
	}

	async invoke(command: string, args?: Record<string, unknown>): Promise<void> {
		this.calls.push(`invoke:${command}`);
		this.invocations.push({ command, args });
		if (command === "acknowledge_client_world_reveal") {
			const worldGeneration = args?.worldGeneration;
			if (typeof worldGeneration !== "number") {
				throw new Error("World reveal acknowledgement omitted its generation.");
			}
			this.acknowledgedWorldReveals.push(worldGeneration);
			return;
		}
		if (command === "start_client_camera") {
			this.cameraStarts += 1;
			const request = args?.request as {
				playerGuid: number;
				entityGeneration: number;
			};
			this.#cameraGeneration += 1;
			const identity = {
				cameraGeneration: this.#cameraGeneration,
				playerGuid: request.playerGuid,
				entityGeneration: request.entityGeneration,
			};
			this.emit("client-camera-started", identity);
			if (this.#cameraOutput === "none") return;
			const tickIdentity =
				this.#cameraOutput === "wrong-generation"
					? { ...identity, cameraGeneration: identity.cameraGeneration + 1 }
					: identity;
			this.emit(
				"client-camera",
				cameraTick(
					tickIdentity,
					this.#cameraOutput === "fallback" ? "fallback" : "reseeded",
				),
			);
			return;
		}
		if (command === "set_client_camera_clearance") {
			this.cameraClearances.push(
				args?.request as {
					projectionRevision: number;
					clearanceRadius: number;
				},
			);
			return;
		}
		if (command !== "request_client_current_state") return;
		if (this.#emitLaggedDeltaBeforeSnapshot) {
			this.emit("client-dynamic-entity", {
				kind: "upserted",
				entity: dynamicEntityViewFixture(0x5000_0003),
			});
		}
		if (this.#emitLaggedAdvance) {
			this.emit("client-dynamic-entity", {
				kind: "ticked",
				batch: advanceBatchFixture(this.#currentState.localPlayerGuid ?? 0),
			});
		}
		this.emit("client-current-state", this.#currentState);
	}

	setCurrentState(state: ClientCurrentState): void {
		this.#currentState = state;
	}

	setEmitLaggedDeltaBeforeSnapshot(enabled: boolean): void {
		this.#emitLaggedDeltaBeforeSnapshot = enabled;
	}

	setEmitLaggedAdvance(enabled: boolean): void {
		this.#emitLaggedAdvance = enabled;
	}

	setCameraOutput(
		output: "proven" | "fallback" | "none" | "wrong-generation",
	): void {
		this.#cameraOutput = output;
	}

	emit(event: string, payload: unknown): void {
		for (const handler of this.handlers.get(event) ?? []) handler(payload);
	}
}
