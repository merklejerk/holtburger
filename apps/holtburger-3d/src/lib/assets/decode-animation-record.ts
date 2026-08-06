import { z } from "zod";
import type { PreparedBehaviorCommand } from "../game/behavior/prepared-behavior-command";
import {
	behaviorCommandBlocksActivation,
	behaviorCommandLabel,
} from "../game/behavior/prepared-behavior-command";
import type { DatAssetId } from "../game/game-types";
import type { Mat4 } from "../game/math/types";
import { acFrameTransform } from "./ac-frame";
import {
	binarySectionSchema,
	readBinarySection,
	validateBinarySections,
} from "./binary-source-record";
import {
	behaviorHookName,
	behaviorHookPayloadSchema,
	decodeBehaviorCommand,
} from "./decode-behavior-hook";

const HEADER_LENGTH = 12;
const MAGIC = "HBAN";
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);
const hookDirection = z.enum([
	"unknown",
	"backward",
	"both",
	"forward",
	"invalid",
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
			payload: behaviorHookPayloadSchema,
		}),
	),
	sections: z.array(binarySectionSchema),
});

type AnimationHookDirection = z.infer<typeof hookDirection>;

/** Where in its animation one command was authored, and when playback accepts it. */
interface AnimationHookProvenance {
	readonly frameIndex: number;
	readonly authoredOrder: number;
	readonly direction: AnimationHookDirection;
}

/**
 * One authored animation command: the shared semantic union plus animation-lane provenance.
 *
 * Physics scripts carry the same commands with their own provenance, which is exactly why the
 * union is not defined here.
 */
export type DecodedAnimationHook = AnimationHookProvenance &
	PreparedBehaviorCommand;

/** Hooks that prevent animated activation until their behavior receives an execution owner. */
export type BlockingAnimationHook = DecodedAnimationHook;

export function animationHookBlocksActivation(
	hook: DecodedAnimationHook,
): boolean {
	return behaviorCommandBlocksActivation(hook);
}

/** Derive the stable diagnostic command label from the normalized semantic arm. */
export function animationHookCommand(hook: DecodedAnimationHook): string {
	return behaviorCommandLabel(hook);
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
			decodeHook(hook, payloadBytes, manifest.animationId, manifest.partCount),
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
	partCount: number,
): DecodedAnimationHook {
	const provenance: AnimationHookProvenance = {
		authoredOrder: hook.authoredOrder,
		direction: hook.direction,
		frameIndex: hook.frameIndex,
	};
	const sourceLabel = `Animation ${animationId}`;
	// An animation hook with no usable direction cannot be scheduled against playback at all, so it
	// is unimplementable regardless of whether its payload decoded.
	if (hook.direction === "unknown" || hook.direction === "invalid") {
		return {
			...provenance,
			blocksActivation: true,
			command: behaviorHookName(hook.hookType),
			kind: "unimplemented",
			payload: { kind: "no-payload" },
			sourceType: hook.hookType,
		};
	}
	const command = decodeBehaviorCommand(hook, payloadBytes, sourceLabel);
	if (
		(command.kind === "transparent-part" ||
			command.kind === "texture-velocity-part") &&
		command.partIndex >= partCount
	) {
		throw new Error(
			`${sourceLabel} ${command.kind} index ${command.partIndex} is out of range for ${partCount} parts.`,
		);
	}
	return { ...provenance, ...command };
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
