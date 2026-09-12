import { decode } from "@msgpack/msgpack";
import { z } from "zod";
import type { HostTransport } from "../lib/host/host-transport";
import { asHostBinary } from "../lib/host/binary-response";

/** Shared wire limits; the host independently enforces the same contract. */
export const MAX_ICON_BATCH = 32;
export const MAX_ICON_FRAME_BYTES = 256 * 1024;
const MAX_ICON_KEY_BYTES = 128;
const ITEM_ICON_SIZE = 32;
const uint = z.number().int().nonnegative().max(0xffff_ffff);
const did = uint.positive().nullable();
/** Complete visual inputs. Item identity, selection, sorting and display size are excluded. */
export type ItemIconSpec =
	| {
			/** Standalone authored graphic without item decorations. */
			readonly kind: "base";
			/** Required RenderSurface identity, independent of inventory membership. */
			readonly base: number;
	  }
	| ({
			readonly overlay: number | null;
			readonly underlay: number | null;
			readonly uiEffects: number;
	  } & (
			| {
					readonly kind: "item";
					readonly base: number | null;
					readonly itemType: number;
			  }
			| { readonly kind: "main-pack" }
	  ));

/** Keyed specifications sent to the host's shared-content capability. */
export interface ItemIconRequest {
	readonly key: string;
	readonly spec: ItemIconSpec;
}

const issueSchema = z
	.object({
		layer: z.enum([
			"base",
			"background",
			"effects",
			"overlay",
			"underlay",
			"composition",
		]),
		code: z.enum([
			"unassigned-base",
			"missing-mapping",
			"missing-asset",
			"unsupported-format",
			"decode",
			"composition",
		]),
		assetId: did,
		detail: z.string().min(1).max(1024),
	})
	.strict()
	.readonly();
/** Nonempty diagnostics are preserved alongside degraded artwork. */
export type IconIssue = z.infer<typeof issueSchema>;
const issues = z.tuple([issueSchema]).rest(issueSchema).readonly();
const key = z.string().min(1).max(MAX_ICON_KEY_BYTES);
const image = z
	.instanceof(Uint8Array)
	.refine(isNativeIconPng, "Expected a native-size PNG icon.");
const resultSchema = z.discriminatedUnion("kind", [
	z
		.object({ kind: z.literal("ready"), key, image })
		.strict()
		.readonly(),
	z
		.object({ kind: z.literal("degraded"), key, image, issues })
		.strict()
		.readonly(),
	z
		.object({ kind: z.literal("failed"), key, issues })
		.strict()
		.readonly(),
]);
export type PreparedItemIcon = z.infer<typeof resultSchema>;

/** One transport boundary, including structural validation and exact response-key matching. */
export async function prepareItemIcons(
	transport: Pick<HostTransport, "invoke">,
	icons: readonly ItemIconRequest[],
): Promise<readonly PreparedItemIcon[]> {
	const value = await transport.invoke("prepare_item_icons", {
		request: { icons },
	});
	return decodeItemIcons(asHostBinary(value, "Item-icon preparation"), icons);
}

/** Reject malformed/partial batches as a whole; repository callers settle their live entries. */
export function decodeItemIcons(
	bytes: Uint8Array,
	requested: readonly ItemIconRequest[],
): readonly PreparedItemIcon[] {
	if (bytes.byteLength > MAX_ICON_FRAME_BYTES)
		throw new Error("Icon response exceeds byte limit.");
	const value: unknown = decode(bytes, {
		maxArrayLength: MAX_ICON_BATCH,
		maxMapLength: 16,
		maxStrLength: 1024,
		maxBinLength: MAX_ICON_FRAME_BYTES,
	});
	const results = z.array(resultSchema).min(1).max(MAX_ICON_BATCH).parse(value);
	const expected = new Set(requested.map(({ key }) => key));
	for (const result of results) {
		if (!expected.delete(result.key))
			throw new Error(
				`Unexpected or duplicate icon response key: ${result.key}`,
			);
	}
	if (expected.size > 0)
		throw new Error("Icon response omitted requested keys.");
	return results;
}

function isNativeIconPng(bytes: Uint8Array): boolean {
	// Header validation precedes URL creation. Browser decoding still owns full PNG validation.
	const signature = [137, 80, 78, 71, 13, 10, 26, 10];
	if (
		bytes.byteLength < 33 ||
		!signature.every((value, index) => bytes[index] === value)
	)
		return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return (
		view.getUint32(8) === 13 &&
		view.getUint32(12) === 0x49484452 &&
		view.getUint32(16) === ITEM_ICON_SIZE &&
		view.getUint32(20) === ITEM_ICON_SIZE
	);
}
