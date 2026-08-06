import { z } from "zod";
import type { DatAssetId } from "../game/game-types";
import type { PreparedBehaviorCommand } from "../game/behavior/prepared-behavior-command";
import { Vec3 } from "../game/math/types";

const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const finiteNumber = z.number().finite();
const rawPayload = z.object({
	byteOffset: z.number().int().nonnegative(),
	byteLength: z.number().int().nonnegative(),
});

/** Transport shape shared by the animation and physics-script hook manifests. */
export const behaviorHookPayloadSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("no-payload") }),
	rawPayload.extend({ kind: z.literal("raw") }),
	rawPayload.extend({ kind: z.literal("replace-object") }),
	z
		.object({
			kind: z.literal("set-omega"),
			omega: z.tuple([finiteNumber, finiteNumber, finiteNumber]),
		})
		.strict(),
	z
		.object({
			durationSeconds: finiteNumber,
			end: finiteNumber,
			kind: z.literal("transparent-part"),
			partIndex: z.number().int().nonnegative(),
			start: finiteNumber,
		})
		.strict(),
	z.object({
		kind: z.literal("texture-velocity"),
		uSpeed: finiteNumber,
		vSpeed: finiteNumber,
	}),
	z.object({
		kind: z.literal("texture-velocity-part"),
		partIndex: z.number().int().nonnegative(),
		uSpeed: finiteNumber,
		vSpeed: finiteNumber,
	}),
	z.object({
		kind: z.literal("sound-table"),
		soundType: z.number().int().nonnegative(),
	}),
	z.object({
		durationSeconds: finiteNumber,
		end: finiteNumber.positive(),
		kind: z.literal("scale"),
	}),
	z.object({
		emitterId: z.number().int().nonnegative(),
		emitterInfoId: datId,
		kind: z.literal("create-particle"),
		offsetOrientation: z.tuple([
			finiteNumber,
			finiteNumber,
			finiteNumber,
			finiteNumber,
		]),
		offsetOrigin: z.tuple([finiteNumber, finiteNumber, finiteNumber]),
		/** `-1` is the whole-object sentinel, so this is not merely non-negative. */
		partIndex: z.number().int().min(-1),
	}),
	z.object({
		kind: z.literal("call-pes"),
		pauseSeconds: finiteNumber.nonnegative(),
		scriptId: datId,
	}),
	z.object({
		kind: z.literal("sound-tweaked"),
		probability: finiteNumber,
		soundId: datId,
		unused: finiteNumber,
		volume: finiteNumber,
	}),
]);

export type BehaviorHookPayload = z.infer<typeof behaviorHookPayloadSchema>;

/** Hook types the host projects as a typed payload, and the payload kind each must carry. */
const TYPED_PAYLOAD_KIND_BY_HOOK_TYPE = new Map<
	number,
	BehaviorHookPayload["kind"]
>([
	[2, "sound-table"],
	[5, "replace-object"],
	[7, "transparent-part"],
	[12, "scale"],
	[13, "create-particle"],
	[19, "call-pes"],
	[21, "sound-tweaked"],
	[22, "set-omega"],
	[23, "texture-velocity"],
	[24, "texture-velocity-part"],
]);

/**
 * Hook types whose absence changes only which effects play, never how the object is drawn.
 *
 * An owner carrying one of these can activate: the viewer sees a correct object missing an ambient
 * flourish. Anything not listed would misrender the object and blocks activation instead.
 */
const NON_BLOCKING_UNIMPLEMENTED_HOOK_TYPES = new Set([
	1, // sound
	3, // attack
	14, // destroy-particle
	15, // stop-particle
	17, // default-script
	18, // default-script-part
	26, // create-blocking-particle
]);

/** Decode one transported hook payload into its producer-independent semantic command. */
export function decodeBehaviorCommand(
	hook: {
		readonly hookType: number;
		readonly hookName: string;
		readonly payload: BehaviorHookPayload;
	},
	payloadBytes: Uint8Array,
	sourceLabel: string,
): PreparedBehaviorCommand {
	const expectedName = behaviorHookName(hook.hookType);
	if (hook.hookName !== expectedName) {
		throw new Error(
			`${sourceLabel} hook type ${hook.hookType} is named ${hook.hookName}, expected ${expectedName}.`,
		);
	}
	// `hookType` and `payload.kind` are redundant transport facts. Requiring them to agree is what
	// turns a host/frontend drift into a loud failure instead of a command silently downgrading to
	// the unimplemented arm.
	const requiredPayloadKind = TYPED_PAYLOAD_KIND_BY_HOOK_TYPE.get(
		hook.hookType,
	);
	if (requiredPayloadKind && hook.payload.kind !== requiredPayloadKind) {
		throw new Error(
			`${sourceLabel} hook type ${hook.hookType} requires ${requiredPayloadKind} payload, received ${hook.payload.kind}.`,
		);
	}
	const payload = hook.payload;
	switch (payload.kind) {
		case "set-omega":
			// AC authors omega in its own axis convention; convert once, here.
			return {
				kind: "set-omega",
				omega: new Vec3(payload.omega[0], payload.omega[2], -payload.omega[1]),
			};
		case "transparent-part":
			return {
				durationSeconds: payload.durationSeconds,
				end: payload.end,
				kind: "transparent-part",
				partIndex: payload.partIndex,
				start: payload.start,
			};
		case "scale":
			return {
				durationSeconds: payload.durationSeconds,
				end: payload.end,
				kind: "scale",
			};
		case "texture-velocity":
			return {
				kind: "texture-velocity",
				uSpeed: payload.uSpeed,
				vSpeed: payload.vSpeed,
			};
		case "texture-velocity-part":
			return {
				kind: "texture-velocity-part",
				partIndex: payload.partIndex,
				uSpeed: payload.uSpeed,
				vSpeed: payload.vSpeed,
			};
		case "sound-table":
			return { kind: "sound-table", soundType: payload.soundType };
		case "sound-tweaked":
			// `unused` is deliberately dropped: retail parses and discards it, so carrying it
			// forward would invite a consumer to read a field with no meaning.
			return {
				kind: "sound-tweaked",
				probability: payload.probability,
				soundId: payload.soundId as DatAssetId,
				volume: payload.volume,
			};
		case "create-particle":
			// The authored quaternion stops here: retail never applies the hook frame's rotation.
			return {
				emitterId: payload.emitterId,
				emitterInfoId: payload.emitterInfoId as DatAssetId,
				kind: "create-particle",
				offsetOrigin: payload.offsetOrigin,
				partIndex: payload.partIndex,
			};
		case "call-pes":
			return {
				kind: "call-pes",
				pauseSeconds: payload.pauseSeconds,
				scriptId: payload.scriptId as DatAssetId,
			};
		case "replace-object":
			return {
				kind: "replace-object",
				rawPayload: payloadSlice(payloadBytes, payload, sourceLabel),
			};
		case "no-payload":
			if (hook.hookType === 0 || hook.hookType === 4) {
				return {
					command: hook.hookType === 0 ? "no-op" : "animation-done",
					kind: "semantic",
				};
			}
			return unimplemented(hook, expectedName, { kind: "no-payload" });
		case "raw":
			return unimplemented(hook, expectedName, {
				bytes: payloadSlice(payloadBytes, payload, sourceLabel),
				kind: "raw",
			});
	}
}

/** Build the unimplemented arm, deciding activation blocking once at decode time. */
function unimplemented(
	hook: { readonly hookType: number },
	command: string,
	payload: Extract<
		PreparedBehaviorCommand,
		{ kind: "unimplemented" }
	>["payload"],
): PreparedBehaviorCommand {
	return {
		blocksActivation: !NON_BLOCKING_UNIMPLEMENTED_HOOK_TYPES.has(hook.hookType),
		command,
		kind: "unimplemented",
		payload,
		sourceType: hook.hookType,
	};
}

function payloadSlice(
	payloadBytes: Uint8Array,
	payload: { readonly byteOffset: number; readonly byteLength: number },
	sourceLabel: string,
): Uint8Array {
	const end = payload.byteOffset + payload.byteLength;
	if (end > payloadBytes.length)
		throw new Error(`${sourceLabel} hook payload exceeds its section.`);
	return Uint8Array.from(payloadBytes.subarray(payload.byteOffset, end));
}

export function behaviorHookName(hookType: number): string {
	return (
		[
			"no-op",
			"sound",
			"sound-table",
			"attack",
			"animation-done",
			"replace-object",
			"ethereal",
			"transparent-part",
			"luminous",
			"luminous-part",
			"diffuse",
			"diffuse-part",
			"scale",
			"create-particle",
			"destroy-particle",
			"stop-particle",
			"no-draw",
			"default-script",
			"default-script-part",
			"call-pes",
			"transparent",
			"sound-tweaked",
			"set-omega",
			"texture-velocity",
			"texture-velocity-part",
			"set-light",
			"create-blocking-particle",
		][hookType] ?? "unsupported"
	);
}
