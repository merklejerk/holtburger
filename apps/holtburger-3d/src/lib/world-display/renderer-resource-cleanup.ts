import type {
	RendererResourceGraph,
	RendererResourceGraphDisposalCandidate,
	RendererResourceGraphNodeKind,
} from "./renderer-resource-graph";

export interface RendererResourceCleanupOwner {
	disposeRendererResourceNode(
		candidate: RendererResourceGraphDisposalCandidate,
	): void;
}

export interface RendererResourceCleanupCoordinatorOptions {
	graph: RendererResourceGraph;
	ownersByNodeKind?: Partial<
		Record<RendererResourceGraphNodeKind, RendererResourceCleanupOwner>
	>;
}

export interface RendererResourceCleanupFlushResult {
	deletedNodeKeys: string[];
	pendingNodeKeys: string[];
}

export class RendererResourceCleanupCoordinator {
	private cleanupDirty = false;

	constructor(
		private readonly options: RendererResourceCleanupCoordinatorOptions,
	) {}

	markDirty(): void {
		this.cleanupDirty = true;
	}

	flush(): RendererResourceCleanupFlushResult {
		if (!this.cleanupDirty) {
			return { deletedNodeKeys: [], pendingNodeKeys: [] };
		}

		const deletedNodeKeys: string[] = [];
		const disposedNodeKeys = new Set<string>();
		let progressed = true;

		while (progressed) {
			progressed = false;
			for (const candidate of this.options.graph.disposalCandidates()) {
				if (disposedNodeKeys.has(candidate.nodeKey)) {
					continue;
				}
				if (candidate.dependentKeys.length > 0) {
					continue;
				}

				this.disposeConcreteResource(candidate);
				this.options.graph.deleteDerivedNode(candidate.nodeKey);
				disposedNodeKeys.add(candidate.nodeKey);
				deletedNodeKeys.push(candidate.nodeKey);
				progressed = true;
			}
		}

		const pendingNodeKeys = this.options.graph
			.disposalCandidates()
			.map((candidate) => candidate.nodeKey);
		this.cleanupDirty = pendingNodeKeys.length > 0;

		return {
			deletedNodeKeys: deletedNodeKeys.sort((left, right) =>
				left.localeCompare(right),
			),
			pendingNodeKeys,
		};
	}

	private disposeConcreteResource(
		candidate: RendererResourceGraphDisposalCandidate,
	): void {
		this.options.ownersByNodeKind?.[
			candidate.kind
		]?.disposeRendererResourceNode(candidate);
	}
}
