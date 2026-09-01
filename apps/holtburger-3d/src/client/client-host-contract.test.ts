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
} from "./client-host-contract";

describe("client host wire contract", () => {
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
				channel: "General",
				message: "Hello",
			}),
		).toEqual({
			kind: "channel",
			sender: "Mira",
			channel: "General",
			message: "Hello",
		});
		expect(() =>
			decodeClientChatMessage({
				kind: "channel",
				sender: "Mira",
				channel: "General",
				message: "Hello",
				extra: true,
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
