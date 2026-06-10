import type {
	DomainAtlasSnapshot,
	StaticBakeInput,
	StaticBakeResult,
	StaticBakerClient,
	StaticResolverClient,
	StaticScopePayload,
	StaticWorkRequest,
} from "./contracts";

export class DeferredStaticResolverClient implements StaticResolverClient {
	readonly #pending: StaticWorkRequest[] = [];
	readonly #resolvers = new Map<
		string,
		{
			readonly resolve: (payload: StaticScopePayload) => void;
			readonly reject: (error: Error) => void;
		}
	>();

	resolve(request: StaticWorkRequest): Promise<StaticScopePayload> {
		this.#pending.push(request);

		return new Promise((resolve, reject) => {
			this.#resolvers.set(request.requestId, { reject, resolve });
		});
	}

	get pendingRequests(): readonly StaticWorkRequest[] {
		return this.#pending;
	}

	complete(
		requestId: string,
		payload: Partial<Omit<StaticScopePayload, "request" | "scope">> & {
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
			request,
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
			this.#resolvers.set(input.request.requestId, { reject, resolve });
		});
	}

	get pendingInputs(): readonly StaticBakeInput[] {
		return this.#pending;
	}

	complete(
		requestId: string,
		result: Partial<Omit<StaticBakeResult, "request">> = {},
	): void {
		const input = this.#pending.find(
			(candidate) => candidate.request.requestId === requestId,
		);
		const resolver = this.#resolvers.get(requestId);

		if (!input || !resolver) {
			throw new Error(`No pending bake request exists for ${requestId}.`);
		}

		this.#resolvers.delete(requestId);
		resolver.resolve(createFakeStaticBakeResult(input, result));
	}

	fail(requestId: string, error: Error): void {
		const resolver = this.#resolvers.get(requestId);

		if (!resolver) {
			throw new Error(`No pending bake request exists for ${requestId}.`);
		}

		this.#resolvers.delete(requestId);
		resolver.reject(error);
	}
}

export class ImmediateStaticResolverClient implements StaticResolverClient {
	async resolve(request: StaticWorkRequest): Promise<StaticScopePayload> {
		return {
			request,
			scope: {
				kind: "placeholder",
				referencedTextureUses: [
					{
						kind: "prepared-texture-use",
						colorSpace: "srgb",
						mipPolicy: "retail4",
						outputFormat: "rgba8",
						renderSurfaceId: request.revision,
						usage: "color",
					},
				],
			},
			sourceRevision: request.revision,
		};
	}
}

export class ImmediateStaticBakerClient implements StaticBakerClient {
	async bake(input: StaticBakeInput): Promise<StaticBakeResult> {
		return createFakeStaticBakeResult(input);
	}
}

export function createEmptyAtlasSnapshot(
	request: StaticWorkRequest,
	textureUses: DomainAtlasSnapshot["textureUses"],
): DomainAtlasSnapshot {
	return {
		domain: request.domain,
		revision: request.revision,
		textureUses,
	};
}

function createFakeStaticBakeResult(
	input: StaticBakeInput,
	result: Partial<Omit<StaticBakeResult, "request">> = {},
): StaticBakeResult {
	return {
		atlasRegistryUpdates: result.atlasRegistryUpdates ?? [],
		buildRevision: result.buildRevision ?? input.request.revision,
		drawUnitIds: result.drawUnitIds ?? [
			`${input.request.requestId}:fake-draw-unit`,
		],
		request: input.request,
		staticAuthoredDynamicSeeds: result.staticAuthoredDynamicSeeds ?? [],
		staticPortalInteriorRecords: result.staticPortalInteriorRecords ?? [],
		staticSourceMappings: result.staticSourceMappings ?? [],
		staticSpatialRecords: result.staticSpatialRecords ?? [],
		staticVisibilityRecords: result.staticVisibilityRecords ?? [],
	};
}
