import { collectTransferableArrayBuffers } from "../../workers/transfers";
import type { TexturePackingResult } from "./protocol";

export function collectTexturePackingResultTransfers(
	result: TexturePackingResult,
): readonly Transferable[] {
	return collectTransferableArrayBuffers(
		result.pages.map((page) => page.pixels),
		{ label: "Texture packing result page pixels" },
	);
}
