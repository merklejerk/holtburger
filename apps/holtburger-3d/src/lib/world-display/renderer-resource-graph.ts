export type RendererResourceGraphNodeKind =
	| "prepared-asset"
	| "scene-object"
	| "material-decision"
	| "atlas-generation"
	| "static-batch";

export interface RendererResourceGraphNode {
	key: string;
	kind: RendererResourceGraphNodeKind;
}

export interface RendererResourceGraphDependencyReplacement {
	nodeKey: string;
	dependencyKeys: readonly string[];
}

export interface RendererResourceGraphBatchUpdate {
	nodes?: readonly RendererResourceGraphNode[];
	dependencyReplacements?: readonly RendererResourceGraphDependencyReplacement[];
}

export interface RendererResourceGraphLease {
	id: string;
	nodeKey: string;
	owner: string;
}

interface GraphState {
	nodes: Map<string, RendererResourceGraphNode>;
	dependenciesByNodeKey: Map<string, Set<string>>;
	leasesById: Map<string, RendererResourceGraphLease>;
	nextLeaseId: number;
}

export class RendererResourceGraph {
	private state: GraphState = createEmptyState();

	upsertNode(node: RendererResourceGraphNode): void {
		upsertNode(this.state, node);
	}

	replaceDependencies(
		nodeKey: string,
		dependencyKeys: readonly string[],
	): void {
		const nextState = cloneState(this.state);
		replaceDependencies(nextState, nodeKey, dependencyKeys);
		this.state = nextState;
	}

	applyBatchUpdate(update: RendererResourceGraphBatchUpdate): void {
		for (const node of update.nodes ?? []) {
			upsertNode(this.state, node);
		}
		for (const replacement of update.dependencyReplacements ?? []) {
			replaceDependenciesWithoutCycleCheck(
				this.state,
				replacement.nodeKey,
				replacement.dependencyKeys,
			);
		}
		assertAcyclic(this.state);
	}

	leaseNode(nodeKey: string, owner: string): RendererResourceGraphLease {
		const lease = leaseNode(this.state, nodeKey, owner);
		return { ...lease };
	}

	releaseLease(lease: RendererResourceGraphLease | string): void {
		const leaseId = typeof lease === "string" ? lease : lease.id;
		if (!this.state.leasesById.delete(leaseId)) {
			throw new Error(`Renderer resource graph lease is unknown: ${leaseId}`);
		}
	}

	transaction<T>(fn: (graph: RendererResourceGraph) => T): T {
		const draft = new RendererResourceGraph();
		draft.state = cloneState(this.state);
		const result = fn(draft);
		draft.validateAcyclic();
		this.state = draft.state;
		return result;
	}

	retainedPreparedAssetIds(): string[] {
		return sortedPreparedAssetIdsForKeys(
			reachableNodeKeysFromLeases(this.state),
		);
	}

	hasNode(nodeKey: string): boolean {
		return this.state.nodes.has(nodeKey);
	}

	private validateAcyclic(): void {
		assertAcyclic(this.state);
	}
}

export function preparedAssetGraphNodeKey(assetId: string): string {
	return `prepared-asset/${assetId}`;
}

export function sceneObjectGraphNodeKey(key: string): string {
	return `scene-object/${key}`;
}

export function materialDecisionGraphNodeKey(key: string): string {
	return `material-decision/${key}`;
}

export function atlasGenerationGraphNodeKey(key: string): string {
	return `atlas-generation/${key}`;
}

export function staticBatchGraphNodeKey(key: string): string {
	return `static-batch/${key}`;
}

function createEmptyState(): GraphState {
	return {
		nodes: new Map(),
		dependenciesByNodeKey: new Map(),
		leasesById: new Map(),
		nextLeaseId: 1,
	};
}

function cloneState(state: GraphState): GraphState {
	return {
		nodes: new Map([...state.nodes].map(([key, node]) => [key, { ...node }])),
		dependenciesByNodeKey: new Map(
			[...state.dependenciesByNodeKey].map(([key, dependencies]) => [
				key,
				new Set(dependencies),
			]),
		),
		leasesById: new Map(
			[...state.leasesById].map(([key, lease]) => [key, { ...lease }]),
		),
		nextLeaseId: state.nextLeaseId,
	};
}

function upsertNode(state: GraphState, node: RendererResourceGraphNode): void {
	const existing = state.nodes.get(node.key);
	if (existing && existing.kind !== node.kind) {
		throw new Error(
			`Renderer resource graph node kind mismatch for ${node.key}: ${existing.kind} !== ${node.kind}`,
		);
	}
	state.nodes.set(node.key, {
		...node,
	});
	if (!state.dependenciesByNodeKey.has(node.key)) {
		state.dependenciesByNodeKey.set(node.key, new Set());
	}
}

function replaceDependencies(
	state: GraphState,
	nodeKey: string,
	dependencyKeys: readonly string[],
): void {
	replaceDependenciesWithoutCycleCheck(state, nodeKey, dependencyKeys);
	assertAcyclic(state);
}

function replaceDependenciesWithoutCycleCheck(
	state: GraphState,
	nodeKey: string,
	dependencyKeys: readonly string[],
): void {
	assertKnownNode(state, nodeKey);
	const dependencies = new Set(dependencyKeys);
	for (const dependencyKey of dependencies) {
		assertKnownNode(state, dependencyKey);
	}
	state.dependenciesByNodeKey.set(nodeKey, dependencies);
}

function leaseNode(
	state: GraphState,
	nodeKey: string,
	owner: string,
): RendererResourceGraphLease {
	assertKnownNode(state, nodeKey);
	if (owner.trim().length === 0) {
		throw new Error("Renderer resource graph lease owner must be non-empty.");
	}
	const lease: RendererResourceGraphLease = {
		id: `lease-${state.nextLeaseId}`,
		nodeKey,
		owner,
	};
	if (state.leasesById.has(lease.id)) {
		throw new Error(`Renderer resource graph duplicate lease id: ${lease.id}`);
	}
	state.nextLeaseId += 1;
	state.leasesById.set(lease.id, lease);
	return lease;
}

function assertKnownNode(state: GraphState, nodeKey: string): void {
	if (!state.nodes.has(nodeKey)) {
		throw new Error(`Renderer resource graph node is unknown: ${nodeKey}`);
	}
}

function assertAcyclic(state: GraphState): void {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const visit = (nodeKey: string, path: readonly string[]): void => {
		if (visited.has(nodeKey)) {
			return;
		}
		if (visiting.has(nodeKey)) {
			throw new Error(
				`Renderer resource graph cycle detected: ${[...path, nodeKey].join(" -> ")}`,
			);
		}
		visiting.add(nodeKey);
		for (const dependencyKey of state.dependenciesByNodeKey.get(nodeKey) ??
			[]) {
			visit(dependencyKey, [...path, nodeKey]);
		}
		visiting.delete(nodeKey);
		visited.add(nodeKey);
	};

	for (const nodeKey of state.nodes.keys()) {
		visit(nodeKey, []);
	}
}

function reachableNodeKeysFromLeases(state: GraphState): Set<string> {
	const reachable = new Set<string>();
	const pending = sortedLeases(state.leasesById.values()).map(
		(lease) => lease.nodeKey,
	);
	while (pending.length > 0) {
		const nodeKey = pending.shift();
		if (!nodeKey || reachable.has(nodeKey)) {
			continue;
		}
		reachable.add(nodeKey);
		pending.push(
			...sortedStrings([...(state.dependenciesByNodeKey.get(nodeKey) ?? [])]),
		);
	}
	return reachable;
}

function sortedPreparedAssetIdsForKeys(
	nodeKeys: ReadonlySet<string>,
): string[] {
	return [...nodeKeys]
		.filter((nodeKey) => nodeKey.startsWith("prepared-asset/"))
		.map((nodeKey) => nodeKey.slice("prepared-asset/".length))
		.sort();
}

function sortedLeases(
	leases: Iterable<RendererResourceGraphLease>,
): RendererResourceGraphLease[] {
	return [...leases].sort((left, right) => {
		const owner = left.owner.localeCompare(right.owner);
		if (owner !== 0) {
			return owner;
		}
		return left.id.localeCompare(right.id);
	});
}

function sortedStrings(values: readonly string[]): string[] {
	return [...values].sort((left, right) => left.localeCompare(right));
}
