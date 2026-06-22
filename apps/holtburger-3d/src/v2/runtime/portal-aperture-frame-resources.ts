import type {
	PortalApertureFrameDiagnostics,
	PortalApertureGeometryResourcePlan,
	PortalApertureSourceKind,
} from "../renderer/types";

export interface PortalApertureFrameResourcePlan {
	readonly diagnostics: PortalApertureFrameDiagnostics;
	readonly resources: readonly PortalApertureGeometryResourcePlan[];
}

export interface PortalApertureEdgeResourceInput {
	readonly apertureRangeId: string;
	readonly apertureSourceId: string;
	readonly duplicateKeyParts: readonly (number | string)[];
	readonly linkId: string;
	readonly sourceKind: PortalApertureSourceKind;
}

export class PortalApertureFrameResourceBuilder {
	readonly #duplicateEdgeKeys = new Set<string>();
	readonly #resources: PortalApertureGeometryResourcePlan[] = [];
	readonly #resourcesById = new Map<
		string,
		PortalApertureGeometryResourcePlan
	>();
	#buildingTransitionEdges = 0;
	#duplicateMaskEdges = 0;
	#envCellPortalEdges = 0;

	addEdgeResource(input: PortalApertureEdgeResourceInput): string | null {
		const edgeKey = createPortalApertureEdgeKey(input);
		if (this.#duplicateEdgeKeys.has(edgeKey)) {
			this.#duplicateMaskEdges += 1;
			return null;
		}
		this.#duplicateEdgeKeys.add(edgeKey);

		const resource = this.#getOrCreateGeometryResource(
			input.apertureRangeId,
			input.sourceKind,
		);
		if (input.sourceKind === "building-transition") {
			this.#buildingTransitionEdges += 1;
		} else {
			this.#envCellPortalEdges += 1;
		}
		return resource.resourceId;
	}

	build(options: {
		readonly transitionRootCandidateCount: number;
		readonly transitionRootCount: number;
		readonly transitionRootsRejectedNotSeenOutside: number;
		readonly transitionRootsRejectedUnknownSeenOutside: number;
	}): PortalApertureFrameResourcePlan {
		return {
			diagnostics: {
				buildingTransitionEdges: this.#buildingTransitionEdges,
				dedupedGeometryResources:
					this.#buildingTransitionEdges +
					this.#envCellPortalEdges -
					this.#resources.length,
				duplicateMaskEdges: this.#duplicateMaskEdges,
				envCellPortalEdges: this.#envCellPortalEdges,
				selectedMaskEdges:
					this.#buildingTransitionEdges + this.#envCellPortalEdges,
				transitionRootCandidateCount: options.transitionRootCandidateCount,
				transitionRootCount: options.transitionRootCount,
				transitionRootsRejectedNotSeenOutside:
					options.transitionRootsRejectedNotSeenOutside,
				transitionRootsRejectedUnknownSeenOutside:
					options.transitionRootsRejectedUnknownSeenOutside,
			},
			resources: this.#resources,
		};
	}

	#getOrCreateGeometryResource(
		resourceId: string,
		sourceKind: PortalApertureSourceKind,
	): PortalApertureGeometryResourcePlan {
		const existingResource = this.#resourcesById.get(resourceId);
		if (existingResource) {
			const sourceKinds = addSourceKind(
				existingResource.sourceKinds,
				sourceKind,
			);
			if (sourceKinds !== existingResource.sourceKinds) {
				const replacement = { ...existingResource, sourceKinds };
				const resourceIndex = this.#resources.indexOf(existingResource);
				if (resourceIndex >= 0) {
					this.#resources[resourceIndex] = replacement;
				}
				this.#resourcesById.set(resourceId, replacement);
				return replacement;
			}
			return existingResource;
		}

		const resource: PortalApertureGeometryResourcePlan = {
			resourceId,
			sourceKinds: [sourceKind],
		};
		this.#resourcesById.set(resourceId, resource);
		this.#resources.push(resource);
		return resource;
	}
}

export function createEmptyPortalApertureFrameDiagnostics(): PortalApertureFrameDiagnostics {
	return {
		buildingTransitionEdges: 0,
		dedupedGeometryResources: 0,
		duplicateMaskEdges: 0,
		envCellPortalEdges: 0,
		selectedMaskEdges: 0,
		transitionRootCandidateCount: 0,
		transitionRootCount: 0,
		transitionRootsRejectedNotSeenOutside: 0,
		transitionRootsRejectedUnknownSeenOutside: 0,
	};
}

function addSourceKind(
	sourceKinds: readonly PortalApertureSourceKind[],
	sourceKind: PortalApertureSourceKind,
): readonly PortalApertureSourceKind[] {
	return sourceKinds.includes(sourceKind)
		? sourceKinds
		: [...sourceKinds, sourceKind].sort();
}

function createPortalApertureEdgeKey(
	input: PortalApertureEdgeResourceInput,
): string {
	return [
		input.sourceKind,
		input.apertureRangeId,
		input.apertureSourceId,
		input.linkId,
		...input.duplicateKeyParts,
	].join("|");
}
