export type StaticDomain = "terrain" | "buildings" | "detail" | "envCells";

export type StaticScope =
	| {
			readonly kind: "landblock";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "env-cell";
			readonly landblockId: number;
			readonly envCellId: number;
	  };

export interface StaticLodRadii {
	readonly terrain: number;
	readonly buildings: number;
	readonly detail: number;
	readonly envCells: number;
}

export type StaticDemandLocation =
	| {
			readonly kind: "outdoor-landblock";
			readonly landblockId: number;
	  }
	| {
			readonly kind: "interior-cell";
			readonly landblockId: number;
			readonly envCellId: number;
	  };

export interface StaticDemand {
	readonly location: StaticDemandLocation | null;
	readonly lod: StaticLodRadii;
	readonly policyRevision: number;
}

export interface StaticWorkRequest {
	readonly requestId: string;
	readonly revision: number;
	readonly scope: StaticScope;
	readonly domain: StaticDomain;
	readonly priority: number;
	readonly policyRevision: number;
}

export interface StaticScopePayload {
	readonly request: StaticWorkRequest;
	readonly referencedTextureKeys: readonly string[];
	readonly sourceRevision: number;
}

export interface DomainAtlasSnapshot {
	readonly domain: StaticDomain;
	readonly revision: number;
	readonly textureKeys: readonly string[];
}

export interface StaticBakeInput {
	readonly request: StaticWorkRequest;
	readonly payload: StaticScopePayload;
	readonly atlasSnapshot: DomainAtlasSnapshot;
}

export interface StaticBakeResult {
	readonly request: StaticWorkRequest;
	readonly drawUnitIds: readonly string[];
	readonly atlasRegistryUpdates: readonly string[];
	readonly staticSpatialRecords: readonly string[];
	readonly staticVisibilityRecords: readonly string[];
	readonly staticPortalInteriorRecords: readonly string[];
	readonly staticSourceMappings: readonly string[];
	readonly staticAuthoredDynamicSeeds: readonly string[];
	readonly buildRevision: number;
}

export interface StaticResolverClient {
	resolve(request: StaticWorkRequest): Promise<StaticScopePayload>;
}

export interface StaticBakerClient {
	bake(input: StaticBakeInput): Promise<StaticBakeResult>;
}

export interface StaticCoordinatorSnapshot {
	readonly revision: number;
	readonly requested: number;
	readonly resolving: number;
	readonly baking: number;
	readonly committed: number;
	readonly failed: number;
	readonly staleResolverResults: number;
	readonly staleBakeResults: number;
	readonly committedDrawUnits: number;
	readonly activeRequests: readonly StaticWorkRequestStatus[];
}

export interface StaticWorkRequestStatus {
	readonly requestId: string;
	readonly revision: number;
	readonly domain: StaticDomain;
	readonly scopeKey: string;
	readonly status: "requested" | "resolving" | "baking" | "committed" | "failed";
}
