import { decode, encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";

import {
	decodeClientChatMessage,
	decodeClientCameraTick,
	decodeClientLifecycle,
	decodeClientLocalPlayerEstablished,
	decodeClientVitals,
	decodeClientPreciseJumpAimRequest,
	decodeClientPreciseJumpEvaluation,
	decodeClientEntitySelectionQueryRequest,
	decodeClientEntitySelectionQueryResult,
} from "./client-host-contract";

describe("client host wire contract", () => {
	it("keeps selection availability, emptiness, and strict request shape distinct", () => {
		const camera = {
			cameraGeneration: 2,
			playerGuid: 0x5000_0001,
			entityGeneration: 7,
		};
		expect(
			decodeClientEntitySelectionQueryRequest({
				camera,
				sequence: 9,
				anchor: 0xda55_ffff,
				start: [1, 2, 3],
				direction: [0, 1, 0],
				previousCell: null,
			}),
		).toMatchObject({ sequence: 9 });
		expect(
			decodeClientEntitySelectionQueryResult({
				status: "available",
				sequence: 9,
				staticLimitDistance: 192,
				candidateGuids: [],
			}),
		).toMatchObject({ status: "available", candidateGuids: [] });
		expect(
			decodeClientEntitySelectionQueryResult({
				status: "unavailable",
				sequence: 10,
				reason: "stale-camera",
			}),
		).toMatchObject({ status: "unavailable", reason: "stale-camera" });
		expect(
			decodeClientEntitySelectionQueryResult({
				status: "unavailable",
				sequence: 11,
				reason: "missing-collision-owner",
				missingCollisionOwner: 0xda55_ffff,
			}),
		).toMatchObject({
			missingCollisionOwner: 0xda55_ffff,
			reason: "missing-collision-owner",
		});
		expect(() =>
			decodeClientEntitySelectionQueryResult({
				status: "unavailable",
				sequence: 12,
				reason: "missing-collision-owner",
			}),
		).toThrow();
		expect(() =>
			decodeClientEntitySelectionQueryResult({
				status: "unavailable",
				sequence: 13,
				reason: "stale-camera",
				missingCollisionOwner: 0xda55_ffff,
			}),
		).toThrow();
		expect(() =>
			decodeClientEntitySelectionQueryRequest({
				camera,
				sequence: 9,
				anchor: 0xda55_ffff,
				start: [1, 2, 3],
				direction: [0, 1, 0],
				previousCell: null,
				maximumDistance: 192,
			}),
		).toThrow();
	});
	it("decodes Rust-shaped lifecycle and local-player identity independently", () => {
		const payload = encode({
			kind: "event",
			event: {
				event: "client-lifecycle-changed",
				payload: { kind: "in-world" },
			},
		});
		const frame = decode(payload);
		if (
			typeof frame !== "object" ||
			frame === null ||
			!("event" in frame) ||
			typeof frame.event !== "object" ||
			frame.event === null ||
			!("payload" in frame.event)
		) {
			throw new Error("encoded lifecycle frame did not decode as an event");
		}

		expect(decodeClientLifecycle(frame.event.payload)).toEqual({
			kind: "in-world",
		});
		expect(
			decodeClientLocalPlayerEstablished({ playerGuid: 0x5000_0008 }),
		).toEqual({ playerGuid: 0x5000_0008 });
	});

	it("decodes focused HUD and combined-chat projections strictly", () => {
		expect(
			decodeClientVitals({
				vitals: [{ kind: "health", current: 80, maximum: 100 }],
			}),
		).toEqual({
			vitals: [{ kind: "health", current: 80, maximum: 100 }],
		});
		expect(
			decodeClientChatMessage({
				kind: "channel",
				sender: "Mira",
				speakerKind: "player",
				channel: "general",
				message: "Hello",
			}),
		).toEqual({
			kind: "channel",
			sender: "Mira",
			speakerKind: "player",
			channel: "general",
			message: "Hello",
		});
		expect(() =>
			decodeClientChatMessage({
				kind: "channel",
				sender: "Mira",
				speakerKind: "player",
				channel: "general",
				message: "Hello",
				extra: true,
			}),
		).toThrow();
		expect(
			decodeClientChatMessage({
				kind: "combat",
				message: "You hit a Drudge for 37 slash damage.",
				emphasized: true,
			}),
		).toEqual({
			kind: "combat",
			message: "You hit a Drudge for 37 slash damage.",
			emphasized: true,
		});
		expect(
			decodeClientChatMessage({
				kind: "speech",
				sender: "Drudge",
				speakerKind: "non-player",
				message: "Grrr.",
			}),
		).toEqual({
			kind: "speech",
			sender: "Drudge",
			speakerKind: "non-player",
			message: "Grrr.",
		});
		expect(() =>
			decodeClientChatMessage({
				kind: "speech",
				sender: "Mira",
				speakerKind: "player",
				channel: "general",
				message: "Hello",
			}),
		).toThrow();
	});

	it("separates proven camera ticks from unproven fallback by shape", () => {
		const point = {
			position: {
				landblockId: 0xda55_ffff,
				coords: { x: 10, y: 20, z: 3 },
			},
			visualPivot: {
				landblockId: 0xda55_ffff,
				coords: { x: 10, y: 20, z: 3 },
			},
		};
		const common = {
			cameraGeneration: 1,
			playerGuid: 0x5000_0001,
			entityGeneration: 1,
			sequence: 1,
			durationMs: 30,
			targetSphereRole: "upper-constraint",
			desiredReach: 4.5,
			convergence: "converging",
			path: {
				initial: point,
				legs: [{ endFraction: 1, end: point }],
			},
			diagnostics: {
				collisionProof: { status: "covered" },
				controlLegs: 0,
				clearanceSweeps: 0,
				transitSubsteps: 0,
				contactPasses: 8,
			},
		} as const;

		expect(
			decodeClientCameraTick({
				...common,
				kind: "fallback",
				reason: "free-sphere-query",
			}),
		).not.toHaveProperty("clearance");
		expect(() =>
			decodeClientCameraTick({
				...common,
				kind: "held",
				clearance: null,
				renderedReach: 0,
				reason: "free-sphere-query",
			}),
		).toThrow();
	});

	it("keeps precise-jump launch authority out of strict renderer contracts", () => {
		const camera = {
			cameraGeneration: 1,
			playerGuid: 0x5000_0001,
			entityGeneration: 4,
		};
		const evaluation = {
			evaluationId: 7,
			camera,
			sequence: 12,
			target: {
				anchor: 0xda55_ffff,
				point: [12, 30, 1],
				normal: [0, 0, 1],
				committedCell: null,
			},
			trajectory: {
				anchor: 0xda55_ffff,
				origin: [18, 30, 0.005],
				velocity: [-6, 0, 5],
				acceleration: [0, 0, -9.8],
				durationSeconds: 1,
				placements: [
					{
						startFraction: 0,
						endFraction: 1,
						committedCell: null,
					},
				],
			},
			status: "reachable",
			diagnostics: {
				generatedCandidates: 6,
				evaluatedCandidates: 3,
				solverTicks: 88,
			},
		};
		expect(decodeClientPreciseJumpEvaluation(evaluation)).toMatchObject({
			evaluationId: 7,
			status: "reachable",
		});
		expect(() =>
			decodeClientPreciseJumpEvaluation({ ...evaluation, velocity: [1, 2, 3] }),
		).toThrow();
		expect(() =>
			decodeClientPreciseJumpEvaluation({
				...evaluation,
				status: "unreachable",
			}),
		).toThrow();
		expect(() =>
			decodeClientPreciseJumpEvaluation({
				...evaluation,
				trajectory: {
					...evaluation.trajectory,
					placements: [
						{
							startFraction: 0.2,
							endFraction: 1,
							committedCell: null,
						},
					],
				},
			}),
		).toThrow();
		expect(() =>
			decodeClientPreciseJumpAimRequest({
				camera,
				sequence: 13,
				anchor: 0xda55_ffff,
				start: [Number.POSITIVE_INFINITY, 0, 0],
				direction: [0, 1, 0],
				maximumDistance: 80,
				previousCell: null,
			}),
		).toThrow();
	});
});
