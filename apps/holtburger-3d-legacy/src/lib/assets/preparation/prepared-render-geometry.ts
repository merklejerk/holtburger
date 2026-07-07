import type { GfxObjPayloadDto } from "../../../lib/host/contracts";

type HostPreparedRenderGeometry = GfxObjPayloadDto["renderGeometry"];
type PreparedFloat32ArrayDto = Extract<
	HostPreparedRenderGeometry["positions"],
	Float32Array
>;

/** Render geometry after host transport decoding has installed typed vertex buffers. */
export type PreparedRenderGeometryDto = Omit<
	HostPreparedRenderGeometry,
	"normals" | "positions" | "uvs"
> & {
	readonly normals: PreparedFloat32ArrayDto;
	readonly positions: PreparedFloat32ArrayDto;
	readonly uvs: PreparedFloat32ArrayDto;
};

/** Full prepared gfx-obj payload consumed by bake attachment providers. */
export type PreparedGfxObjPayloadDto = Omit<
	GfxObjPayloadDto,
	"renderGeometry"
> & {
	readonly renderGeometry: PreparedRenderGeometryDto;
};

export function requirePreparedGfxObjPayload(
	payload: GfxObjPayloadDto,
	context: string,
): PreparedGfxObjPayloadDto {
	requirePreparedRenderGeometryBuffers(payload.renderGeometry, context);
	return payload as PreparedGfxObjPayloadDto;
}

export function requirePreparedRenderGeometryBuffers(
	renderGeometry: HostPreparedRenderGeometry,
	context: string,
): asserts renderGeometry is PreparedRenderGeometryDto {
	requireFloat32Array(renderGeometry.positions, `${context}.positions`);
	requireFloat32Array(renderGeometry.normals, `${context}.normals`);
	requireFloat32Array(renderGeometry.uvs, `${context}.uvs`);
}

function requireFloat32Array(value: unknown, context: string): void {
	if (value instanceof Float32Array) {
		return;
	}

	throw new Error(
		`${context} must be a Float32Array in prepared render geometry.`,
	);
}
