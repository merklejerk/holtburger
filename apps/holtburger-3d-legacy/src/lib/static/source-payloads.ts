import type {
	LandblockSceneLodLayerDto,
	LandblockSceneLodPayloadDto,
} from "../host/contracts";

type TerrainLayerDto = Extract<
	LandblockSceneLodLayerDto,
	{ readonly kind: "terrain" }
>;
type OutdoorBuildingsLayerDto = Extract<
	LandblockSceneLodLayerDto,
	{ readonly kind: "outdoor-buildings" }
>;
type OutdoorStaticLayerDto = Extract<
	LandblockSceneLodLayerDto,
	{
		readonly kind:
			| "outdoor-buildings"
			| "outdoor-explicit-objects"
			| "outdoor-generated-scenery";
	}
>;
type EnvCellSystemLayerDto = Extract<
	LandblockSceneLodLayerDto,
	{ readonly kind: "env-cell-system" }
>;

/** Resolver-local outdoor source facts projected from a landblock scene LoD payload. */
export interface LandblockOutdoorLayerSourcePayloadDto {
	readonly kind: "landblock-scene-lod-outdoor-layer";
	readonly landblockId: LandblockSceneLodPayloadDto["landblockId"];
	readonly regionId: LandblockSceneLodPayloadDto["regionId"];
	readonly regionNumber: LandblockSceneLodPayloadDto["regionNumber"];
	readonly terrain: TerrainLayerDto["terrain"];
	readonly statics: OutdoorStaticLayerDto["statics"];
	readonly buildingTransitionApertures: OutdoorBuildingsLayerDto["buildingTransitionApertures"];
	readonly outdoorBvh: OutdoorStaticLayerDto["outdoorBvh"] | null;
	readonly diagnostics: LandblockSceneLodPayloadDto["diagnostics"];
	readonly provenance: LandblockSceneLodPayloadDto["provenance"];
}

/** Resolver-local env-cell source facts projected from a landblock scene LoD payload. */
export interface EnvCellSystemLayerSourcePayloadDto {
	readonly kind: "landblock-scene-lod-env-cell-layer";
	readonly landblockId: LandblockSceneLodPayloadDto["landblockId"];
	readonly landblockInfoId: EnvCellSystemLayerDto["landblockInfoId"];
	readonly regionId: LandblockSceneLodPayloadDto["regionId"];
	readonly regionNumber: LandblockSceneLodPayloadDto["regionNumber"];
	readonly portalConnectivityGraph: EnvCellSystemLayerDto["portalConnectivityGraph"];
	readonly portalApertureResources: EnvCellSystemLayerDto["portalApertureResources"];
	readonly envCells: EnvCellSystemLayerDto["envCells"];
	readonly portalLinks: EnvCellSystemLayerDto["portalLinks"];
	readonly envCellSystemBvh: EnvCellSystemLayerDto["envCellSystemBvh"];
	readonly diagnostics: EnvCellSystemLayerDto["diagnostics"];
	readonly provenance: LandblockSceneLodPayloadDto["provenance"];
}
