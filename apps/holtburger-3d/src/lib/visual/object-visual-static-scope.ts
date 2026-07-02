import type {
	EnvCellSystemStaticScopePayload,
	OutdoorStaticObjectsScopePayload,
} from "../static/contracts";
import type {
	ObjectVisualBundleReadyResolution,
	ObjectVisualBundleResolution,
	ObjectVisualGeometryBuffer,
	ObjectVisualGeometryBufferId,
	ObjectVisualResidency,
} from "./object-visual-recipe-bundle";
import type { ObjectVisualStaticPublicationMetadata } from "./object-visual-static-publication";

export type ObjectVisualStaticScope =
	| ObjectVisualEnvCellSystemStaticScope
	| ObjectVisualOutdoorStaticObjectScope;

interface ObjectVisualStaticVisualProduct {
	/** Heavy source-local geometry buffers referenced by ready object visual recipes. */
	readonly geometryBuffers: ReadonlyMap<
		ObjectVisualGeometryBufferId,
		ObjectVisualGeometryBuffer
	>;
	/** Static publication facts used after the shared object visual baker partitions recipes. */
	readonly publicationMetadata: ObjectVisualStaticPublicationMetadata | null;
	/** Drawable object-like visual recipe resolution for this static scope. */
	readonly resolution: ObjectVisualBundleResolution;
}

interface ObjectVisualOutdoorStaticObjectScope {
	readonly domain: OutdoorStaticObjectsScopePayload["domain"];
	readonly kind: "outdoor-object-visual-static-scope";
	readonly landblock: OutdoorStaticObjectsScopePayload["landblock"];
	readonly sidecars: ObjectVisualOutdoorStaticObjectSidecars;
	readonly visual: ObjectVisualStaticVisualProduct;
}

interface ObjectVisualOutdoorStaticObjectSidecars {
	/** Static-authored dynamic placements stay outside drawable static recipes. */
	readonly authoredDynamicPlacements: OutdoorStaticObjectsScopePayload["authoredDynamicPlacements"];
	/** Building-transition aperture records remain sidecars owned by the static layer. */
	readonly buildingTransitionApertures: OutdoorStaticObjectsScopePayload["buildingTransitionApertures"];
	/** Current material/source facts retained until recipe expansion producers delete this dependency. */
	readonly materialSlots: OutdoorStaticObjectsScopePayload["materialSlots"];
	readonly materialSources: OutdoorStaticObjectsScopePayload["materialSources"];
	readonly missingRefs: OutdoorStaticObjectsScopePayload["missingRefs"];
	readonly paletteSources: OutdoorStaticObjectsScopePayload["paletteSources"];
	readonly regionRenderProfile: OutdoorStaticObjectsScopePayload["regionRenderProfile"];
	readonly sourceAssets: OutdoorStaticObjectsScopePayload["sourceAssets"];
	/** Spatial and BVH facts are residency/query sidecars, not visual recipes. */
	readonly sourceSpatial: OutdoorStaticObjectsScopePayload["sourceSpatial"];
	readonly textureRefs: OutdoorStaticObjectsScopePayload["textureRefs"];
}

interface ObjectVisualEnvCellSystemStaticScope {
	readonly kind: "env-cell-system-object-visual-static-scope";
	readonly landblock: EnvCellSystemStaticScopePayload["landblock"];
	readonly sidecars: ObjectVisualEnvCellSystemSidecars;
	readonly visual: ObjectVisualStaticVisualProduct;
}

interface ObjectVisualEnvCellSystemSidecars {
	readonly acceptedEnvCellIds: EnvCellSystemStaticScopePayload["acceptedEnvCellIds"];
	/** Env-cell source records stay as sidecars for portals, visibility, placement, and BSP facts. */
	readonly envCells: EnvCellSystemStaticScopePayload["envCells"];
	readonly materialSources: EnvCellSystemStaticScopePayload["materialSources"];
	readonly missingRefs: EnvCellSystemStaticScopePayload["missingRefs"];
	readonly paletteSources: EnvCellSystemStaticScopePayload["paletteSources"];
	readonly portalApertureResources: EnvCellSystemStaticScopePayload["portalApertureResources"];
	readonly portalConnectivityGraph: EnvCellSystemStaticScopePayload["portalConnectivityGraph"];
	readonly portalLinks: EnvCellSystemStaticScopePayload["portalLinks"];
	readonly regionRenderProfile: EnvCellSystemStaticScopePayload["regionRenderProfile"];
	/** Residency and visibility are runtime/static sidecars, not drawable recipe data. */
	readonly residencySpatial: EnvCellSystemStaticScopePayload["residencySpatial"];
	readonly sourceAssets: EnvCellSystemStaticScopePayload["sourceAssets"];
	readonly textureRefs: EnvCellSystemStaticScopePayload["textureRefs"];
	readonly visibilityDiagnostics: EnvCellSystemStaticScopePayload["visibilityDiagnostics"];
}

export function createObjectVisualStaticScope<
	TScope extends ObjectVisualStaticScope,
>(scope: TScope): TScope {
	validateStaticVisualProduct(scope.visual, scope.kind);
	if (scope.visual.resolution.kind === "ready") {
		validateResidencies(scope.visual.resolution, scope);
	}
	return scope;
}

function validateStaticVisualProduct(
	visual: ObjectVisualStaticVisualProduct,
	scopeKind: ObjectVisualStaticScope["kind"],
): void {
	if (visual.resolution.kind === "missing-dependencies") {
		if (visual.publicationMetadata !== null) {
			throw new Error(
				`${scopeKind} missing-dependencies visual scopes cannot carry static publication metadata.`,
			);
		}
		if (visual.geometryBuffers.size > 0) {
			throw new Error(
				`${scopeKind} missing-dependencies visual scopes cannot carry geometry buffers.`,
			);
		}
		return;
	}

	if (visual.publicationMetadata === null) {
		throw new Error(
			`${scopeKind} ready visual scopes require static publication metadata.`,
		);
	}

	for (const bufferId of visual.resolution.bundle.geometryBufferRefs.keys()) {
		const buffer = visual.geometryBuffers.get(bufferId);
		if (!buffer) {
			throw new Error(
				`${scopeKind} ready visual scope references geometry buffer ${bufferId}, but no sidecar buffer was provided.`,
			);
		}
		if (buffer.coordinateSpace !== "source-local") {
			throw new Error(
				`${scopeKind} geometry buffer ${bufferId} must be source-local.`,
			);
		}
	}
}

function validateResidencies(
	resolution: ObjectVisualBundleReadyResolution,
	scope: ObjectVisualStaticScope,
): void {
	for (const instance of resolution.bundle.partInstances) {
		if (!isValidStaticResidency(instance.residency, scope)) {
			throw new Error(
				`${scope.kind} part instance ${instance.instanceId} has invalid residency ${instance.residency.kind}.`,
			);
		}
	}
}

function isValidStaticResidency(
	residency: ObjectVisualResidency,
	scope: ObjectVisualStaticScope,
): boolean {
	switch (scope.kind) {
		case "outdoor-object-visual-static-scope":
			return (
				residency.kind === "outdoor-landblock" &&
				residency.landblockId === scope.landblock.landblockId
			);
		case "env-cell-system-object-visual-static-scope":
			return (
				residency.kind === "env-cell" &&
				residency.landblockId === scope.landblock.landblockId
			);
	}
}
