import type { GfxObjPayloadDto } from "../../../lib/host/contracts";
import type {
	StaticObjectSourceGeometryAttachment,
	StaticObjectSourceGeometryIdentity,
	StaticObjectSourceIdentity,
} from "../contracts";

export function createStaticObjectSourceGeometryIdentity(options: {
	readonly source: StaticObjectSourceIdentity;
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly partIndex: number;
}): StaticObjectSourceGeometryIdentity {
	return {
		gfxObj: options.gfxObj,
		kind: "static-object-source-geometry",
		partIndex: options.partIndex,
		source: options.source,
	};
}

export function describeStaticObjectSourceGeometryIdentity(
	identity: StaticObjectSourceGeometryIdentity,
): string {
	return [
		identity.kind,
		describeStaticObjectSourceIdentity(identity.source),
		describeStaticObjectSourceIdentity(identity.gfxObj),
		`part:${identity.partIndex}`,
	].join("|");
}

export function createStaticObjectSourceGeometryAttachment(options: {
	readonly identity: StaticObjectSourceGeometryIdentity;
	readonly gfxObj: GfxObjPayloadDto;
}): StaticObjectSourceGeometryAttachment {
	return {
		identity: options.identity,
		positions: toFloat32Array(options.gfxObj.renderGeometry.positions),
		texCoords: toFloat32Array(options.gfxObj.renderGeometry.uvs),
	};
}

function describeStaticObjectSourceIdentity(
	identity: StaticObjectSourceIdentity,
): string {
	return `${identity.sourceAssetKind}:${identity.sourceDid}`;
}

function toFloat32Array(values: ArrayLike<number>): Float32Array {
	return values instanceof Float32Array ? values : Float32Array.from(values);
}
