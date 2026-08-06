import { z } from "zod";
import type { DatAssetId } from "../game/game-types";

const HEADER_LENGTH = 12;
const MAGIC = "HBAU";

const manifestSchema = z.object({
	transport: z.literal("holtburger-audio"),
	byteOrder: z.literal("little-endian"),
	soundId: z.string().regex(/^0x[0-9a-f]{8}$/i),
	/** MIME type the payload decodes as; the host chose it from the source format tag. */
	mediaType: z.enum(["audio/wav", "audio/mpeg"]),
	channels: z.number().int().positive(),
	samplesPerSecond: z.number().int().positive(),
	bitsPerSample: z.number().int().nonnegative(),
	payloadByteLength: z.number().int().positive(),
});

/** One decoder-ready audio asset. */
export interface DecodedAudioRecord {
	readonly id: DatAssetId;
	readonly mediaType: "audio/wav" | "audio/mpeg";
	/** Bytes ready for `decodeAudioData`; the host already built any needed container. */
	readonly payload: ArrayBuffer;
}

/** Decode and validate one typed audio host response. */
export function decodeAudioRecord(
	response: Uint8Array,
	expectedSoundId: DatAssetId,
): DecodedAudioRecord {
	if (response.byteLength < HEADER_LENGTH)
		throw new Error("Audio response is shorter than its binary header.");
	const view = new DataView(
		response.buffer,
		response.byteOffset,
		response.byteLength,
	);
	if (new TextDecoder().decode(response.subarray(0, 4)) !== MAGIC)
		throw new Error("Unexpected audio record magic.");
	const manifestLength = view.getUint32(4, true);
	const totalLength = view.getUint32(8, true);
	if (totalLength !== response.byteLength) {
		throw new Error(
			`Audio length is ${response.byteLength}; header declares ${totalLength}.`,
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
		throw new Error(`Audio manifest is invalid: ${parsed.error.message}`);
	const manifest = parsed.data;
	if (manifest.soundId.toLowerCase() !== expectedSoundId.toLowerCase()) {
		throw new Error(
			`Audio host returned ${manifest.soundId} for ${expectedSoundId}.`,
		);
	}
	const payload = response.subarray(HEADER_LENGTH + manifestLength);
	if (payload.byteLength !== manifest.payloadByteLength) {
		throw new Error(
			`Audio ${manifest.soundId} carries ${payload.byteLength} payload bytes; manifest declares ${manifest.payloadByteLength}.`,
		);
	}
	// Copied rather than viewed: `decodeAudioData` detaches the buffer it is given, which would
	// invalidate the whole response if this shared it.
	return {
		id: manifest.soundId as DatAssetId,
		mediaType: manifest.mediaType,
		payload: payload.slice().buffer,
	};
}
