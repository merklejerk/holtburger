import { z } from "zod";
import {
	decodeDynamicEntitySnapshot,
	type DynamicEntitySnapshot,
} from "../lib/game/runtime/dynamic-entity-feed";

const guid = z.number().int().nonnegative().max(0xffff_ffff);
const finiteNumber = z.number().finite();

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

const currentStateSchema = z
	.object({
		lifecycle: lifecycleSchema,
		localPlayerGuid: guid.nullable(),
		serverTime: finiteNumber.nullable(),
		worldGeneration: z.number().int().nonnegative(),
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
		turning: z.enum(["left", "right"]).nullable(),
	})
	.strict();

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
	.strict()
	.nullable();
const cameraDiagnosticsSchema = z
	.object({
		controlLegs: z.number().int().nonnegative().safe(),
		clearanceSweeps: z.number().int().nonnegative().safe(),
		transitSubsteps: z.number().int().nonnegative().safe(),
		contactPasses: z.number().int().nonnegative().safe(),
	})
	.strict();
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
			reason: z.enum([
				"collision-snapshot",
				"clearance-sweep",
				"free-sphere-query",
				"target-contract",
				"controller-input",
				"path-projection",
			]),
			diagnostics: cameraDiagnosticsSchema,
		})
		.strict(),
]);
const cameraStartedSchema = cameraIdentitySchema.extend({}).strict();

export type ClientLifecycle = z.infer<typeof lifecycleSchema>;
export type ClientCharacter = z.infer<typeof characterSchema>;
export type ClientCurrentState = Omit<
	z.infer<typeof currentStateSchema>,
	"dynamic"
> & { dynamic: DynamicEntitySnapshot };
export type ClientPresentationDiscontinuity = z.infer<
	typeof presentationDiscontinuitySchema
>;
export type ClientLocalPlayerEstablished = z.infer<
	typeof localPlayerEstablishedSchema
>;
export type ClientExitRequested = z.infer<typeof exitRequestedSchema>;
export type ClientDriveRequest = z.infer<typeof clientDriveRequestSchema>;
export type ClientCameraIdentity = z.infer<typeof cameraIdentitySchema>;
export type ClientCameraTick = z.infer<typeof cameraTickSchema>;
export type ClientCameraStartReceipt = z.infer<typeof cameraStartedSchema>;

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

/** Strictly validates one client camera generation receipt. */
export function decodeClientCameraStartReceipt(
	value: unknown,
): ClientCameraStartReceipt {
	return cameraStartedSchema.parse(value);
}

/** Strictly validates one client collision-safe camera tick. */
export function decodeClientCameraTick(value: unknown): ClientCameraTick {
	return cameraTickSchema.parse(value);
}
