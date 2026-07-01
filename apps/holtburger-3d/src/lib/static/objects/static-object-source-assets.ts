import type { PreparedGfxObjPayloadDto } from "../../assets/preparation/prepared-render-geometry";
import type { ObjectVisualGeometryBufferId } from "../../visual/object-visual-recipe-bundle";
import type {
	StaticObjectCanonicalGeometryIdentity,
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
		canonical: createStaticObjectCanonicalGeometryIdentity(options),
		kind: "static-object-source-geometry",
		source: options.source,
	};
}

function createStaticObjectCanonicalGeometryIdentity(options: {
	readonly gfxObj: StaticObjectSourceIdentity;
	readonly partIndex: number;
}): StaticObjectCanonicalGeometryIdentity {
	return {
		gfxObj: options.gfxObj,
		kind: "static-object-canonical-geometry",
		partIndex: options.partIndex,
	};
}

export function getStaticObjectCanonicalGeometryIdentity(
	identity: StaticObjectSourceGeometryIdentity,
): StaticObjectCanonicalGeometryIdentity {
	return identity.canonical;
}

export function describeStaticObjectSourceGeometryIdentity(
	identity: StaticObjectSourceGeometryIdentity,
): string {
	return [
		identity.kind,
		describeStaticObjectSourceIdentity(identity.source),
		describeStaticObjectCanonicalGeometryIdentity(identity.canonical),
	].join("|");
}

export function describeStaticObjectCanonicalGeometryIdentity(
	identity: StaticObjectCanonicalGeometryIdentity,
): string {
	return [
		identity.kind,
		describeStaticObjectSourceIdentity(identity.gfxObj),
		`part:${identity.partIndex}`,
	].join("|");
}

export function createStaticObjectSourceGeometryAttachment(options: {
	readonly identity: StaticObjectCanonicalGeometryIdentity;
	readonly bufferId: ObjectVisualGeometryBufferId;
	readonly gfxObj: PreparedGfxObjPayloadDto;
}): StaticObjectSourceGeometryAttachment {
	const renderGeometry = options.gfxObj.renderGeometry;
	return {
		buffer: {
			bounds: renderGeometry.bounds,
			bufferId: options.bufferId,
			coordinateSpace: "source-local",
			normals: renderGeometry.normals,
			positions: renderGeometry.positions,
			texCoords: renderGeometry.uvs,
			triangleCount: renderGeometry.triangleCount,
			triangles: renderGeometry.triangles.map((triangle) => ({
				firstVertex: triangle.firstVertex,
				materialVariantSignature: triangle.materialVariantSignature ?? null,
				polygonId: triangle.polygonId,
				surfaceId: triangle.surfaceId,
			})),
			vertexCount: renderGeometry.vertexCount,
		},
		identity: options.identity,
	};
}

function describeStaticObjectSourceIdentity(
	identity: StaticObjectSourceIdentity,
): string {
	return `${identity.sourceAssetKind}:${identity.sourceDid}`;
}
