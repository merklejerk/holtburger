import type {
	StaticBakeResourceProvider,
	StaticBakeResourceRequest,
	StaticBakeJobResources,
} from "../contracts";

export function createEmptyStaticBakeJobResources(): StaticBakeJobResources {
	return {
		envCellCellStructureGeometry: [],
		staticObjectSourceGeometry: [],
	};
}

function mergeStaticBakeJobResources(
	resources: readonly StaticBakeJobResources[],
): StaticBakeJobResources {
	return {
		envCellCellStructureGeometry: resources.flatMap(
			(resource) => resource.envCellCellStructureGeometry,
		),
		staticObjectSourceGeometry: resources.flatMap(
			(resource) => resource.staticObjectSourceGeometry,
		),
	};
}

export class CompositeStaticBakeResourceProvider implements StaticBakeResourceProvider {
	readonly #providers: readonly StaticBakeResourceProvider[];

	constructor(providers: readonly StaticBakeResourceProvider[]) {
		this.#providers = providers;
	}

	async createResources(
		request: StaticBakeResourceRequest,
	): Promise<StaticBakeJobResources> {
		return mergeStaticBakeJobResources(
			await Promise.all(
				this.#providers.map((provider) => provider.createResources(request)),
			),
		);
	}
}
