import { z } from "zod";
import type { DatAssetId } from "../game/game-types";

const HEADER_LENGTH = 12;
const MAGIC = "HBPT";
const datId = z.string().regex(/^0x[0-9a-f]{8}$/i);

const manifestSchema = z.object({
	transport: z.literal("holtburger-physics-script-table"),
	byteOrder: z.literal("little-endian"),
	physicsScriptTableId: datId,
	cues: z.array(
		z.object({
			cue: z.number().int().nonnegative(),
			choices: z
				.array(
					z.object({
						maximumIntensity: z.number().finite(),
						scriptId: datId,
					}),
				)
				.min(1),
		}),
	),
});

/** One inclusive retail intensity threshold and selected PhysicsScript. */
interface PhysicsScriptChoice {
	readonly maximumIntensity: number;
	readonly scriptId: DatAssetId;
}

/** Immutable cue lookup used when a high-level PlayScript event becomes ready. */
export interface DecodedPhysicsScriptTable {
	readonly id: DatAssetId;
	readonly cues: ReadonlyMap<number, readonly PhysicsScriptChoice[]>;
}

/** Decode and validate one typed PhysicsScriptTable host response. */
export function decodePhysicsScriptTableRecord(
	response: Uint8Array,
	expectedTableId: DatAssetId,
): DecodedPhysicsScriptTable {
	if (response.byteLength < HEADER_LENGTH)
		throw new Error(
			"PhysicsScriptTable response is shorter than its binary header.",
		);
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	if (new TextDecoder().decode(response.subarray(0, 4)) !== MAGIC)
		throw new Error("Unexpected PhysicsScriptTable magic.");
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`PhysicsScriptTable length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	if (HEADER_LENGTH + manifestLength > response.byteLength)
		throw new Error("PhysicsScriptTable manifest exceeds its response.");
	const parsed = manifestSchema.safeParse(
		JSON.parse(
			new TextDecoder().decode(
				response.subarray(HEADER_LENGTH, HEADER_LENGTH + manifestLength),
			),
		),
	);
	if (!parsed.success)
		throw new Error(
			`PhysicsScriptTable manifest is invalid: ${parsed.error.message}`,
		);
	const manifest = parsed.data;
	if (
		manifest.physicsScriptTableId.toLowerCase() !==
		expectedTableId.toLowerCase()
	) {
		throw new Error(
			`PhysicsScriptTable host returned ${manifest.physicsScriptTableId} for ${expectedTableId}.`,
		);
	}
	const cues = new Map<number, readonly PhysicsScriptChoice[]>();
	for (const cue of manifest.cues) {
		if (cues.has(cue.cue))
			throw new Error(`PhysicsScriptTable repeats cue ${cue.cue}.`);
		cues.set(
			cue.cue,
			cue.choices.map((choice) => ({
				maximumIntensity: choice.maximumIntensity,
				scriptId: choice.scriptId as DatAssetId,
			})),
		);
	}
	return {
		cues,
		id: manifest.physicsScriptTableId as DatAssetId,
	};
}

/** Retail's first inclusive threshold lookup (`PhysicsScriptTableData::GetScript`). */
export function selectPhysicsScript(
	table: DecodedPhysicsScriptTable,
	cue: number,
	intensity: number,
): DatAssetId | null {
	if (!Number.isFinite(intensity))
		throw new Error("PhysicsScript cue intensity must be finite.");
	return (
		table.cues.get(cue)?.find((choice) => intensity <= choice.maximumIntensity)
			?.scriptId ?? null
	);
}
