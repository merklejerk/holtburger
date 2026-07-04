import { collectTransferableBinarySidecars } from "../workers/transfers";
import { createVisualGeometryPayloadTransferSidecars } from "../visual/visual-geometry-transfers";
import type { DynamicVisualBakeResult } from "./contracts";

export function collectDynamicVisualBakeResultTransfers(
	result: DynamicVisualBakeResult,
): readonly Transferable[] {
	if (result.product?.kind !== "baked") {
		return [];
	}
	return collectTransferableBinarySidecars(
		result.product.resource.renderParts.flatMap((part) =>
			createVisualGeometryPayloadTransferSidecars(
				part,
				`Dynamic visual bake render part ${part.renderPartId}`,
			),
		),
	);
}
