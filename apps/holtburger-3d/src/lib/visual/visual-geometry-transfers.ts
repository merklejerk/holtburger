import { type BinarySidecarView } from "../workers/transfers";
import type { VisualGeometryPayload } from "./visual-geometry";

export function createVisualGeometryPayloadTransferSidecars(
	payload: VisualGeometryPayload,
	label: string,
): readonly BinarySidecarView[] {
	return [
		createGeometrySidecar(`${label} positions`, payload.positions),
		createGeometrySidecar(`${label} texCoords`, payload.texCoords),
		createGeometrySidecar(
			`${label} materialSlotIndices`,
			payload.materialSlotIndices,
		),
		createGeometrySidecar(`${label} indices`, payload.indices),
	];
}

function createGeometrySidecar(
	label: string,
	view: ArrayBufferView,
): BinarySidecarView {
	return {
		label,
		ownership: "owned-transferable",
		view,
	};
}
