import { z } from "zod";
import type { DatAssetId } from "../game/game-types";

const HEADER_LENGTH = 12;
const MAGIC = "HBST";

const manifestSchema = z.object({
	transport: z.literal("holtburger-sound-table"),
	byteOrder: z.literal("little-endian"),
	soundTableId: z.string().regex(/^0x[0-9a-f]{8}$/i),
	entries: z.array(
		z.object({
			soundType: z.number().int().nonnegative(),
			candidates: z
				.array(
					z.object({
						soundId: z.string().regex(/^0x[0-9a-f]{8}$/i),
						probability: z.number().finite(),
						volume: z.number().finite(),
					}),
				)
				.min(1),
		}),
	),
});

/** One candidate sound authored for a `SoundType` key. */
export interface SoundCandidate {
	readonly soundId: DatAssetId;
	readonly probability: number;
	readonly volume: number;
}

/** A decoded sound table, keyed by retail `SoundType`. */
export interface DecodedSoundTable {
	readonly id: DatAssetId;
	/** Complete host envelope bytes retained for construction diagnostics. */
	readonly sourceByteLength?: number;
	readonly entries: ReadonlyMap<number, readonly SoundCandidate[]>;
}

/** Decode and validate one typed sound-table host response. */
export function decodeSoundTableRecord(
	response: Uint8Array,
	expectedSoundTableId: DatAssetId,
): DecodedSoundTable {
	if (response.byteLength < HEADER_LENGTH)
		throw new Error("Sound table response is shorter than its binary header.");
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	if (new TextDecoder().decode(response.subarray(0, 4)) !== MAGIC)
		throw new Error("Unexpected sound table magic.");
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Sound table length is ${response.byteLength}; header declares ${totalLength}.`,
		);
	}
	const parsed = manifestSchema.safeParse(
		JSON.parse(
			new TextDecoder().decode(
				response.subarray(HEADER_LENGTH, HEADER_LENGTH + manifestLength),
			),
		),
	);
	if (!parsed.success)
		throw new Error(`Sound table manifest is invalid: ${parsed.error.message}`);
	const manifest = parsed.data;
	if (
		manifest.soundTableId.toLowerCase() !== expectedSoundTableId.toLowerCase()
	) {
		throw new Error(
			`Sound table host returned ${manifest.soundTableId} for ${expectedSoundTableId}.`,
		);
	}
	return {
		entries: new Map(
			manifest.entries.map((entry) => [
				entry.soundType,
				entry.candidates.map((candidate) => ({
					probability: candidate.probability,
					soundId: candidate.soundId as DatAssetId,
					volume: candidate.volume,
				})),
			]),
		),
		id: manifest.soundTableId as DatAssetId,
		sourceByteLength: response.byteLength,
	};
}

/**
 * Choose a candidate for a uniform roll.
 *
 * **RETAIL DIVERGENCE: retail can never select the last candidate.** Retail computes
 * `floor((n - 1) * roll)` (acclient.c:366752-366756), and its `Random::rand` clamps to `0.99999988`
 * (acclient.c:101613-101615), so `(n - 1) * roll` never reaches `n - 1` and the final candidate of
 * every multi-candidate list is dead.
 *
 * Treated as an off-by-one rather than a design: the `-1` is the inclusive-bound convention of the
 * *integer* `RollDice` overload applied to a float scale that does not need it, and retail's own
 * bounds check on the next line admits `v5 < num_stdatas` — an index the expression cannot produce,
 * so the guard was written for `n * roll`.
 *
 * Safe to diverge: an archive census found 4,183 of 4,184 keys author exactly one candidate, where
 * both formulas agree. This reaches a single entry in the whole game.
 */
export function selectSoundCandidate(
	candidates: readonly SoundCandidate[],
	roll: number,
): SoundCandidate | null {
	if (candidates.length === 0) return null;
	if (candidates.length === 1) return candidates[0]!;
	const index = Math.floor(candidates.length * Math.min(Math.max(roll, 0), 1));
	// A roll of exactly 1 cannot come from `Random::rand`, but must not index off the end here.
	return candidates[Math.min(index, candidates.length - 1)] ?? null;
}
