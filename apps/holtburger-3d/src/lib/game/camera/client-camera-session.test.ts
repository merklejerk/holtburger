import { describe, expect, it } from "vitest";

import type {
	ClientCurrentState,
	ClientCameraIdentity,
	ClientCameraTick,
} from "../../../client/client-host-contract";
import {
	ClientLifecycleSession,
	type ClientLifecycleTransport,
} from "../../../client/client-lifecycle-session";
import { createProjectionClearanceRevision } from "./projection-clearance";
import { ClientCameraSession } from "./client-camera-session";
import { cellId } from "../runtime/dynamic-entity-feed";

const PLAYER_GUID = 0x5000_0001;
const IDENTITY: ClientCameraIdentity = {
	cameraGeneration: 1,
	playerGuid: PLAYER_GUID,
	entityGeneration: 1,
};
const PROJECTION = createProjectionClearanceRevision(
	1,
	{ fov: 75, near: 0.1 },
	{ height: 720, width: 1_280 },
);
const TARGET = { playerGuid: PLAYER_GUID, entityGeneration: 1 } as const;
const DISTANCE = { initial: 4.5, minimum: 1.2, maximum: 8 } as const;

class FakeTransport implements ClientLifecycleTransport {
	readonly calls: Array<{ command: string; args: unknown }> = [];
	readonly handlers = new Map<string, (payload: unknown) => void>();

	async listen(
		event: string,
		handler: (payload: unknown) => void,
	): Promise<() => void> {
		this.handlers.set(event, handler);
		return () => this.handlers.delete(event);
	}

	async invoke(command: string, args?: unknown): Promise<void> {
		this.calls.push({ command, args });
		if (command === "request_client_current_state")
			this.emit("client-current-state", currentState());
		if (command === "start_client_camera")
			this.emit("client-camera-started", IDENTITY);
	}

	emit(event: string, payload: unknown): void {
		this.handlers.get(event)?.(payload);
	}
}

describe("ClientCameraSession", () => {
	it("awaits the generation receipt before accepting camera output", async () => {
		const transport = new FakeTransport();
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const camera = new ClientCameraSession(lifecycle);

		await camera.start(TARGET, DISTANCE, [0, 0, -1], PROJECTION);
		camera.receive(tick(1, 10, 14), 100);

		expect(camera.status()).toMatchObject({
			kind: "active",
			identity: IDENTITY,
			sequence: 1,
		});
		expect(camera.presentation(116)?.placement.position.x).toBeCloseTo(
			camera.presentation(100)!.placement.position.x + 2,
		);
	});

	it("accumulates zoom and sends only changed semantic intent", async () => {
		const transport = new FakeTransport();
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const camera = new ClientCameraSession(lifecycle);
		await camera.start(TARGET, DISTANCE, [0, 0, -1], PROJECTION);

		await camera.setIntent([0, 0, -1], 0.75);
		await camera.setIntent([0, 0, -1], 0);
		await camera.setIntent([1, 0, 0], -0.25);

		const intents = transport.calls.filter(
			({ command }) => command === "set_client_camera_intent",
		);
		expect(
			intents.map(({ args }) => (args as { request: unknown }).request),
		).toEqual([
			{
				...IDENTITY,
				inputSequence: 1,
				viewDirection: [0, 0, -1],
				cumulativeZoomDisplacement: 0.75,
			},
			{
				...IDENTITY,
				inputSequence: 2,
				viewDirection: [1, 0, 0],
				cumulativeZoomDisplacement: 0.5,
			},
		]);
	});

	it("surfaces an uncovered camera path without withdrawing playback", async () => {
		const transport = new FakeTransport();
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const camera = new ClientCameraSession(lifecycle);
		await camera.start(TARGET, DISTANCE, [0, 0, -1], PROJECTION);
		const uncovered = {
			...tick(1, 10, 14),
			diagnostics: {
				...tick(1, 10, 14).diagnostics,
				collisionProof: { status: "uncovered", owner: 0xda55_ffff },
			},
		} satisfies ClientCameraTick;

		camera.receive(uncovered, 100);

		expect(camera.presentation(116)).not.toBeNull();
		expect(camera.status()).toMatchObject({
			kind: "active",
			diagnostics: {
				collisionProof: { status: "uncovered", owner: 0xda55_ffff },
			},
		});
	});

	it("presents fallback without projection proof and replaces it immediately when proven", async () => {
		const transport = new FakeTransport();
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const camera = new ClientCameraSession(lifecycle);
		await camera.start(TARGET, DISTANCE, [0, 0, -1], PROJECTION);
		camera.receive(fallback(1, 50), 100);

		expect(camera.presentation(100)?.placement.position.x).toBeCloseTo(
			50 + 0xda * 192,
		);
		expect(camera.acknowledgedProjection(100)).toBeNull();
		expect(camera.status()).toMatchObject({
			kind: "active",
			clearance: null,
			renderedReach: 0,
			placementOutcome: {
				kind: "fallback",
				reason: "free-sphere-query",
			},
		});

		camera.receive(tick(2, 10, 14), 101);
		expect(camera.presentation(101)?.placement.position.x).toBeCloseTo(
			10 + 0xda * 192,
		);
		expect(camera.acknowledgedProjection(101)?.revision).toBe(1);
	});

	it("drops stale generations and clears projection/path state on stop", async () => {
		const transport = new FakeTransport();
		const lifecycle = new ClientLifecycleSession(transport);
		await lifecycle.start();
		const camera = new ClientCameraSession(lifecycle);
		await camera.start(TARGET, DISTANCE, [0, 0, -1], PROJECTION);
		camera.receive(tick(1, 10, 14), 100);
		camera.receive({ ...tick(2, 14, 18), cameraGeneration: 99 }, 101);

		expect(camera.status()).toMatchObject({ sequence: 1 });
		await camera.stop();
		expect(camera.status()).toEqual({ kind: "stopped" });
		expect(camera.presentation(200)).toBeNull();
	});
});

function currentState(): ClientCurrentState {
	return {
		lifecycle: { kind: "in-world" },
		localPlayerGuid: PLAYER_GUID,
		serverTime: 10,
		worldGeneration: 1,
		worldName: "Leafcull",
		playerName: "Drudge",
		vitals: [],
		characterMotion: null,
		dynamic: {
			hostTime: { seconds: 10 },
			entities: [
				{
					generation: 1,
					identity: { guid: PLAYER_GUID, wcid: 42 },
					display: { name: "Drudge", level: null },
					presentation: {
						entityClass: "player",
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
							blipColor: "Default",
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
						lighting: false,
						defaultAnimation: false,
						defaultScript: false,
					},
					placement: {
						kind: "world",
						pose: {
							landblockId: cellId(0xda55_ffff),
							coords: { x: 0, y: 0, z: 0 },
							rotation: { w: 1, x: 0, y: 0, z: 0 },
						},
						spatialMembership: { reachesOutdoors: true, reachedEnvCellIds: [] },
						contact: "grounded",
						sampleMode: "authoritative-only",
					},
					motion: null,
				},
			],
		},
	};
}

function tick(
	sequence: number,
	startX: number,
	endX: number,
): ClientCameraTick {
	return {
		kind: "advanced",
		...IDENTITY,
		sequence,
		durationMs: 32,
		targetSphereRole: "primary",
		clearance: {
			projectionRevision: PROJECTION.revision,
			radius: PROJECTION.clearanceRadius,
		},
		desiredReach: 4.5,
		renderedReach: 4.5,
		convergence: "converging",
		path: {
			initial: pathPoint(startX),
			legs: [{ endFraction: 1, end: pathPoint(endX) }],
		},
		diagnostics: {
			collisionProof: { status: "covered" },
			controlLegs: 1,
			clearanceSweeps: 1,
			transitSubsteps: 1,
			contactPasses: 0,
		},
	};
}

function fallback(sequence: number, x: number): ClientCameraTick {
	return {
		kind: "fallback",
		...IDENTITY,
		sequence,
		durationMs: 32,
		targetSphereRole: "primary",
		desiredReach: 4.5,
		convergence: "converging",
		path: {
			initial: pathPoint(x),
			legs: [{ endFraction: 1, end: pathPoint(x) }],
		},
		reason: "free-sphere-query",
		diagnostics: {
			collisionProof: { status: "covered" },
			controlLegs: 0,
			clearanceSweeps: 0,
			transitSubsteps: 0,
			contactPasses: 8,
		},
	};
}

function pathPoint(x: number) {
	return {
		position: { landblockId: 0xda55_ffff, coords: { x, y: 20, z: 3 } },
		visualPivot: {
			landblockId: 0xda55_ffff,
			coords: { x: x + 100, y: 20, z: 3 },
		},
	};
}
