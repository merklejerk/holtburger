import {
	collectTransferableBinarySidecars,
	type BinarySidecarView,
} from "../../workers/transfers";
import { createVisualGeometryPayloadTransferSidecars } from "../../visual/visual-geometry-transfers";
import type { StaticBakeJobResult, StaticDrawUnit } from "../contracts";

export function collectStaticBakeJobResultTransfers(
	result: StaticBakeJobResult,
): readonly Transferable[] {
	const sidecars: BinarySidecarView[] = [];
	for (const drawUnit of result.drawUnits) {
		sidecars.push(...createStaticDrawUnitTransferSidecars(drawUnit));
	}
	for (const drawUnit of result.objectVisualInstallSet.directDrawUnits) {
		sidecars.push(...createStaticDrawUnitTransferSidecars(drawUnit));
	}
	for (const resource of result.objectVisualInstallSet.visualResources) {
		sidecars.push(
			...createVisualGeometryPayloadTransferSidecars(
				resource,
				`Static bake visual resource ${resource.resourceId}`,
			),
		);
	}
	for (const instance of result.objectVisualInstallSet.renderInstances) {
		sidecars.push(
			createStaticBakeSidecar(
				`Static bake render instance ${instance.instanceId} sourceToLandblockMatrix`,
				instance.sourceToLandblockMatrix,
			),
		);
	}
	return collectTransferableBinarySidecars(sidecars);
}

function createStaticDrawUnitTransferSidecars(
	drawUnit: StaticDrawUnit,
): readonly BinarySidecarView[] {
	switch (drawUnit.kind) {
		case "terrain-geometry":
			return [
				createStaticBakeSidecar(
					`Static bake draw unit ${drawUnit.drawUnitId} positions`,
					drawUnit.positions,
				),
				createStaticBakeSidecar(
					`Static bake draw unit ${drawUnit.drawUnitId} texCoords`,
					drawUnit.texCoords,
				),
				createStaticBakeSidecar(
					`Static bake draw unit ${drawUnit.drawUnitId} layerSlots`,
					drawUnit.layerSlots,
				),
				createStaticBakeSidecar(
					`Static bake draw unit ${drawUnit.drawUnitId} indices`,
					drawUnit.indices,
				),
			];
		case "static-object-geometry":
		case "structured-interior-geometry":
			return [
				createStaticBakeSidecar(
					`Static bake draw unit ${drawUnit.drawUnitId} positions`,
					drawUnit.positions,
				),
				createStaticBakeSidecar(
					`Static bake draw unit ${drawUnit.drawUnitId} texCoords`,
					drawUnit.texCoords,
				),
				createStaticBakeSidecar(
					`Static bake draw unit ${drawUnit.drawUnitId} materialSlotIndices`,
					drawUnit.materialSlotIndices,
				),
				createStaticBakeSidecar(
					`Static bake draw unit ${drawUnit.drawUnitId} indices`,
					drawUnit.indices,
				),
			];
	}
	throw new Error(
		`Unsupported static draw unit kind ${(drawUnit as { readonly kind?: string }).kind ?? "<missing>"}.`,
	);
}

function createStaticBakeSidecar(
	label: string,
	view: ArrayBufferView,
): BinarySidecarView {
	return {
		label,
		ownership: "owned-transferable",
		view,
	};
}
