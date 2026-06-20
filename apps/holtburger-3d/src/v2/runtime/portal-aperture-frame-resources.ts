import type {
	PortalApertureCullMode,
	PortalApertureFrameDiagnostics,
	PortalApertureGeometryResourcePlan,
	PortalApertureMaskPass,
	PortalApertureSourceKind,
	PortalApertureVertex,
	PortalFrameSceneSource,
} from "../renderer/types";

export interface PortalApertureFrameResourcePlan {
	readonly diagnostics: PortalApertureFrameDiagnostics;
	readonly maskPasses: readonly PortalApertureMaskPass[];
	readonly resources: readonly PortalApertureGeometryResourcePlan[];
}

export interface PortalApertureMaskPassInput {
	readonly apertureSourceId: string;
	readonly cullMode: PortalApertureCullMode;
	readonly linkId: string;
	readonly parentStencilRef: number | null;
	readonly portalStackId: string;
	readonly source: PortalFrameSceneSource;
	readonly sourceKind: PortalApertureSourceKind;
	readonly sourcePortalStackId: string;
	readonly stencilRef: number;
	readonly target: PortalFrameSceneSource;
	readonly traversalDepth: number;
	readonly vertices: readonly PortalApertureVertex[];
}

export class PortalApertureFrameResourceBuilder {
	readonly #duplicateMaskPassKeys = new Set<string>();
	readonly #maskPasses: PortalApertureMaskPass[] = [];
	readonly #resources: PortalApertureGeometryResourcePlan[] = [];
	readonly #resourcesByGeometryKey = new Map<
		string,
		PortalApertureGeometryResourcePlan
	>();
	#buildingTransitionEdges = 0;
	#duplicateMaskEdges = 0;
	#envCellPortalEdges = 0;

	addMaskPass(input: PortalApertureMaskPassInput): boolean {
		if (input.vertices.length === 0) {
			return false;
		}
		const geometryKey = createPortalApertureGeometryKey(input.vertices);
		const maskPassKey = createPortalApertureMaskPassKey(input, geometryKey);
		if (this.#duplicateMaskPassKeys.has(maskPassKey)) {
			this.#duplicateMaskEdges += 1;
			return false;
		}
		this.#duplicateMaskPassKeys.add(maskPassKey);

		const resource = this.#getOrCreateGeometryResource(
			geometryKey,
			input.vertices,
			input.sourceKind,
		);
		this.#maskPasses.push({
			apertureResourceId: resource.resourceId,
			apertureSourceId: input.apertureSourceId,
			cullMode: input.cullMode,
			linkId: input.linkId,
			parentStencilRef: input.parentStencilRef,
			portalStackId: input.portalStackId,
			source: input.source,
			sourceKind: input.sourceKind,
			sourcePortalStackId: input.sourcePortalStackId,
			stencilRef: input.stencilRef,
			target: input.target,
			traversalDepth: input.traversalDepth,
		});

		if (input.sourceKind === "building-transition") {
			this.#buildingTransitionEdges += 1;
		} else {
			this.#envCellPortalEdges += 1;
		}
		return true;
	}

	build(options: {
		readonly transitionRootCount: number;
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
				transitionRootCount: options.transitionRootCount,
			},
			maskPasses: this.#maskPasses,
			resources: this.#resources,
		};
	}

	#getOrCreateGeometryResource(
		geometryKey: string,
		vertices: readonly PortalApertureVertex[],
		sourceKind: PortalApertureSourceKind,
	): PortalApertureGeometryResourcePlan {
		const existingResource = this.#resourcesByGeometryKey.get(geometryKey);
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
				this.#resourcesByGeometryKey.set(geometryKey, replacement);
				return replacement;
			}
			return existingResource;
		}

		const resource: PortalApertureGeometryResourcePlan = {
			resourceId: `portal-aperture:${hashStringFNV1a(geometryKey)}`,
			sourceKinds: [sourceKind],
			vertices,
		};
		this.#resourcesByGeometryKey.set(geometryKey, resource);
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
		transitionRootCount: 0,
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

function createPortalApertureMaskPassKey(
	input: PortalApertureMaskPassInput,
	geometryKey: string,
): string {
	return [
		input.sourceKind,
		input.apertureSourceId,
		input.linkId,
		input.sourcePortalStackId,
		input.portalStackId,
		input.parentStencilRef ?? "root",
		input.stencilRef,
		input.traversalDepth,
		describePortalFrameSceneSource(input.source),
		describePortalFrameSceneSource(input.target),
		input.cullMode,
		geometryKey,
	].join("|");
}

function describePortalFrameSceneSource(
	source: PortalFrameSceneSource,
): string {
	if (source.kind === "outdoor-target") {
		return `outdoor:${source.landblockId >>> 0}`;
	}
	return `env:${source.landblockId >>> 0}:${source.envCellId >>> 0}`;
}

function createPortalApertureGeometryKey(
	vertices: readonly PortalApertureVertex[],
): string {
	return vertices
		.map((vertex) => vertex.map((value) => value.toFixed(6)).join(","))
		.join(";");
}

function hashStringFNV1a(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}
