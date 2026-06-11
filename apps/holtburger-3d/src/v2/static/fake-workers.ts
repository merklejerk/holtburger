import type {
	DomainAtlasSnapshot,
	StaticBakeInput,
	StaticBakeResult,
	StaticBakerClient,
	StaticDrawUnit,
	StaticResolverClient,
	StaticResolverJob,
	StaticScopePayload,
	ScheduledStaticWork,
} from "./contracts";

export class DeferredStaticResolverClient implements StaticResolverClient {
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
		const request = this.#pending.find((candidate) => candidate.requestId === requestId);
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

export class DeferredStaticBakerClient implements StaticBakerClient {
	readonly #pending: StaticBakeInput[] = [];
	readonly #resolvers = new Map<
		string,
		{
			readonly resolve: (result: StaticBakeResult) => void;
			readonly reject: (error: Error) => void;
		}
	>();

	bake(input: StaticBakeInput): Promise<StaticBakeResult> {
		this.#pending.push(input);

		return new Promise((resolve, reject) => {
			this.#resolvers.set(input.work.workId, { reject, resolve });
		});
	}

	get pendingInputs(): readonly StaticBakeInput[] {
		return this.#pending;
	}

	complete(
		workId: string,
		result: Partial<Omit<StaticBakeResult, "work">> = {},
	): void {
		const input = this.#pending.find((candidate) => candidate.work.workId === workId);
		const resolver = this.#resolvers.get(workId);

		if (!input || !resolver) {
			throw new Error(`No pending bake work exists for ${workId}.`);
		}

		this.#resolvers.delete(workId);
		resolver.resolve(createFakeStaticBakeResult(input, result));
	}

	fail(workId: string, error: Error): void {
		const resolver = this.#resolvers.get(workId);

		if (!resolver) {
			throw new Error(`No pending bake work exists for ${workId}.`);
		}

		this.#resolvers.delete(workId);
		resolver.reject(error);
	}
}

export class ImmediateStaticResolverClient implements StaticResolverClient {
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

		return {
			job,
			scope: {
				kind: "placeholder",
				referencedTextureUses: [
					{
						kind: "prepared-texture-use",
						colorSpace: "linear",
						mipPolicy: "none",
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

export class ImmediateStaticBakerClient implements StaticBakerClient {
	async bake(input: StaticBakeInput): Promise<StaticBakeResult> {
		return createFakeStaticBakeResult(input);
	}
}

export function createEmptyAtlasSnapshot(
	work: ScheduledStaticWork,
	textureUses: DomainAtlasSnapshot["textureUses"],
): DomainAtlasSnapshot {
	return {
		domain: work.job.domain,
		placements: [],
		revision: 0,
		textureUses,
	};
}

function createFakeStaticBakeResult(
	input: StaticBakeInput,
	result: Partial<Omit<StaticBakeResult, "work">> = {},
): StaticBakeResult {
	return {
		atlasRegistryUpdates: result.atlasRegistryUpdates ?? [],
		buildRevision: result.buildRevision ?? input.payload.sourceRevision,
		drawUnits: result.drawUnits ?? [createPlaceholderDrawUnit(input.work.workId)],
		staticAuthoredDynamicSeeds: result.staticAuthoredDynamicSeeds ?? [],
		staticPortalInteriorRecords: result.staticPortalInteriorRecords ?? [],
		staticSourceMappings: result.staticSourceMappings ?? [],
		staticSpatialRecords: result.staticSpatialRecords ?? [],
		staticVisibilityRecords: result.staticVisibilityRecords ?? [],
		textureUses: result.textureUses ?? [],
		work: input.work,
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
