import type {
	DesiredLandblockRenderProduct,
	LandblockRenderProduct,
	LandblockRenderProductWorkerResult,
} from "./landblock-render-product";

export interface StaticLandblockRenderArtifactStoreSnapshot {
	artifacts: readonly LandblockRenderProductWorkerResult[];
	desiredCount: number;
	residentCount: number;
	inFlightCount: number;
	staleResultCount: number;
	committedResultCount: number;
	evictedResultCount: number;
	errorCount: number;
	latestDesiredIdentityKeys: readonly string[];
}

export function createEmptyStaticLandblockRenderArtifactStoreSnapshot(): StaticLandblockRenderArtifactStoreSnapshot {
	return {
		artifacts: [],
		desiredCount: 0,
		residentCount: 0,
		inFlightCount: 0,
		staleResultCount: 0,
		committedResultCount: 0,
		evictedResultCount: 0,
		errorCount: 0,
		latestDesiredIdentityKeys: [],
	};
}

export class StaticLandblockRenderArtifactStore {
	private readonly artifactsByArtifactKey = new Map<
		string,
		LandblockRenderProductWorkerResult
	>();
	private readonly latestDesiredIdentityByTargetKey = new Map<string, string>();
	private readonly inFlightIdentityKeys = new Set<string>();
	private staleResultCount = 0;
	private committedResultCount = 0;
	private evictedResultCount = 0;
	private errorCount = 0;

	syncDesiredProducts(
		desiredProducts: readonly DesiredLandblockRenderProduct[],
	): void {
		const desiredTargetKeys = new Set<string>();
		for (const desired of desiredProducts) {
			const targetKey = formatDesiredTargetKey(desired);
			desiredTargetKeys.add(targetKey);
			this.latestDesiredIdentityByTargetKey.set(
				targetKey,
				formatDesiredIdentityKey(desired),
			);
		}

		for (const targetKey of [...this.latestDesiredIdentityByTargetKey.keys()]) {
			if (!desiredTargetKeys.has(targetKey)) {
				this.latestDesiredIdentityByTargetKey.delete(targetKey);
			}
		}
		for (const [artifactKey, artifact] of [
			...this.artifactsByArtifactKey.entries(),
		]) {
			if (!desiredTargetKeys.has(formatResultTargetKey(artifact))) {
				this.artifactsByArtifactKey.delete(artifactKey);
				this.evictedResultCount += 1;
			}
		}
		for (const identityKey of [...this.inFlightIdentityKeys]) {
			if (!desiredTargetKeys.has(formatIdentityTargetKey(identityKey))) {
				this.inFlightIdentityKeys.delete(identityKey);
			}
		}
	}

	markInFlight(desired: DesiredLandblockRenderProduct): boolean {
		const identityKey = formatDesiredIdentityKey(desired);
		if (this.inFlightIdentityKeys.has(identityKey)) {
			return false;
		}
		this.inFlightIdentityKeys.add(identityKey);
		return true;
	}

	commitResult(result: LandblockRenderProductWorkerResult): boolean {
		const identityKey = formatResultIdentityKey(result);
		this.inFlightIdentityKeys.delete(identityKey);
		if (
			this.latestDesiredIdentityByTargetKey.get(
				formatResultTargetKey(result),
			) !== identityKey
		) {
			this.staleResultCount += 1;
			return false;
		}
		this.artifactsByArtifactKey.set(formatResultArtifactKey(result), result);
		this.committedResultCount += 1;
		return true;
	}

	markError(desired: DesiredLandblockRenderProduct): void {
		this.inFlightIdentityKeys.delete(formatDesiredIdentityKey(desired));
		this.errorCount += 1;
	}

	hasCurrentArtifact(desired: DesiredLandblockRenderProduct): boolean {
		return this.artifactsByArtifactKey.has(formatDesiredArtifactKey(desired));
	}

	snapshot(): StaticLandblockRenderArtifactStoreSnapshot {
		const artifacts = [...this.artifactsByArtifactKey.values()].sort(
			compareResults,
		);
		return {
			artifacts,
			desiredCount: this.latestDesiredIdentityByTargetKey.size,
			residentCount: artifacts.length,
			inFlightCount: this.inFlightIdentityKeys.size,
			staleResultCount: this.staleResultCount,
			committedResultCount: this.committedResultCount,
			evictedResultCount: this.evictedResultCount,
			errorCount: this.errorCount,
			latestDesiredIdentityKeys: [
				...this.latestDesiredIdentityByTargetKey.values(),
			].sort(),
		};
	}
}

function formatDesiredArtifactKey(
	desired: DesiredLandblockRenderProduct,
): string {
	return formatArtifactKey({
		landblockId: desired.landblockId,
		product: desired.product,
		buildPolicyRevision: desired.buildPolicyRevision,
		texturePagePolicyRevision: desired.texturePagePolicyRevision,
	});
}

function formatResultArtifactKey(
	result: LandblockRenderProductWorkerResult,
): string {
	return formatArtifactKey(result);
}

function formatArtifactKey(input: {
	landblockId: number;
	product: LandblockRenderProduct;
	buildPolicyRevision: string;
	texturePagePolicyRevision: string;
}): string {
	return [
		input.landblockId,
		input.product,
		input.buildPolicyRevision,
		input.texturePagePolicyRevision,
	].join(":");
}

function formatDesiredTargetKey(
	desired: DesiredLandblockRenderProduct,
): string {
	return `${desired.landblockId}:${desired.product}`;
}

function formatResultTargetKey(
	result: LandblockRenderProductWorkerResult,
): string {
	return `${result.landblockId}:${result.product}`;
}

function formatDesiredIdentityKey(
	desired: DesiredLandblockRenderProduct,
): string {
	return [
		formatDesiredTargetKey(desired),
		desired.requestId,
		desired.buildPolicyRevision,
		desired.texturePagePolicyRevision,
	].join(":");
}

function formatResultIdentityKey(
	result: LandblockRenderProductWorkerResult,
): string {
	return [
		formatResultTargetKey(result),
		result.requestId,
		result.buildPolicyRevision,
		result.texturePagePolicyRevision,
	].join(":");
}

function formatIdentityTargetKey(identityKey: string): string {
	const [landblockId, product] = identityKey.split(":");
	return `${landblockId ?? ""}:${product ?? ""}`;
}

function compareResults(
	left: LandblockRenderProductWorkerResult,
	right: LandblockRenderProductWorkerResult,
): number {
	if (left.landblockId !== right.landblockId) {
		return left.landblockId - right.landblockId;
	}
	return left.product.localeCompare(right.product);
}
