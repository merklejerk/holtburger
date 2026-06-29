import type {
	LayerOwnerKey,
	StaticResolver,
	StaticResolverJob,
	StaticScopePayload,
} from "./contracts";
import { createLayerOwnerKeyForStaticScope } from "./layer-owners";
import { describeStaticScopeKey } from "./demand-planner";

export interface LayerOwnerTargetedStaticResolverJob {
	readonly job: StaticResolverJob;
	readonly targetOwnerKey: LayerOwnerKey;
}

/**
 * Temporary adapter for the old domain resolver path. Phase 7D replaces this
 * with source-first fanout where source requests directly target layer owners.
 */
export class TemporaryLayerOwnerTargetingResolverAdapter implements StaticResolver {
	readonly #resolver: StaticResolver;
	readonly #listener: ((job: LayerOwnerTargetedStaticResolverJob) => void) | null;

	constructor(options: {
		readonly resolver: StaticResolver;
		readonly listener?: (job: LayerOwnerTargetedStaticResolverJob) => void;
	}) {
		this.#resolver = options.resolver;
		this.#listener = options.listener ?? null;
	}

	resolve(job: StaticResolverJob): Promise<StaticScopePayload> {
		const targetedJob = createLayerOwnerTargetedStaticResolverJob(job);
		this.#listener?.(targetedJob);
		return this.#resolver.resolve(job);
	}

	dispose(): void {
		(this.#resolver as { dispose?: () => void }).dispose?.();
	}
}

export function createLayerOwnerTargetedStaticResolverJob(
	job: StaticResolverJob,
): LayerOwnerTargetedStaticResolverJob {
	return {
		job,
		targetOwnerKey: createLayerOwnerKeyForStaticScope({
			domain: job.domain,
			scope: job.scope,
			scopeKey: describeStaticScopeKey(job.scope),
		}),
	};
}
