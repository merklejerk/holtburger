import { z } from "zod";
import type { DatAssetId } from "../game/game-types";
import type { Mat4 } from "../game/math/types";
import { Vec3 } from "../game/math/types";
import { acFrameTransform } from "./ac-frame";
import {
	binarySectionSchema,
	readBinarySection,
	validateBinarySections,
} from "./binary-source-record";

const HEADER_LENGTH = 12;
const MAGIC = "HBAN";
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const finiteNumber = z.number().finite();
const hookDirection = z.enum([
	"unknown",
	"backward",
	"both",
	"forward",
	"invalid",
]);
const rawPayload = z.object({
	byteOffset: z.number().int().nonnegative(),
	byteLength: z.number().int().nonnegative(),
});
const hookPayload = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("no-payload") }),
	rawPayload.extend({ kind: z.literal("raw") }),
	rawPayload.extend({ kind: z.literal("replace-object") }),
	rawPayload.extend({
		kind: z.literal("set-omega"),
		omega: z.tuple([finiteNumber, finiteNumber, finiteNumber]),
	}),
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
]);
const manifestSchema = z.object({
	transport: z.literal("holtburger-animation"),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	animationId: datId,
	frameCount: z.number().int().positive(),
	partCount: z.number().int().positive(),
	hasPositionFrames: z.boolean(),
	hooks: z.array(
		z.object({
			frameIndex: z.number().int().nonnegative(),
			authoredOrder: z.number().int().nonnegative(),
			hookType: z.number().int().nonnegative(),
			hookName: z.string().min(1),
			direction: hookDirection,
			rawDirection: z.number().int(),
			payload: hookPayload,
		}),
	),
	sections: z.array(binarySectionSchema),
});

type AnimationHookDirection = z.infer<typeof hookDirection>;

interface AnimationHookBase {
	readonly frameIndex: number;
	readonly authoredOrder: number;
	readonly direction: AnimationHookDirection;
}

/** Payload retained only for commands whose execution remains deferred or unsupported. */
type DeferredAnimationHookPayload =
	| { readonly kind: "no-payload" }
	| { readonly kind: "raw"; readonly bytes: Uint8Array }
	| {
			readonly kind: "texture-velocity";
			readonly uSpeed: number;
			readonly vSpeed: number;
	  }
	| {
			readonly kind: "texture-velocity-part";
			readonly partIndex: number;
			readonly uSpeed: number;
			readonly vSpeed: number;
	  };

/** Semantic runtime hook contract emitted after redundant transport facts are validated. */
export type DecodedAnimationHook = AnimationHookBase &
	(
		| { readonly kind: "replace-object"; readonly rawPayload: Uint8Array }
		| {
				readonly kind: "set-omega";
				readonly omega: Vec3;
		  }
		| {
				readonly kind: "semantic";
				readonly command: "no-op" | "animation-done";
		  }
		| {
				readonly kind: "deferred-effect";
				readonly command: string;
				readonly sourceType: number;
				readonly payload: DeferredAnimationHookPayload;
		  }
		| {
				readonly kind: "unsupported-visual";
				readonly command: string;
				readonly sourceType: number;
				readonly payload: DeferredAnimationHookPayload;
		  }
	);

/** Hooks that prevent animated activation until their behavior receives an execution owner. */
export type BlockingAnimationHook = Extract<
	DecodedAnimationHook,
	{ readonly kind: "replace-object" | "unsupported-visual" }
>;

/** Derive the stable diagnostic command label from the normalized semantic arm. */
export function animationHookCommand(hook: DecodedAnimationHook): string {
	switch (hook.kind) {
		case "set-omega":
			return "set-omega";
		case "replace-object":
			return "replace-object";
		case "semantic":
		case "deferred-effect":
		case "unsupported-visual":
			return hook.command;
	}
}

/** Fully decoded immutable animation source before shared repository acquisition. */
export interface DecodedAnimationAsset {
	readonly id: DatAssetId;
	readonly frameCount: number;
	readonly partCount: number;
	/** Frame-major rigid-part transforms in the app's render coordinate system. */
	readonly partFrames: readonly Mat4[];
	/** Optional frame-major root offsets retained for later consumers. */
	readonly positionFrames: readonly Mat4[];
	readonly hooks: readonly DecodedAnimationHook[];
}

/** Decode and validate one typed animation host response. */
export function decodeAnimationRecord(
	response: Uint8Array,
	expectedAnimationId: DatAssetId,
): DecodedAnimationAsset {
	if (response.byteLength < HEADER_LENGTH)
		throw new Error("Animation response is shorter than its binary header.");
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC) throw new Error(`Unexpected animation magic ${magic}.`);
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Animation length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength)
		throw new Error("Animation manifest exceeds the binary response.");
	const manifest = parseManifest(
		new TextDecoder().decode(
			response.subarray(HEADER_LENGTH, sectionDataOffset),
		),
	);
	if (
		manifest.animationId.toLowerCase() !== expectedAnimationId.toLowerCase()
	) {
		throw new Error(
			`Animation host returned ${manifest.animationId} for ${expectedAnimationId}.`,
		);
	}
	const sections = validateBinarySections(
		response,
		sectionDataOffset,
		manifest.sections,
		{
			hookPayloadBytes: "u8",
			partFrames: "f32",
			positionFrames: "f32",
		},
		`Animation ${manifest.animationId}`,
	);
	const partValues = readBinarySection(
		response,
		sectionDataOffset,
		sections,
		"partFrames",
		Float32Array,
		`Animation ${manifest.animationId}`,
		manifest.frameCount * manifest.partCount * 7,
	);
	const expectedPositionCount = manifest.hasPositionFrames
		? manifest.frameCount * 7
		: 0;
	const positionValues = readBinarySection(
		response,
		sectionDataOffset,
		sections,
		"positionFrames",
		Float32Array,
		`Animation ${manifest.animationId}`,
		expectedPositionCount,
	);
	const payloadBytes = readBinarySection(
		response,
		sectionDataOffset,
		sections,
		"hookPayloadBytes",
		Uint8Array,
		`Animation ${manifest.animationId}`,
	);
	validateHookOrder(manifest.hooks, manifest.frameCount);
	return {
		frameCount: manifest.frameCount,
		hooks: manifest.hooks.map((hook) =>
			decodeHook(hook, payloadBytes, manifest.animationId),
		),
		id: manifest.animationId as DatAssetId,
		partCount: manifest.partCount,
		partFrames: decodeFrames(partValues),
		positionFrames: decodeFrames(positionValues),
	};
}

function parseManifest(source: string): z.infer<typeof manifestSchema> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (cause) {
		throw new Error("Animation manifest is not valid JSON.", { cause });
	}
	const result = manifestSchema.safeParse(parsed);
	if (!result.success)
		throw new Error(`Animation manifest is invalid: ${result.error.message}`);
	return result.data;
}

function decodeFrames(values: Float32Array): readonly Mat4[] {
	const frames: Mat4[] = [];
	for (let offset = 0; offset < values.length; offset += 7) {
		frames.push(
			acFrameTransform(
				{
					origin: [values[offset]!, values[offset + 1]!, values[offset + 2]!],
					orientation: [
						values[offset + 3]!,
						values[offset + 4]!,
						values[offset + 5]!,
						values[offset + 6]!,
					],
				},
				[1, 1, 1],
			),
		);
	}
	return frames;
}

function validateHookOrder(
	hooks: readonly z.infer<typeof manifestSchema>["hooks"][number][],
	frameCount: number,
): void {
	const nextOrderByFrame = new Map<number, number>();
	for (const hook of hooks) {
		if (hook.frameIndex >= frameCount)
			throw new Error(
				`Animation hook frame ${hook.frameIndex} is out of range.`,
			);
		const expectedOrder = nextOrderByFrame.get(hook.frameIndex) ?? 0;
		if (hook.authoredOrder !== expectedOrder) {
			throw new Error(
				`Animation frame ${hook.frameIndex} hook order is not contiguous.`,
			);
		}
		nextOrderByFrame.set(hook.frameIndex, expectedOrder + 1);
		const expectedDirection = directionValue(hook.direction);
		if (expectedDirection !== null && expectedDirection !== hook.rawDirection) {
			throw new Error(
				`Animation hook ${hook.hookName} direction facts disagree.`,
			);
		}
	}
}

function decodeHook(
	hook: z.infer<typeof manifestSchema>["hooks"][number],
	payloadBytes: Uint8Array,
	animationId: string,
): DecodedAnimationHook {
	const base: AnimationHookBase = {
		authoredOrder: hook.authoredOrder,
		direction: hook.direction,
		frameIndex: hook.frameIndex,
	};
	const expectedName = hookName(hook.hookType);
	if (hook.hookName !== expectedName) {
		throw new Error(
			`Animation ${animationId} hook type ${hook.hookType} is named ${hook.hookName}, expected ${expectedName}.`,
		);
	}
	if (hook.direction === "unknown" || hook.direction === "invalid") {
		return {
			...base,
			command: expectedName,
			kind: "unsupported-visual",
			payload: deferredPayload(hook.payload, payloadBytes, animationId),
			sourceType: hook.hookType,
		};
	}
	switch (hook.hookType) {
		case 0:
		case 4:
			requirePayloadKind(
				hook.payload,
				"no-payload",
				hook.hookType,
				animationId,
			);
			return {
				...base,
				command: hook.hookType === 0 ? "no-op" : "animation-done",
				kind: "semantic",
			};
		case 5: {
			const payload = requirePayloadKind(
				hook.payload,
				"replace-object",
				hook.hookType,
				animationId,
			);
			return {
				...base,
				kind: "replace-object",
				rawPayload: payloadSlice(payloadBytes, payload, animationId),
			};
		}
		case 22: {
			const payload = requirePayloadKind(
				hook.payload,
				"set-omega",
				hook.hookType,
				animationId,
			);
			payloadSlice(payloadBytes, payload, animationId);
			return {
				...base,
				kind: "set-omega",
				omega: new Vec3(payload.omega[0], payload.omega[2], -payload.omega[1]),
			};
		}
		default: {
			const deferred = DEFERRED_EFFECT_HOOK_TYPES.has(hook.hookType);
			return {
				...base,
				command: expectedName,
				kind: deferred ? "deferred-effect" : "unsupported-visual",
				payload: deferredPayload(hook.payload, payloadBytes, animationId),
				sourceType: hook.hookType,
			};
		}
	}
}

const DEFERRED_EFFECT_HOOK_TYPES = new Set([
	1, 2, 3, 13, 14, 15, 17, 18, 19, 21, 26,
]);

function deferredPayload(
	payload: z.infer<typeof hookPayload>,
	payloadBytes: Uint8Array,
	animationId: string,
): DeferredAnimationHookPayload {
	switch (payload.kind) {
		case "no-payload":
			return payload;
		case "raw":
		case "replace-object":
		case "set-omega":
			return {
				bytes: payloadSlice(payloadBytes, payload, animationId),
				kind: "raw",
			};
		case "texture-velocity":
			return payload;
		case "texture-velocity-part":
			return payload;
	}
}

function requirePayloadKind<TKind extends z.infer<typeof hookPayload>["kind"]>(
	payload: z.infer<typeof hookPayload>,
	kind: TKind,
	hookType: number,
	animationId: string,
): Extract<z.infer<typeof hookPayload>, { readonly kind: TKind }> {
	if (payload.kind !== kind) {
		throw new Error(
			`Animation ${animationId} hook type ${hookType} requires ${kind} payload, received ${payload.kind}.`,
		);
	}
	return payload as Extract<
		z.infer<typeof hookPayload>,
		{ readonly kind: TKind }
	>;
}

function payloadSlice(
	payloadBytes: Uint8Array,
	payload: { readonly byteOffset: number; readonly byteLength: number },
	animationId: string,
): Uint8Array {
	const end = payload.byteOffset + payload.byteLength;
	if (end > payloadBytes.length) {
		throw new Error(
			`Animation ${animationId} hook payload exceeds its section.`,
		);
	}
	return Uint8Array.from(payloadBytes.subarray(payload.byteOffset, end));
}

function directionValue(direction: AnimationHookDirection): number | null {
	switch (direction) {
		case "unknown":
			return -2;
		case "backward":
			return -1;
		case "both":
			return 0;
		case "forward":
			return 1;
		case "invalid":
			return null;
	}
}

function hookName(hookType: number): string {
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
