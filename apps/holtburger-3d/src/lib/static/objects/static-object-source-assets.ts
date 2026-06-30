import type { PreparedGfxObjPayloadDto } from "../../assets/preparation/prepared-render-geometry";
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
	readonly gfxObj: PreparedGfxObjPayloadDto;
}): StaticObjectSourceGeometryAttachment {
	return {
		identity: options.identity,
		positions: options.gfxObj.renderGeometry.positions,
		texCoords: options.gfxObj.renderGeometry.uvs,
	};
}

function describeStaticObjectSourceIdentity(
	identity: StaticObjectSourceIdentity,
): string {
	return `${identity.sourceAssetKind}:${identity.sourceDid}`;
}
