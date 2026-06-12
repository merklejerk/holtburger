import type {
	StaticBakeBatchInput,
	StaticBakeBatchResult,
	StaticBaker,
	StaticDrawUnit,
	StaticResolver,
	StaticResolverJob,
	StaticScopePayload,
} from "./contracts";

export class DeferredStaticResolver implements StaticResolver {
	readonly #pending: {
		readonly requestId: string;
		readonly job: StaticResolverJob;
		readonly revision: number;
	}[] = [];
	readonly #resolvers = new Map<
		string,
		{
			readonly resolve: (payload: StaticScopePayload) => void;
			readonly reject: (error: Error) => void;
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

	get pendingRequests(): readonly {
		readonly requestId: string;
		readonly job: StaticResolverJob;
		readonly revision: number;
	}[] {
		return this.#pending;
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

		if (!request || !resolver) {
			throw new Error(`No pending resolver request exists for ${requestId}.`);
		}

		this.#resolvers.delete(requestId);
		resolver.resolve({
			job: request.job,
			scope: payload.scope ?? {
				kind: "placeholder",
				referencedTextureUses: [],
			},
			sourceRevision: payload.sourceRevision ?? request.revision,
		});
	}

	fail(requestId: string, error: Error): void {
		const resolver = this.#resolvers.get(requestId);

		if (!resolver) {
			throw new Error(`No pending resolver request exists for ${requestId}.`);
		}

		this.#resolvers.delete(requestId);
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
				"domain" | "revision" | "staticBatchId" | "works"
			>
		> = {},
	): void {
		const input = this.#pending.find(
			(candidate) =>
				candidate.staticBatchId === staticBatchId ||
				candidate.items.some((item) => item.work.workId === staticBatchId),
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
			(candidate) =>
				candidate.staticBatchId === staticBatchId ||
				candidate.items.some((item) => item.work.workId === staticBatchId),
		);
		const resolver = input ? this.#resolvers.get(input.staticBatchId) : null;

		if (!input || !resolver) {
			throw new Error(`No pending bake batch exists for ${staticBatchId}.`);
		}

		this.#resolvers.delete(input.staticBatchId);
		resolver.reject(error);
	}
}

export class ImmediateStaticResolver implements StaticResolver {
	async resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		if (job.domain === "landblock-topology" && job.scope.kind === "landblock") {
			return {
				job,
				scope: {
					classification: "outdoor",
					envCells: [],
					kind: "landblock-topology",
					landblock: {
						kind: "landblock-source",
						landblockId: job.scope.landblockId,
						source: "topology",
					},
					missingRefs: [],
					portalLinks: [],
					residencySpatial: {
						coordinateSpace: "landblock-topology-residency",
						envCellResidencyBvhItemCount: 0,
						envCellResidencyBvhNodeCount: 0,
					},
				},
				sourceRevision: createStableFakeRenderSurfaceId(job),
			};
		}

		if (job.domain === "dungeon-static" && job.scope.kind === "landblock") {
			return {
				job,
				scope: {
					classification: "dungeon",
					envCells: [],
					kind: "dungeon-static",
					landblock: {
						kind: "landblock-source",
						landblockId: job.scope.landblockId,
						source: "topology",
					},
					missingRefs: [],
					portalLinks: [],
				},
				sourceRevision: createStableFakeRenderSurfaceId(job),
			};
		}

		if (job.domain === "outdoor-buildings" && job.scope.kind === "landblock") {
			return {
				job,
				scope: {
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
						outdoorBvhItemCount: 0,
						outdoorBvhNodeCount: 0,
					},
					textureRefs: [],
				},
				sourceRevision: createStableFakeRenderSurfaceId(job),
			};
		}

		return {
			job,
			scope: {
				kind: "placeholder",
				referencedTextureUses: [
					{
						kind: "prepared-texture-use",
						outputFormat: "rgba8",
						renderSurfaceId: createStableFakeRenderSurfaceId(job),
						usage: "color",
					},
				],
			},
			sourceRevision: createStableFakeRenderSurfaceId(job),
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
			"domain" | "revision" | "staticBatchId" | "works"
		>
	> = {},
): StaticBakeBatchResult {
	return {
		atlasRegistryUpdates: result.atlasRegistryUpdates ?? [],
		buildRevision:
			result.buildRevision ??
			Math.max(...input.items.map((item) => item.payload.sourceRevision), 0),
		domain: input.domain,
		drawUnits: result.drawUnits ?? [
			...input.items.map((item) => createPlaceholderDrawUnit(item.work.workId)),
		],
		revision: input.revision,
		staticAuthoredDynamicSeeds: result.staticAuthoredDynamicSeeds ?? [],
		staticPortalInteriorRecords: result.staticPortalInteriorRecords ?? [],
		staticSourceMappings: result.staticSourceMappings ?? [],
		staticSpatialRecords: result.staticSpatialRecords ?? [],
		staticVisibilityRecords: result.staticVisibilityRecords ?? [],
		staticBatchId: input.staticBatchId,
		textureUses: result.textureUses ?? [],
		works: input.items.map((item) => item.work),
	};
}

function createPlaceholderDrawUnit(workId: string): StaticDrawUnit {
	return {
		drawUnitId: `${workId}:fake-draw-unit`,
		kind: "placeholder",
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
