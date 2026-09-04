import { z } from "zod";
import {
	decodeDynamicEntitySnapshot,
	type DynamicEntitySnapshot,
} from "../lib/game/runtime/dynamic-entity-feed";
import {
	landblockVector3,
	type LandblockVector3,
} from "../lib/assets/ac-frame";

const guid = z.number().int().nonnegative().max(0xffff_ffff);
const finiteNumber = z.number().finite();

const vitalSchema = z
	.object({
		kind: z.enum(["health", "stamina", "mana"]),
		current: z.number().int().nonnegative(),
		maximum: z.number().int().nonnegative(),
	})
	.strict();

const chatChannelSchema = z.enum([
	"fellowship",
	"allegiance",
	"vassals",
	"patron",
	"monarch",
	"co-vassals",
	"general",
	"trade",
	"lfg",
	"roleplay",
	"society",
	"olthoi",
	"unknown",
]);
const chatSpeakerKindSchema = z.enum(["player", "non-player", "unknown"]);

const chatMessageSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.enum(["speech", "tell", "emote"]),
			sender: z.string(),
			speakerKind: chatSpeakerKindSchema,
			message: z.string(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("channel"),
			channel: chatChannelSchema,
			sender: z.string(),
			speakerKind: chatSpeakerKindSchema,
			message: z.string(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("system"),
			message: z.string(),
		})
		.strict(),
	z
		.object({
			kind: z.literal("combat"),
			message: z.string(),
			emphasized: z.boolean(),
		})
		.strict(),
]);

const characterSchema = z
	.object({
		guid,
		name: z.string(),
		slot: z.number().int().nonnegative(),
		deleteTime: z.number().int().nonnegative(),
	})
	.strict();

const exitCauseSchema = z.enum([
	"explicit-disconnect",
	"server-disconnect",
	"startup-failure",
	"runtime-failure",
	"host-shutdown",
]);

const worldActivationCauseSchema = z.enum(["initial-entry", "teleport"]);

const lifecycleSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("connecting") }).strict(),
	z.object({ kind: z.literal("authenticating") }).strict(),
	z
		.object({
			kind: z.literal("character-selection"),
			characters: z.array(characterSchema),
		})
		.strict(),
	z
		.object({
			kind: z.literal("entering-world"),
			characterGuid: guid,
		})
		.strict(),
	z
		.object({
			kind: z.literal("portal-space"),
			worldGeneration: z.number().int().nonnegative(),
			cause: worldActivationCauseSchema,
		})
		.strict(),
	z.object({ kind: z.literal("in-world") }).strict(),
	z
		.object({
			kind: z.literal("exiting"),
			cause: exitCauseSchema,
		})
		.strict(),
]);

const clientCharacterMotionCapabilitiesSchema = z
	.object({
		fullChargeDurationMs: finiteNumber.positive(),
	})
	.strict();

const clientCharacterMotionRejectionSchema = z.enum([
	"charge-not-active",
	"airborne",
	"unsupported",
	"overburdened",
	"capability-unavailable",
	"body-unavailable",
	"collision-unavailable",
	"launch-rejected",
]);

const clientCharacterMotionOutcomeSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("charge-accepted") }).strict(),
	z.object({ kind: z.literal("charge-continues") }).strict(),
	z.object({ kind: z.literal("jump-committed") }).strict(),
	z.object({ kind: z.literal("reset") }).strict(),
	z
		.object({
			kind: z.literal("rejected"),
			reason: clientCharacterMotionRejectionSchema,
		})
		.strict(),
]);

const clientCharacterMotionFeedbackSchema = z
	.object({
		sequence: z.number().int().nonnegative().safe(),
		outcome: clientCharacterMotionOutcomeSchema,
	})
	.strict();

const currentStateSchema = z
	.object({
		lifecycle: lifecycleSchema,
		localPlayerGuid: guid.nullable(),
		serverTime: finiteNumber.nullable(),
		worldGeneration: z.number().int().nonnegative(),
		worldName: z.string().nullable(),
		playerName: z.string().nullable(),
		vitals: z.array(vitalSchema),
		characterMotion: clientCharacterMotionCapabilitiesSchema.nullable(),
		dynamic: z.unknown(),
	})
	.strict();

const presentationDiscontinuitySchema = z
	.object({
		worldGeneration: z.number().int().nonnegative(),
		kind: z.enum(["forced-reposition", "reset"]),
	})
	.strict();

const localPlayerEstablishedSchema = z.object({ playerGuid: guid }).strict();
const playerEnteredSchema = z
	.object({ playerGuid: guid, name: z.string() })
	.strict();

const dynamicScriptCueSchema = z
	.object({
		guid,
		generation: z.number().int().nonnegative(),
		cue: z.number().int().nonnegative(),
		intensity: finiteNumber,
	})
	.strict();

const exitRequestedSchema = z
	.object({
		cause: exitCauseSchema,
		diagnostic: z.string(),
	})
	.strict();

const clientDriveRequestSchema = z
	.object({
		gait: z.enum(["walk", "run"]),
		longitudinal: z.enum(["forward", "backward"]).nullable(),
		lateral: z.enum(["left", "right"]).nullable(),
		turning: z.enum(["left", "right"]).nullable(),
	})
	.strict();

const clientCharacterMotionEventRequestSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("begin-jump"),
			sequence: z.number().int().nonnegative().safe(),
			drive: clientDriveRequestSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("release-jump"),
			sequence: z.number().int().nonnegative().safe(),
			drive: clientDriveRequestSchema,
			extent: finiteNumber.min(0.001).max(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("reset"),
			sequence: z.number().int().nonnegative().safe(),
		})
		.strict(),
]);

const cameraIdentitySchema = z
	.object({
		cameraGeneration: z.number().int().positive().safe(),
		playerGuid: guid,
		entityGeneration: z.number().int().nonnegative().safe(),
	})
	.strict();
const cameraPointSchema = z
	.object({
		landblockId: guid,
		coords: z
			.object({ x: finiteNumber, y: finiteNumber, z: finiteNumber })
			.strict(),
	})
	.strict();
const cameraPathPointSchema = z
	.object({ position: cameraPointSchema, visualPivot: cameraPointSchema })
	.strict();
const cameraPathSchema = z
	.object({
		initial: cameraPathPointSchema,
		legs: z
			.array(
				z
					.object({
						endFraction: finiteNumber,
						end: cameraPathPointSchema,
					})
					.strict(),
			)
			.nonempty(),
	})
	.strict();
const cameraClearanceSchema = z
	.object({
		projectionRevision: z.number().int().positive().safe(),
		radius: finiteNumber.positive(),
	})
	.strict();
const cameraCollisionProofSchema = z.discriminatedUnion("status", [
	z.object({ status: z.literal("covered") }).strict(),
	z.object({ status: z.literal("uncovered"), owner: guid }).strict(),
]);
const cameraDiagnosticsSchema = z
	.object({
		collisionProof: cameraCollisionProofSchema,
		controlLegs: z.number().int().nonnegative().safe(),
		clearanceSweeps: z.number().int().nonnegative().safe(),
		transitSubsteps: z.number().int().nonnegative().safe(),
		contactPasses: z.number().int().nonnegative().safe(),
	})
	.strict();
const cameraFailureReasonSchema = z.enum([
	"clearance-sweep",
	"free-sphere-query",
	"target-contract",
	"controller-input",
	"path-projection",
]);
const cameraConvergenceSchema = z.enum(["converging", "settled"]);
const cameraTickSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("advanced"),
			...cameraIdentitySchema.shape,
			sequence: z.number().int().positive().safe(),
			durationMs: finiteNumber.positive(),
			targetSphereRole: z.enum(["primary", "upper-constraint"]),
			clearance: cameraClearanceSchema,
			desiredReach: finiteNumber.nonnegative(),
			renderedReach: finiteNumber.nonnegative(),
			path: cameraPathSchema,
			diagnostics: cameraDiagnosticsSchema,
			convergence: cameraConvergenceSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("reseeded"),
			...cameraIdentitySchema.shape,
			sequence: z.number().int().positive().safe(),
			durationMs: finiteNumber.positive(),
			targetSphereRole: z.enum(["primary", "upper-constraint"]),
			clearance: cameraClearanceSchema,
			desiredReach: finiteNumber.nonnegative(),
			renderedReach: finiteNumber.nonnegative(),
			path: cameraPathSchema,
			reason: z.enum([
				"initial-placement",
				"placed-path",
				"placement-recovery",
			]),
			diagnostics: cameraDiagnosticsSchema,
			convergence: cameraConvergenceSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("held"),
			...cameraIdentitySchema.shape,
			sequence: z.number().int().positive().safe(),
			durationMs: finiteNumber.positive(),
			targetSphereRole: z.enum(["primary", "upper-constraint"]),
			clearance: cameraClearanceSchema,
			desiredReach: finiteNumber.nonnegative(),
			renderedReach: finiteNumber.nonnegative(),
			path: cameraPathSchema,
			reason: cameraFailureReasonSchema,
			diagnostics: cameraDiagnosticsSchema,
			convergence: cameraConvergenceSchema,
		})
		.strict(),
	z
		.object({
			kind: z.literal("fallback"),
			...cameraIdentitySchema.shape,
			sequence: z.number().int().positive().safe(),
			durationMs: finiteNumber.positive(),
			targetSphereRole: z.enum(["primary", "upper-constraint"]),
			desiredReach: finiteNumber.nonnegative(),
			path: cameraPathSchema,
			reason: cameraFailureReasonSchema,
			diagnostics: cameraDiagnosticsSchema,
			convergence: cameraConvergenceSchema,
		})
		.strict(),
]);
const cameraStartedSchema = cameraIdentitySchema.extend({}).strict();
const vector3TupleSchema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const preciseJumpTargetSchema = z
	.object({
		anchor: guid,
		point: vector3TupleSchema,
		normal: vector3TupleSchema,
		committedCell: guid.nullable(),
	})
	.strict();
const preciseJumpDiagnosticsSchema = z
	.object({
		generatedCandidates: z.number().int().nonnegative().safe(),
		evaluatedCandidates: z.number().int().nonnegative().safe(),
		solverTicks: z.number().int().nonnegative().safe(),
	})
	.strict();

const preciseJumpTrajectoryPlacementSchema = z
	.object({
		startFraction: finiteNumber.min(0).max(1),
		endFraction: finiteNumber.min(0).max(1),
		committedCell: guid.nullable(),
	})
	.strict()
	.refine(
		(placement) => placement.endFraction > placement.startFraction,
		"Trajectory placement must span a positive time interval.",
	);
const preciseJumpTrajectorySchema = z
	.object({
		anchor: guid,
		origin: vector3TupleSchema,
		velocity: vector3TupleSchema,
		acceleration: vector3TupleSchema,
		durationSeconds: finiteNumber.positive(),
		placements: z.array(preciseJumpTrajectoryPlacementSchema).nonempty(),
	})
	.strict()
	.superRefine((trajectory, context) => {
		if (trajectory.placements[0]?.startFraction !== 0) {
			context.addIssue({
				code: "custom",
				message: "Trajectory placements must begin at zero.",
				path: ["placements", 0, "startFraction"],
			});
		}
		for (let index = 1; index < trajectory.placements.length; index += 1) {
			if (
				trajectory.placements[index - 1]?.endFraction !==
				trajectory.placements[index]?.startFraction
			) {
				context.addIssue({
					code: "custom",
					message: "Trajectory placements must form a gap-free partition.",
					path: ["placements", index, "startFraction"],
				});
			}
		}
		if (trajectory.placements.at(-1)?.endFraction !== 1) {
			context.addIssue({
				code: "custom",
				message: "Trajectory placements must end at one.",
				path: ["placements", trajectory.placements.length - 1, "endFraction"],
			});
		}
	});
const preciseJumpEvaluationCommonShape = {
	evaluationId: z.number().int().positive().safe(),
	camera: cameraIdentitySchema,
	sequence: z.number().int().nonnegative().safe(),
	diagnostics: preciseJumpDiagnosticsSchema,
} as const;
const preciseJumpEvaluationSchema = z.discriminatedUnion("status", [
	z
		.object({
			...preciseJumpEvaluationCommonShape,
			status: z.literal("reachable"),
			target: preciseJumpTargetSchema,
			trajectory: preciseJumpTrajectorySchema,
		})
		.strict(),
	...(
		[
			"no-surface",
			"unreachable",
			"unproven",
			"invalid-aim",
			"solver-failed",
		] as const
	).map((status) =>
		z
			.object({
				...preciseJumpEvaluationCommonShape,
				status: z.literal(status),
				target: preciseJumpTargetSchema.nullable(),
			})
			.strict(),
	),
]);
const preciseJumpTransactionRejectionSchema = z.enum([
	"stale-action",
	"commit-pending",
	"no-reachable-evaluation",
	"evaluation-mismatch",
	"authority-changed",
	"fresh-resolution-rejected",
	"launch-rejected",
]);
const preciseJumpTransactionFeedbackSchema = z
	.object({
		sequence: z.number().int().nonnegative().safe(),
		outcome: z.discriminatedUnion("kind", [
			z.object({ kind: z.literal("cancelled") }).strict(),
			z.object({ kind: z.literal("committed") }).strict(),
			z
				.object({
					kind: z.literal("rejected"),
					reason: preciseJumpTransactionRejectionSchema,
				})
				.strict(),
		]),
	})
	.strict();
const preciseJumpAimRequestSchema = z
	.object({
		camera: cameraIdentitySchema,
		sequence: z.number().int().nonnegative().safe(),
		anchor: guid,
		start: vector3TupleSchema,
		direction: vector3TupleSchema,
		maximumDistance: finiteNumber.nonnegative(),
		previousCell: guid.nullable(),
	})
	.strict();
const preciseJumpCommitRequestSchema = z
	.object({
		sequence: z.number().int().nonnegative().safe(),
		evaluationId: z.number().int().positive().safe(),
	})
	.strict();
const preciseJumpCancelRequestSchema = z
	.object({ sequence: z.number().int().nonnegative().safe() })
	.strict();
const entitySelectionQueryRequestSchema = z
	.object({
		camera: cameraIdentitySchema,
		sequence: z.number().int().nonnegative().safe(),
		anchor: guid,
		start: vector3TupleSchema,
		direction: vector3TupleSchema,
		previousCell: guid.nullable(),
	})
	.strict();
const entitySelectionQueryResultSchema = z.union([
	z
		.object({
			status: z.literal("available"),
			sequence: z.number().int().nonnegative().safe(),
			staticLimitDistance: finiteNumber.nonnegative(),
			candidateGuids: z.array(guid),
		})
		.strict(),
	z
		.object({
			status: z.literal("unavailable"),
			sequence: z.number().int().nonnegative().safe(),
			reason: z.literal("stale-camera"),
		})
		.strict(),
	z
		.object({
			status: z.literal("unavailable"),
			sequence: z.number().int().nonnegative().safe(),
			reason: z.literal("collision-coordinator-unavailable"),
		})
		.strict(),
	z
		.object({
			status: z.literal("unavailable"),
			sequence: z.number().int().nonnegative().safe(),
			reason: z.literal("missing-collision-owner"),
			missingCollisionOwner: guid,
		})
		.strict(),
]);

export type ClientLifecycle = z.infer<typeof lifecycleSchema>;
export type ClientCharacter = z.infer<typeof characterSchema>;
export type ClientCurrentState = Omit<
	z.infer<typeof currentStateSchema>,
	"dynamic"
> & {
	dynamic: DynamicEntitySnapshot;
};
export type ClientPresentationDiscontinuity = z.infer<
	typeof presentationDiscontinuitySchema
>;
export type ClientLocalPlayerEstablished = z.infer<
	typeof localPlayerEstablishedSchema
>;
export type ClientExitRequested = z.infer<typeof exitRequestedSchema>;
export type ClientVital = z.infer<typeof vitalSchema>;
export type ClientChatChannel = z.infer<typeof chatChannelSchema>;
export type ClientChatMessage = z.infer<typeof chatMessageSchema>;
export type ClientPlayerEntered = z.infer<typeof playerEnteredSchema>;
export type ClientDynamicScriptCue = z.infer<typeof dynamicScriptCueSchema>;
export type ClientDriveRequest = z.infer<typeof clientDriveRequestSchema>;
export type ClientCharacterMotionEventRequest = z.infer<
	typeof clientCharacterMotionEventRequestSchema
>;
export type ClientCharacterMotionCapabilities = z.infer<
	typeof clientCharacterMotionCapabilitiesSchema
>;
export type ClientCharacterMotionFeedback = z.infer<
	typeof clientCharacterMotionFeedbackSchema
>;
export type ClientCharacterMotionRejection = z.infer<
	typeof clientCharacterMotionRejectionSchema
>;
export type ClientCameraIdentity = z.infer<typeof cameraIdentitySchema>;
export type ClientCameraTick = z.infer<typeof cameraTickSchema>;
export type ClientCameraStartReceipt = z.infer<typeof cameraStartedSchema>;
type DecodedClientPreciseJumpEvaluation = z.infer<
	typeof preciseJumpEvaluationSchema
>;
type ClientPreciseJumpTarget = Omit<
	z.infer<typeof preciseJumpTargetSchema>,
	"point"
> & {
	readonly point: LandblockVector3;
};
type ClientPreciseJumpTrajectory = Omit<
	z.infer<typeof preciseJumpTrajectorySchema>,
	"origin"
> & {
	readonly origin: LandblockVector3;
};
type ClientPreciseJumpEvaluationCommon = Pick<
	DecodedClientPreciseJumpEvaluation,
	"evaluationId" | "camera" | "sequence" | "diagnostics"
>;
export type ClientPreciseJumpEvaluation = ClientPreciseJumpEvaluationCommon &
	(
		| {
				readonly status: "reachable";
				readonly target: ClientPreciseJumpTarget;
				readonly trajectory: ClientPreciseJumpTrajectory;
		  }
		| {
				readonly status: Exclude<
					DecodedClientPreciseJumpEvaluation["status"],
					"reachable"
				>;
				readonly target: ClientPreciseJumpTarget | null;
		  }
	);
export type ClientPreciseJumpTransactionFeedback = z.infer<
	typeof preciseJumpTransactionFeedbackSchema
>;
export type ClientPreciseJumpCommitRequest = z.infer<
	typeof preciseJumpCommitRequestSchema
>;
export type ClientPreciseJumpCancelRequest = z.infer<
	typeof preciseJumpCancelRequestSchema
>;
export type ClientEntitySelectionQueryResult = z.infer<
	typeof entitySelectionQueryResultSchema
>;

/** Complete renderer-authored registration for one authority-owned camera generation. */
export interface ClientCameraStartRequest {
	readonly playerGuid: number;
	readonly entityGeneration: number;
	readonly initialReach: number;
	readonly minimumReach: number;
	readonly maximumReach: number;
	readonly inputSequence: number;
	readonly viewDirection: readonly [number, number, number];
	readonly cumulativeZoomDisplacement: number;
	readonly projectionRevision: number;
	readonly clearanceRadius: number;
}

/** Latest-wins semantic camera input targeted to one accepted generation. */
export interface ClientCameraIntentRequest extends ClientCameraIdentity {
	readonly inputSequence: number;
	readonly viewDirection: readonly [number, number, number];
	readonly cumulativeZoomDisplacement: number;
}

/** Latest-wins projection-clearance facts targeted to one accepted generation. */
export interface ClientCameraClearanceRequest extends ClientCameraIdentity {
	readonly projectionRevision: number;
	readonly clearanceRadius: number;
}

/** One replaceable camera ray; launch and capability facts never enter this request. */
export interface ClientPreciseJumpAimRequest {
	readonly camera: ClientCameraIdentity;
	readonly sequence: number;
	readonly anchor: number;
	readonly start: LandblockVector3;
	readonly direction: readonly [number, number, number];
	readonly maximumDistance: number;
	readonly previousCell: number | null;
}

/** One correlated selection ray; authority owns its fixed maximum distance. */
export interface ClientEntitySelectionQueryRequest {
	readonly camera: ClientCameraIdentity;
	readonly sequence: number;
	readonly anchor: number;
	readonly start: LandblockVector3;
	readonly direction: readonly [number, number, number];
	readonly previousCell: number | null;
}

/** Strictly validates the atomic client replacement level before mutable UI observes it. */
export function decodeClientCurrentState(value: unknown): ClientCurrentState {
	const parsed = currentStateSchema.parse(value);
	return {
		...parsed,
		dynamic: decodeDynamicEntitySnapshot(parsed.dynamic),
	};
}

/** Strictly validates one lifecycle event from the sidecar. */
export function decodeClientLifecycle(value: unknown): ClientLifecycle {
	return lifecycleSchema.parse(value);
}

/** Strictly validates the server-established local-player identity edge. */
export function decodeClientLocalPlayerEstablished(
	value: unknown,
): ClientLocalPlayerEstablished {
	return localPlayerEstablishedSchema.parse(value);
}

/** Strictly validates one synchronized server-time event. */
export function decodeClientServerTime(value: unknown): { time: number } {
	return z.object({ time: finiteNumber }).strict().parse(value);
}

export function decodeClientWorldName(value: unknown): { name: string } {
	return z.object({ name: z.string() }).strict().parse(value);
}

export function decodeClientPlayerEntered(value: unknown): ClientPlayerEntered {
	return playerEnteredSchema.parse(value);
}

/** Strictly validates one transient script cue bound to an exact entity generation. */
export function decodeClientDynamicScriptCue(
	value: unknown,
): ClientDynamicScriptCue {
	return dynamicScriptCueSchema.parse(value);
}

export function decodeClientVitals(value: unknown): { vitals: ClientVital[] } {
	return z
		.object({ vitals: z.array(vitalSchema) })
		.strict()
		.parse(value);
}

export function decodeClientChatMessage(value: unknown): ClientChatMessage {
	return chatMessageSchema.parse(value);
}

/** Strictly validates one non-portal interpolation/camera discontinuity edge. */
export function decodeClientPresentationDiscontinuity(
	value: unknown,
): ClientPresentationDiscontinuity {
	return presentationDiscontinuitySchema.parse(value);
}

/** Strictly validates the redacted terminal diagnostic. */
export function decodeClientExitRequested(value: unknown): ClientExitRequested {
	return exitRequestedSchema.parse(value);
}

/** Strictly validates one renderer-held drive replacement before it crosses the host boundary. */
export function decodeClientDriveRequest(value: unknown): ClientDriveRequest {
	return clientDriveRequestSchema.parse(value);
}

/** Strictly validates one ordered character-motion edge before it crosses the host boundary. */
export function decodeClientCharacterMotionEventRequest(
	value: unknown,
): ClientCharacterMotionEventRequest {
	return clientCharacterMotionEventRequestSchema.parse(value);
}

export function decodeClientCharacterMotionCapabilities(
	value: unknown,
): ClientCharacterMotionCapabilities | null {
	return clientCharacterMotionCapabilitiesSchema.nullable().parse(value);
}

export function decodeClientCharacterMotionFeedback(
	value: unknown,
): ClientCharacterMotionFeedback {
	return clientCharacterMotionFeedbackSchema.parse(value);
}

/** Strictly validates one client camera generation receipt. */
export function decodeClientCameraStartReceipt(
	value: unknown,
): ClientCameraStartReceipt {
	return cameraStartedSchema.parse(value);
}

/** Strictly validates one client camera tick with explicit projection-proof state. */
export function decodeClientCameraTick(value: unknown): ClientCameraTick {
	return cameraTickSchema.parse(value);
}

export function decodeClientPreciseJumpAimRequest(
	value: unknown,
): ClientPreciseJumpAimRequest {
	const parsed = preciseJumpAimRequestSchema.parse(value);
	return { ...parsed, start: landblockVector3(parsed.start) };
}

export function decodeClientPreciseJumpCommitRequest(
	value: unknown,
): ClientPreciseJumpCommitRequest {
	return preciseJumpCommitRequestSchema.parse(value);
}

export function decodeClientPreciseJumpCancelRequest(
	value: unknown,
): ClientPreciseJumpCancelRequest {
	return preciseJumpCancelRequestSchema.parse(value);
}

export function decodeClientPreciseJumpEvaluation(
	value: unknown,
): ClientPreciseJumpEvaluation {
	const parsed = preciseJumpEvaluationSchema.parse(value);
	if (parsed.status === "reachable") {
		return {
			...parsed,
			target: {
				...parsed.target,
				point: landblockVector3(parsed.target.point),
			},
			trajectory: {
				...parsed.trajectory,
				origin: landblockVector3(parsed.trajectory.origin),
			},
		};
	}
	return {
		...parsed,
		target:
			parsed.target === null
				? null
				: { ...parsed.target, point: landblockVector3(parsed.target.point) },
	};
}

export function decodeClientPreciseJumpTransactionFeedback(
	value: unknown,
): ClientPreciseJumpTransactionFeedback {
	return preciseJumpTransactionFeedbackSchema.parse(value);
}

export function decodeClientEntitySelectionQueryRequest(
	value: unknown,
): ClientEntitySelectionQueryRequest {
	const parsed = entitySelectionQueryRequestSchema.parse(value);
	return { ...parsed, start: landblockVector3(parsed.start) };
}

export function decodeClientEntitySelectionQueryResult(
	value: unknown,
): ClientEntitySelectionQueryResult {
	return entitySelectionQueryResultSchema.parse(value);
}
