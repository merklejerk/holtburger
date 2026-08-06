import { z } from "zod";
import type { PreparedBehaviorCommand } from "../game/behavior/prepared-behavior-command";
import type { DatAssetId } from "../game/game-types";
import {
	binarySectionSchema,
	readBinarySection,
	validateBinarySections,
} from "./binary-source-record";
import {
	behaviorHookPayloadSchema,
	decodeBehaviorCommand,
} from "./decode-behavior-hook";

const HEADER_LENGTH = 12;
const MAGIC = "HBPS";
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);

const manifestSchema = z.object({
	transport: z.literal("holtburger-physics-script"),
	byteOrder: z.literal("little-endian"),
	sectionByteOffsetBase: z.literal("section-data"),
	scriptId: datId,
	lengthSeconds: z.number().finite().nonnegative(),
	records: z.array(
		z.object({
			startTime: z.number().finite().nonnegative(),
			authoredOrder: z.number().int().nonnegative(),
			hookType: z.number().int().nonnegative(),
			hookName: z.string().min(1),
			payload: behaviorHookPayloadSchema,
		}),
	),
	sections: z.array(binarySectionSchema),
});

/** Where in its script one command was authored. */
interface PhysicsScriptRecordProvenance {
	/** Seconds from script activation. */
	readonly startTime: number;
	/** Authored file position, the stable tiebreak among equal start times. */
	readonly authoredOrder: number;
}

/**
 * One authored script command: the shared semantic union plus script-lane provenance.
 *
 * Deliberately carries no direction. Retail stamps `-2` on every script hook and executes them
 * unconditionally (acclient.c:316443), so the animation lane's direction filter has no counterpart
 * here and must not be reintroduced.
 */
export type DecodedPhysicsScriptRecord = PhysicsScriptRecordProvenance &
	PreparedBehaviorCommand;

/** Fully decoded immutable physics script before shared repository acquisition. */
export interface DecodedPhysicsScript {
	readonly id: DatAssetId;
	/**
	 * Authored length in seconds: the last record's time.
	 *
	 * A self-`CallPES` repeats at exactly this interval, because retail queues a chained script at
	 * `previous.start + previous.length` rather than at the current clock.
	 */
	readonly lengthSeconds: number;
	/** Records in execution order: by time, ties broken by authored order. */
	readonly records: readonly DecodedPhysicsScriptRecord[];
}

/** Decode and validate one typed physics-script host response. */
export function decodePhysicsScriptRecord(
	response: Uint8Array,
	expectedScriptId: DatAssetId,
): DecodedPhysicsScript {
	if (response.byteLength < HEADER_LENGTH)
		throw new Error(
			"Physics script response is shorter than its binary header.",
		);
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	const magic = new TextDecoder().decode(response.subarray(0, 4));
	if (magic !== MAGIC)
		throw new Error(`Unexpected physics script magic ${magic}.`);
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Physics script length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const sectionDataOffset = HEADER_LENGTH + manifestLength;
	if (sectionDataOffset > response.byteLength)
		throw new Error("Physics script manifest exceeds the binary response.");
	const manifest = parseManifest(
		new TextDecoder().decode(
			response.subarray(HEADER_LENGTH, sectionDataOffset),
		),
	);
	if (manifest.scriptId.toLowerCase() !== expectedScriptId.toLowerCase()) {
		throw new Error(
			`Physics script host returned ${manifest.scriptId} for ${expectedScriptId}.`,
		);
	}
	const sourceLabel = `PhysicsScript ${manifest.scriptId}`;
	const sections = validateBinarySections(
		response,
		sectionDataOffset,
		manifest.sections,
		{ hookPayloadBytes: "u8" },
		sourceLabel,
	);
	const payloadBytes = readBinarySection(
		response,
		sectionDataOffset,
		sections,
		"hookPayloadBytes",
		Uint8Array,
		sourceLabel,
	);
	validateRecordOrder(manifest, sourceLabel);
	return {
		id: manifest.scriptId as DatAssetId,
		lengthSeconds: manifest.lengthSeconds,
		records: manifest.records.map((record) => ({
			authoredOrder: record.authoredOrder,
			startTime: record.startTime,
			...decodeBehaviorCommand(record, payloadBytes, sourceLabel),
		})),
	};
}

function parseManifest(source: string): z.infer<typeof manifestSchema> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(source);
	} catch (cause) {
		throw new Error("Physics script manifest is not valid JSON.", { cause });
	}
	const result = manifestSchema.safeParse(parsed);
	if (!result.success)
		throw new Error(
			`Physics script manifest is invalid: ${result.error.message}`,
		);
	return result.data;
}

/**
 * Confirm the host already placed records in execution order and that the declared length agrees.
 *
 * The runtime advances a monotonic clock across this list, so an unsorted transport would silently
 * skip records rather than fail.
 */
function validateRecordOrder(
	manifest: z.infer<typeof manifestSchema>,
	sourceLabel: string,
): void {
	let previous: { startTime: number; authoredOrder: number } | null = null;
	for (const record of manifest.records) {
		if (
			previous &&
			(record.startTime < previous.startTime ||
				(record.startTime === previous.startTime &&
					record.authoredOrder <= previous.authoredOrder))
		) {
			throw new Error(
				`${sourceLabel} records are not in execution order at t=${record.startTime}.`,
			);
		}
		previous = record;
	}
	const lastTime = previous?.startTime ?? 0;
	if (manifest.lengthSeconds !== lastTime) {
		throw new Error(
			`${sourceLabel} declares length ${manifest.lengthSeconds} but its last record is at ${lastTime}.`,
		);
	}
}
