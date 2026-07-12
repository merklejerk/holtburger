/** Matrix transported as sixteen values in the frontend Mat4 field order. */
export type HostMatrix4Dto = readonly number[];

/** Three-dimensional vector transported across the host boundary. */
export interface HostVec3Dto {
	readonly x: number;
	readonly y: number;
	readonly z: number;
}

/** Axis-aligned bounds transported across the host boundary. */
export interface HostAabbDto {
	readonly min: HostVec3Dto;
	readonly max: HostVec3Dto;
}

/** Request for one independently streamed landblock layer. */
export interface ResolveLandblockLayerRequestDto {
	readonly landblockId: string;
	readonly layer:
		| "terrain"
		| "buildings"
		| "objects"
		| "generated"
		| "env-cells";
}

/** Canonical geometry prepared by the Rust content pipeline. */
export interface HostGeometryDto {
	readonly id: string;
	readonly positions: readonly number[];
	readonly normals: readonly number[];
	readonly textureCoordinates: readonly number[];
	readonly indices: readonly number[];
	readonly materialSlotIndices: readonly number[];
	readonly bounds: HostAabbDto | null;
}

/** Material source before frontend texture placement is assigned. */
export type HostMaterialDto =
	| {
			readonly id: string;
			readonly kind: "solid-color";
			readonly color: readonly [number, number, number, number];
	  }
	| {
			readonly id: string;
			readonly kind: "texture";
			readonly colorTextureId: string;
			readonly paletteTextureId: string | null;
			readonly detailTextureId: string | null;
	  };

/** One part in a setup-backed object assembly. */
export interface HostObjectPartDto {
	readonly partIndex: number;
	readonly parentPartIndex: number | null;
	readonly geometryId: string;
	readonly defaultScale: HostVec3Dto;
	readonly materialIds: readonly string[];
}

/** A named setup placement containing a transform for every part. */
export interface HostPlacementPoseDto {
	readonly placementId: number;
	readonly partTransforms: readonly HostMatrix4Dto[];
}

/** One animation slice referenced by a motion sequence. */
export interface HostMotionClipRefDto {
	readonly animationId: string;
	readonly firstFrame: number;
	readonly lastFrame: number | null;
	readonly frameRate: number;
}

/** Motion sequence including authored linear and angular velocity. */
export interface HostMotionSequenceDto {
	readonly key: string;
	readonly clips: readonly HostMotionClipRefDto[];
	readonly velocity: HostVec3Dto | null;
	readonly angularVelocity: HostVec3Dto | null;
}

/** Normalized motion-table graph whose clips remain demand-loaded assets. */
export interface HostMotionGraphDto {
	readonly motionTableId: string;
	readonly defaultStyle: number;
	readonly styleDefaults: readonly {
		readonly style: number;
		readonly motion: number;
	}[];
	readonly cycles: readonly HostMotionSequenceDto[];
	readonly modifiers: readonly HostMotionSequenceDto[];
	readonly transitions: readonly HostMotionSequenceDto[];
}

/** Setup defaults that can trigger presentation-side effects. */
export interface HostObjectEffectDefaultsDto {
	readonly animationId: string | null;
	readonly physicsScriptId: string | null;
	readonly physicsScriptTableId: string | null;
	readonly soundTableId: string | null;
}

/** Fully expanded reusable object presentation definition. */
export interface HostObjectPresentationDto {
	readonly id: string;
	readonly sourceAssetId: string;
	readonly parts: readonly HostObjectPartDto[];
	readonly placementPoses: readonly HostPlacementPoseDto[];
	readonly materials: readonly HostMaterialDto[];
	readonly geometry: readonly HostGeometryDto[];
	readonly motion: HostMotionGraphDto | null;
	readonly effects: HostObjectEffectDefaultsDto;
	readonly selectionBounds: HostAabbDto | null;
	readonly sortingBounds: HostAabbDto | null;
}

/** Per-resident appearance substitutions applied to a shared object definition. */
export interface HostObjectAppearanceDto {
	readonly paletteId: string | null;
	readonly subPalettes: readonly {
		readonly paletteId: string;
		readonly firstIndex: number;
		readonly indexCount: number;
	}[];
	readonly textureChanges: readonly {
		readonly partIndex: number;
		readonly oldTextureId: string;
		readonly newTextureId: string;
	}[];
	readonly partChanges: readonly {
		readonly partIndex: number;
		readonly geometryId: string;
	}[];
}

/** One object resident placed by a static layer source. */
export interface HostObjectResidentDto {
	readonly id: string;
	readonly presentationId: string;
	readonly placement: HostMatrix4Dto;
	readonly envCellId: string | null;
	readonly scale: HostVec3Dto;
	readonly bounds: HostAabbDto | null;
	readonly appearance: HostObjectAppearanceDto | null;
	readonly activation: "static" | "dynamic";
}

/** Prepared reusable structure embedded by one or more environment cells. */
export interface HostCellStructureDto {
	readonly id: string;
	readonly geometry: HostGeometryDto;
	readonly surfaceSlotCount: number;
	readonly portalPolygonIndices: readonly number[];
	readonly cellBsp: unknown;
	readonly drawingBsp: unknown | null;
	readonly physicsBsp: unknown;
}

/** A scene residence participating in portal traversal. */
export type HostPortalGraphResidenceDto =
	| { readonly kind: "outdoor"; readonly landblockId: string }
	| { readonly kind: "building"; readonly residentId: string }
	| { readonly kind: "env-cell"; readonly envCellId: string };

/** One residence node in the host-prepared portal graph. */
export interface HostPortalGraphNodeDto {
	readonly id: string;
	readonly residence: HostPortalGraphResidenceDto;
}

/** Directed traversal edge between two scene residences. */
export interface HostPortalGraphEdgeDto {
	readonly id: string;
	readonly sourceNodeId: string;
	readonly targetNodeId: string;
	readonly apertureId: string | null;
}

/** Canonical graph combining env-cell and building-transition portals. */
export interface HostPortalGraphDto {
	readonly nodes: readonly HostPortalGraphNodeDto[];
	readonly edges: readonly HostPortalGraphEdgeDto[];
}

/** Indexed portal geometry in landblock-local coordinates. */
export interface HostPortalApertureDto {
	readonly id: string;
	readonly kind: "env-cell" | "building-transition";
	readonly vertices: readonly HostVec3Dto[];
	readonly indices: readonly number[];
	readonly bounds: HostAabbDto;
	readonly visibleSide: "positive" | "negative" | "both";
}

/** One environment-cell resident binding a reusable structure into a landblock. */
export interface HostEnvCellResidentDto {
	readonly id: string;
	readonly structureId: string;
	readonly placement: HostMatrix4Dto;
	readonly bounds: HostAabbDto;
	readonly materials: readonly HostMaterialDto[];
	readonly embeddedResidents: readonly HostObjectResidentDto[];
}

/** Terrain feature metadata retained for runtime mesh generation. */
export interface HostTerrainFeatureDto {
	readonly roadMaskTextureId: string;
	readonly colorTextureIds: readonly string[];
	readonly detailTextureId: string;
}

/** Metadata-only terrain source for one landblock. */
export interface HostTerrainLayerSourceDto {
	readonly kind: "terrain";
	readonly landblockId: string;
	readonly features: readonly HostTerrainFeatureDto[];
	readonly heights: readonly number[];
	readonly featureIndices: readonly number[];
}

/** Outdoor static object/building source prepared by the host. */
export interface HostObjectLayerSourceDto {
	readonly kind: "buildings" | "objects" | "generated";
	readonly landblockId: string;
	readonly presentations: readonly HostObjectPresentationDto[];
	readonly residents: readonly HostObjectResidentDto[];
}

/** Environment-cell source prepared by the host. */
export interface HostEnvCellLayerSourceDto {
	readonly kind: "env-cells";
	readonly landblockId: string;
	readonly presentations: readonly HostObjectPresentationDto[];
	readonly structures: readonly HostCellStructureDto[];
	readonly cells: readonly HostEnvCellResidentDto[];
	readonly portalGraph: HostPortalGraphDto;
	readonly portalApertures: readonly HostPortalApertureDto[];
}

/** Host response for one independently requested landblock layer. */
export type HostLandblockLayerSourceDto =
	| HostTerrainLayerSourceDto
	| HostObjectLayerSourceDto
	| HostEnvCellLayerSourceDto;
