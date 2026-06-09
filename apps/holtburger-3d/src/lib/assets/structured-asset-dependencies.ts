type OutdoorStaticMemberKind =
	| "explicit-object"
	| "building"
	| "generated-scenery";

interface OutdoorStaticMemberDependencyFact {
	kind: OutdoorStaticMemberKind;
	sourceAssetId: string;
}

interface LandblockOutdoorDependencyFacts {
	statics: readonly OutdoorStaticMemberDependencyFact[];
}

interface EnvCellStaticDependencyFact {
	sourceAssetId: string;
}

interface EnvCellSurfaceDependencyFact {
	materialAssetId: string;
}

interface EnvCellDependencyFacts {
	statics: readonly EnvCellStaticDependencyFact[];
	surfaces: readonly EnvCellSurfaceDependencyFact[];
}

export type OutdoorStaticDependencyDomain =
	| "all"
	| "outdoor-buildings"
	| "outdoor-detail";

export function collectLandblockOutdoorRenderableSourceAssetIds(
	payload: LandblockOutdoorDependencyFacts,
): string[] {
	return collectLandblockOutdoorRenderableSourceAssetIdsForDomain(
		payload,
		"all",
	);
}

export function collectLandblockOutdoorRenderableSourceAssetIdsForDomain(
	payload: LandblockOutdoorDependencyFacts,
	domain: OutdoorStaticDependencyDomain,
): string[] {
	return uniqueSortedAssetIds(
		payload.statics
			.filter((member) =>
				isOutdoorStaticMemberIncludedInDomain(member, domain),
			)
			.map((member) => member.sourceAssetId),
	);
}

export function collectEnvCellRenderableSourceAssetIds(
	payload: EnvCellDependencyFacts,
): string[] {
	return uniqueSortedAssetIds(
		payload.statics.map((member) => member.sourceAssetId),
	);
}

export function collectEnvCellMaterialAssetIds(
	payload: EnvCellDependencyFacts,
): string[] {
	return uniqueSortedAssetIds(
		payload.surfaces.map((surface) => surface.materialAssetId),
	);
}

function isOutdoorStaticMemberIncludedInDomain(
	member: OutdoorStaticMemberDependencyFact,
	domain: OutdoorStaticDependencyDomain,
): boolean {
	if (domain === "outdoor-buildings") {
		return member.kind === "building";
	}
	if (domain === "outdoor-detail") {
		return member.kind !== "building";
	}
	return true;
}

function uniqueSortedAssetIds(assetIds: readonly string[]): string[] {
	return [...new Set(assetIds)].sort();
}
