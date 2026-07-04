import { collectTransferableBinarySidecars } from "../../workers/transfers";
import type { TexturePackingResult } from "./protocol";

export function collectTexturePackingResultTransfers(
	result: TexturePackingResult,
): readonly Transferable[] {
	return collectTransferableBinarySidecars(
		result.pages.map((page) => ({
			label: "Texture packing result page pixels",
			ownership: "owned-transferable",
			view: page.pixels,
		})),
	);
}
