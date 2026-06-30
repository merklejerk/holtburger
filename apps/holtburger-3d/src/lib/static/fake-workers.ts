import type {
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBaker,
	StaticDomain,
	StaticLandblockSceneLodLayerRequest,
	StaticLandblockSceneLodResolution,
	StaticLandblockSceneLodSourceRequest,
	StaticLandblockSceneLodSourceResolver,
	StaticLayerRecipe,
	StaticResolver,
	StaticResolverJob,
	StaticScopePayload,
} from "./contracts";

export class DeferredStaticResolver
	implements StaticResolver, StaticLandblockSceneLodSourceResolver
{
	readonly #pending: {
		readonly requestId: string;
		readonly job: StaticResolverJob;
		readonly revision: number;
	}[] = [];
	readonly #pendingSourceRequests: {
		readonly requestId: string;
		readonly request: StaticLandblockSceneLodSourceRequest;
		readonly revision: number;
	}[] = [];
	readonly #resolvers = new Map<
		string,
		{
			readonly resolve: (payload: StaticScopePayload) => void;
			readonly reject: (error: Error) => void;
		}
	>();
	readonly #sourceResolvers = new Map<
		string,
		{
			readonly resolve: (resolution: StaticLandblockSceneLodResolution) => void;
			readonly reject: (error: Error) => void;
		}
	>();
	readonly #sourceLayerRequests = new Map<
		string,
		{
			readonly layer: StaticLandblockSceneLodLayerRequest;
			readonly request: StaticLandblockSceneLodSourceRequest;
			readonly sourceRequestId: string;
			readonly revision: number;
		}
	>();

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		const revision = this.#pending.length + 1;
		const requestId = `fake-resolver:${revision}:${describeFakeResolverRequestId(job)}`;

		this.#pending.push({ job, requestId, revision });

		return new Promise((resolve, reject) => {
			this.#resolvers.set(requestId, { reject, resolve });
		});
	}

	resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		const revision = this.#pendingSourceRequests.length + 1;
		const requestId = `fake-source-resolver:${revision}:landblock:${formatHex32(
			request.landblockId,
		)}:lod:${request.sourceLod}`;

		this.#pendingSourceRequests.push({ request, requestId, revision });
		for (const layer of request.requestedLayers) {
			const job: StaticResolverJob = {
				domain: staticDomainForFakeSourceLayer(layer.kind),
				scope: {
					kind: "landblock",
					landblockId: request.landblockId,
				},
			};
			const layerRequestId = `${requestId}:${layer.kind}`;
			this.#pending.push({
				job,
				requestId: layerRequestId,
				revision,
			});
			this.#sourceLayerRequests.set(layerRequestId, {
				layer,
				request,
				revision,
				sourceRequestId: requestId,
			});
		}

		return new Promise((resolve, reject) => {
			this.#sourceResolvers.set(requestId, { reject, resolve });
		});
	}

	get pendingRequests(): readonly {
		readonly requestId: string;
		readonly job: StaticResolverJob;
		readonly revision: number;
	}[] {
		return this.#pending;
	}

	get pendingSourceRequests(): readonly {
		readonly requestId: string;
		readonly request: StaticLandblockSceneLodSourceRequest;
		readonly revision: number;
	}[] {
		return this.#pendingSourceRequests;
	}

	complete(
		requestId: string,
		payload: Partial<Omit<StaticScopePayload, "job" | "scope">> & {
			readonly scope?: StaticScopePayload["scope"];
		} = {},
	): void {
		const request = this.#pending.find(
			(candidate) => candidate.requestId === requestId,
		);
		const resolver = this.#resolvers.get(requestId);

		if (!resolver) {
			const sourceLayerRequest = this.#sourceLayerRequests.get(requestId);
			if (sourceLayerRequest) {
				if (!this.#sourceResolvers.has(sourceLayerRequest.sourceRequestId)) {
					return;
				}
				this.completeSource(sourceLayerRequest.sourceRequestId, [
					...sourceLayerRequest.request.requestedLayers.map((layer) =>
						createFakeLayerRecipe(
							sourceLayerRequest.request,
							layer,
							sourceLayerRequest.revision,
							layer.kind === sourceLayerRequest.layer.kind ? payload : {},
						),
					),
				]);
				return;
			}
		}

		if (!request || !resolver) {
			throw new Error(`No pending resolver request exists for ${requestId}.`);
		}

		this.#resolvers.delete(requestId);
		resolver.resolve(
			createFakeStaticScopePayload(request.job, request.revision, payload),
		);
	}

	completeSource(
		requestId: string,
		recipes: readonly StaticLayerRecipe[] | null = null,
	): void {
		const sourceRequest = this.#pendingSourceRequests.find(
			(candidate) => candidate.requestId === requestId,
		);
		const resolver = this.#sourceResolvers.get(requestId);

		if (!sourceRequest || !resolver) {
			throw new Error(
				`No pending source resolver request exists for ${requestId}.`,
			);
		}

		this.#sourceResolvers.delete(requestId);
		resolver.resolve({
			dynamicRecipes: [],
			recipes:
				recipes ??
				sourceRequest.request.requestedLayers.map((layer) =>
					createFakeLayerRecipe(
						sourceRequest.request,
						layer,
						sourceRequest.revision,
					),
				),
			request: sourceRequest.request,
		});
	}

	fail(requestId: string, error: Error): void {
		const resolver = this.#resolvers.get(requestId);

		if (!resolver) {
			const sourceLayerRequest = this.#sourceLayerRequests.get(requestId);
			if (sourceLayerRequest) {
				if (!this.#sourceResolvers.has(sourceLayerRequest.sourceRequestId)) {
					return;
				}
				this.failSource(sourceLayerRequest.sourceRequestId, error);
				return;
			}
			throw new Error(`No pending resolver request exists for ${requestId}.`);
		}

		this.#resolvers.delete(requestId);
		resolver.reject(error);
	}

	failSource(requestId: string, error: Error): void {
		const resolver = this.#sourceResolvers.get(requestId);

		if (!resolver) {
			throw new Error(
				`No pending source resolver request exists for ${requestId}.`,
			);
		}

		this.#sourceResolvers.delete(requestId);
		resolver.reject(error);
	}
}

export class DeferredStaticBaker implements StaticBaker {
	readonly #pending: StaticBakeBatchInput[] = [];
	readonly #resolvers = new Map<
		string,
		{
			readonly resolve: (result: StaticBakeBatchResult) => void;
			readonly reject: (error: Error) => void;
		}
	>();

	bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		this.#pending.push(input);

		return new Promise((resolve, reject) => {
			this.#resolvers.set(input.staticBatchId, { reject, resolve });
		});
	}

	get pendingInputs(): readonly StaticBakeBatchInput[] {
		return this.#pending;
	}

	complete(
		staticBatchId: string,
		result: Partial<
			Omit<
				StaticBakeBatchResult,
				"domain" | "revision" | "staticBatchId" | "tasks"
			>
		> = {},
	): void {
		const input = this.#pending.find(
			(candidate) => candidate.staticBatchId === staticBatchId,
		);
		const resolver = input ? this.#resolvers.get(input.staticBatchId) : null;

		if (!input || !resolver) {
			throw new Error(`No pending bake batch exists for ${staticBatchId}.`);
		}

		this.#resolvers.delete(input.staticBatchId);
		resolver.resolve(createFakeStaticBakeResult(input, result));
	}

	fail(staticBatchId: string, error: Error): void {
		const input = this.#pending.find(
			(candidate) => candidate.staticBatchId === staticBatchId,
		);
		const resolver = input ? this.#resolvers.get(input.staticBatchId) : null;

		if (!input || !resolver) {
			throw new Error(`No pending bake batch exists for ${staticBatchId}.`);
		}

		this.#resolvers.delete(input.staticBatchId);
		resolver.reject(error);
	}
}

export class ImmediateStaticResolver
	implements StaticResolver, StaticLandblockSceneLodSourceResolver
{
	async resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		return createFakeStaticScopePayload(
			job,
			createStableFakeRenderSurfaceId(job),
		);
	}

	async resolveSource(
		request: StaticLandblockSceneLodSourceRequest,
	): Promise<StaticLandblockSceneLodResolution> {
		return {
			dynamicRecipes: [],
			recipes: request.requestedLayers.map((layer) =>
				createFakeLayerRecipe(
					request,
					layer,
					createStableFakeSourceRevision(request),
				),
			),
			request,
		};
	}
}

export class ImmediateStaticBaker implements StaticBaker {
	async bake(input: StaticBakeBatchInput): Promise<StaticBakeBatchResult> {
		return createFakeStaticBakeResult(input);
	}
}

function createFakeStaticBakeResult(
	input: StaticBakeBatchInput,
	result: Partial<
		Omit<
			StaticBakeBatchResult,
			"domain" | "revision" | "staticBatchId" | "tasks"
		>
	> = {},
): StaticBakeBatchResult {
	return {
		atlasRegistryUpdates: result.atlasRegistryUpdates ?? [],
		buildRevision:
			result.buildRevision ??
			Math.max(...input.items.map((item) => item.payload.sourceRevision), 0),
		domain: input.domain,
		drawUnits: result.drawUnits ?? [],
		staticObjectBakeDiagnostics: result.staticObjectBakeDiagnostics ?? [],
		staticObjectRenderInstances: result.staticObjectRenderInstances ?? [],
		staticObjectVisualResources: result.staticObjectVisualResources ?? [],
		materialCoverage: result.materialCoverage ?? [],
		portalApertureResources: result.portalApertureResources ?? [],
		revision: input.revision,
		staticAuthoredDynamicSeeds: result.staticAuthoredDynamicSeeds ?? [],
		staticPortalGraphs: result.staticPortalGraphs ?? [],
		staticPortalInteriorRecords: result.staticPortalInteriorRecords ?? [],
		staticSourceMappings: result.staticSourceMappings ?? [],
		staticSpatialRecords: result.staticSpatialRecords ?? [],
		staticVisibilityRecords: result.staticVisibilityRecords ?? [],
		staticBatchId: input.staticBatchId,
		tasks: input.items.map((item) => item.task),
		textureUses: result.textureUses ?? [],
	};
}

function createFakeLayerRecipe(
	request: StaticLandblockSceneLodSourceRequest,
	layer: StaticLandblockSceneLodLayerRequest,
	revision: number,
	payload: Partial<Omit<StaticScopePayload, "job" | "scope">> & {
		readonly scope?: StaticScopePayload["scope"];
	} = {},
): StaticLayerRecipe {
	const job: StaticResolverJob = {
		domain: staticDomainForFakeSourceLayer(layer.kind),
		scope: {
			kind: "landblock",
			landblockId: request.landblockId,
		},
	};

	return {
		payload: createFakeStaticScopePayload(job, revision, payload),
		targetOwnerKey: layer.targetOwnerKey,
	};
}

function staticDomainForFakeSourceLayer(
	kind: StaticLandblockSceneLodLayerRequest["kind"],
): StaticDomain {
	switch (kind) {
		case "terrain":
			return "outdoor-terrain";
		case "outdoor-buildings":
			return "outdoor-buildings";
		case "outdoor-explicit-objects":
			return "outdoor-explicit-objects";
		case "outdoor-generated-scenery":
			return "outdoor-generated-scenery";
		case "env-cell-system":
			return "env-cell-system";
	}
}

function createFakeStaticScopePayload(
	job: StaticResolverJob,
	revision: number,
	payload: Partial<Omit<StaticScopePayload, "job" | "scope">> & {
		readonly scope?: StaticScopePayload["scope"];
	} = {},
): StaticScopePayload {
	return {
		job,
		scope: payload.scope ?? createFakeStaticScopePayloadBody(job),
		sourceRevision: payload.sourceRevision ?? revision,
	};
}

function createFakeStaticScopePayloadBody(
	job: StaticResolverJob,
): StaticScopePayload["scope"] {
	if (job.domain === "env-cell-system" && job.scope.kind === "landblock") {
		return {
			acceptedEnvCellIds: [],
			envCells: [],
			kind: "env-cell-system",
			landblock: {
				kind: "landblock-source",
				landblockId: job.scope.landblockId,
				source: "env-cells",
			},
			materialSources: [],
			missingRefs: [],
			paletteSources: [],
			portalApertureResources: [],
			portalConnectivityGraph: {
				edges: [],
				nodes: [],
			},
			portalLinks: [],
			regionRenderProfile: {
				detailRoles: [],
				identity: {
					kind: "region-render-profile",
					regionNumber: 0,
				},
			},
			residencySpatial: {
				envCellSystemBvhItemCount: 0,
				envCellSystemBvhNodeCount: 0,
				envCellSystemBvh: {
					items: [],
					nodes: [],
				},
			},
			sourceAssets: [],
			textureRefs: [],
			visibilityDiagnostics: [],
		};
	}

	if (job.domain === "outdoor-buildings" && job.scope.kind === "landblock") {
		return {
			authoredDynamicPlacements: [],
			authoredDynamicSeeds: [],
			buildingTransitionApertures: [],
			domain: "outdoor-buildings",
			kind: "outdoor-static-objects",
			landblock: {
				kind: "landblock-source",
				landblockId: job.scope.landblockId,
				source: "outdoor",
			},
			materialSlots: [],
			materialSources: [],
			missingRefs: [],
			objects: [],
			paletteSources: [],
			regionRenderProfile: {
				detailRoles: [],
				identity: {
					kind: "region-render-profile",
					regionNumber: 0,
				},
			},
			sourceAssets: [],
			sourceSpatial: {
				bounds: null,
				coordinateSpace: "landblock-render-local",
				outdoorBvh: null,
				outdoorBvhItemCount: 0,
				outdoorBvhNodeCount: 0,
			},
			textureRefs: [],
		};
	}

	return {
		kind: "placeholder",
		referencedTextureUses: [
			{
				kind: "prepared-render-surface-texture-use",
				renderSurface: {
					kind: "render-surface",
					renderSurfaceId: createStableFakeRenderSurfaceId(job),
				},
				usage: "rgba-color",
			},
		],
	};
}

function describeFakeResolverRequestId(job: StaticResolverJob): string {
	return `${describeFakeScope(job.scope)}:${job.domain}`;
}

function describeFakeScope(scope: StaticResolverJob["scope"]): string {
	return `landblock:${formatHex32(scope.landblockId)}`;
}

function createStableFakeRenderSurfaceId(job: StaticResolverJob): number {
	return hashText(`${describeFakeScope(job.scope)}:${job.domain}`);
}

function createStableFakeSourceRevision(
	request: StaticLandblockSceneLodSourceRequest,
): number {
	return hashText(
		`landblock:${formatHex32(request.landblockId)}:lod:${request.sourceLod}:${request.context}`,
	);
}

function hashText(value: string): number {
	let hash = 2166136261;

	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
