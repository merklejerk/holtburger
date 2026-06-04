import type { AssetLookupResponseDto } from "../../lib/host/contracts";
import type {
	PreparedAssetRecord,
	PreparedPolygonSetRenderGeometry,
} from "../../lib/assets/types";

export function prepareAssetForPostMessage(
	asset: PreparedAssetRecord,
): Transferable[] {
	const transferables: Transferable[] = [];
	const transferredBuffers = new Set<ArrayBuffer>();
	asset.response = createPreparedResponseSummary(asset.response);
	collectPreparedAssetTransferables(asset, transferables, transferredBuffers);
	return transferables;
}

function createPreparedResponseSummary(
	response: AssetLookupResponseDto,
): AssetLookupResponseDto {
	return {
		requestId: response.requestId,
		assetId: response.assetId,
		payloadKind: response.payloadKind,
		payload: {
			kind: "prepared-response-summary",
		},
	};
}

function collectPreparedAssetTransferables(
	asset: PreparedAssetRecord,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): void {
	if (asset.payload.kind === "gfx-obj") {
		normalizeRenderGeometryForTransfer(
			asset.payload.renderGeometry,
			transferables,
			transferredBuffers,
		);
		return;
	}

	if (asset.payload.kind === "env-cell") {
		normalizeRenderGeometryForTransfer(
			asset.payload.renderGeometry,
			transferables,
			transferredBuffers,
		);
		return;
	}

	if (asset.payload.kind === "render-surface") {
		asset.payload.sourceBytes = normalizeUint8ArrayForTransfer(
			asset.payload.sourceBytes,
			transferables,
			transferredBuffers,
		);
		return;
	}

	if (asset.payload.kind === "palette") {
		asset.payload.colorsArgb = normalizeUint32ArrayForTransfer(
			asset.payload.colorsArgb,
			transferables,
			transferredBuffers,
		);
	}
}

function normalizeRenderGeometryForTransfer(
	renderGeometry: PreparedPolygonSetRenderGeometry,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): void {
	renderGeometry.positions = normalizeFloat32ArrayForTransfer(
		renderGeometry.positions,
		transferables,
		transferredBuffers,
	);
	renderGeometry.normals = normalizeFloat32ArrayForTransfer(
		renderGeometry.normals,
		transferables,
		transferredBuffers,
	);
	renderGeometry.uvs = normalizeFloat32ArrayForTransfer(
		renderGeometry.uvs,
		transferables,
		transferredBuffers,
	);
}

function normalizeFloat32ArrayForTransfer(
	values: number[] | Float32Array,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): Float32Array {
	const typedValues = createTransferableFloat32Array(values);
	collectTransferableBuffer(typedValues, transferables, transferredBuffers);
	return typedValues;
}

function normalizeUint8ArrayForTransfer(
	values: Uint8Array,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): Uint8Array {
	const typedValues = createTransferableUint8Array(values);
	collectTransferableBuffer(typedValues, transferables, transferredBuffers);
	return typedValues;
}

function createTransferableUint8Array(values: Uint8Array): Uint8Array {
	if (
		values.byteOffset === 0 &&
		values.byteLength === values.buffer.byteLength &&
		isTransferableArrayBuffer(values.buffer)
	) {
		return values;
	}

	return new Uint8Array(values);
}

function normalizeUint32ArrayForTransfer(
	values: Uint32Array,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): Uint32Array {
	const typedValues = createTransferableUint32Array(values);
	collectTransferableBuffer(typedValues, transferables, transferredBuffers);
	return typedValues;
}

function createTransferableUint32Array(values: Uint32Array): Uint32Array {
	if (
		values.byteOffset === 0 &&
		values.byteLength === values.buffer.byteLength &&
		isTransferableArrayBuffer(values.buffer)
	) {
		return values;
	}

	return new Uint32Array(values);
}

function collectTransferableBuffer(
	values: ArrayBufferView,
	transferables: Transferable[],
	transferredBuffers: Set<ArrayBuffer>,
): void {
	const buffer = values.buffer;
	if (
		values.byteLength > 0 &&
		values.byteOffset === 0 &&
		values.byteLength === buffer.byteLength &&
		isTransferableArrayBuffer(buffer) &&
		!transferredBuffers.has(buffer)
	) {
		transferredBuffers.add(buffer);
		transferables.push(buffer);
	}
}

function createTransferableFloat32Array(
	values: number[] | Float32Array,
): Float32Array {
	if (!(values instanceof Float32Array)) {
		return new Float32Array(values);
	}

	if (
		values.byteOffset === 0 &&
		values.byteLength === values.buffer.byteLength &&
		isTransferableArrayBuffer(values.buffer)
	) {
		return values;
	}

	return new Float32Array(values);
}

function isTransferableArrayBuffer(
	buffer: ArrayBufferLike,
): buffer is ArrayBuffer {
	return Object.prototype.toString.call(buffer) === "[object ArrayBuffer]";
}
