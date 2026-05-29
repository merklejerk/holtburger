export type RendererResourceGraphNodeKind =
	| "prepared-asset"
	| "scene-object"
	| "material-decision"
	| "atlas-generation"
	| "static-batch";

export interface RendererResourceGraphNode {
	key: string;
	kind: RendererResourceGraphNodeKind;
	label?: string | null;
	metadata?: Readonly<Record<string, string | number | boolean | null>>;
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

export interface RendererResourceGraphDisposalCandidate {
	nodeKey: string;
	kind: RendererResourceGraphNodeKind;
	label: string | null;
	dependencyKeys: string[];
	dependentKeys: string[];
}

export interface RendererResourceGraphRetentionPath {
	owner: string;
	leaseId: string;
	path: string[];
}

export interface RendererResourceGraphRetentionExplanation {
	targetKey: string;
	retained: boolean;
	paths: RendererResourceGraphRetentionPath[];
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

	replaceDependencies(nodeKey: string, dependencyKeys: readonly string[]): void {
		const nextState = cloneState(this.state);
		replaceDependencies(nextState, nodeKey, dependencyKeys);
		this.state = nextState;
	}

	applyBatchUpdate(update: RendererResourceGraphBatchUpdate): void {
		const nextState = cloneState(this.state);
		for (const node of update.nodes ?? []) {
			upsertNode(nextState, node);
		}
		for (const replacement of update.dependencyReplacements ?? []) {
			replaceDependenciesWithoutCycleCheck(
				nextState,
				replacement.nodeKey,
				replacement.dependencyKeys,
			);
		}
		assertAcyclic(nextState);
		this.state = nextState;
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
		return sortedPreparedAssetIdsForKeys(reachableNodeKeysFromLeases(this.state));
	}

	disposalCandidates(): RendererResourceGraphDisposalCandidate[] {
		const reachable = reachableNodeKeysFromLeases(this.state);
		const candidates: RendererResourceGraphDisposalCandidate[] = [];
		for (const [nodeKey, node] of this.state.nodes) {
			if (node.kind === "prepared-asset" || reachable.has(nodeKey)) {
				continue;
			}
			candidates.push({
				nodeKey,
				kind: node.kind,
				label: node.label ?? null,
				dependencyKeys: sortedStrings([
					...(this.state.dependenciesByNodeKey.get(nodeKey) ?? []),
				]),
				dependentKeys: sortedStrings(findDependentKeys(this.state, nodeKey)),
			});
		}
		return candidates.sort((left, right) =>
			left.nodeKey.localeCompare(right.nodeKey),
		);
	}

	deleteDerivedNode(nodeKey: string): void {
		const nextState = cloneState(this.state);
		deleteNode(nextState, nodeKey, "derived");
		this.state = nextState;
	}

	deleteUnreferencedPreparedAssetNode(nodeKeyOrAssetId: string): void {
		const nodeKey = canonicalPreparedAssetDeletionKey(
			this.state,
			nodeKeyOrAssetId,
		);
		const nextState = cloneState(this.state);
		deleteNode(nextState, nodeKey, "prepared-asset");
		this.state = nextState;
	}

	explainRetention(nodeKeyOrPreparedAssetId: string): RendererResourceGraphRetentionExplanation {
		const targetKey = canonicalExplanationTargetKey(
			this.state,
			nodeKeyOrPreparedAssetId,
		);
		const paths: RendererResourceGraphRetentionPath[] = [];
		for (const lease of sortedLeases(this.state.leasesById.values())) {
			const path = findDependencyPath(this.state, lease.nodeKey, targetKey);
			if (path) {
				paths.push({
					owner: lease.owner,
					leaseId: lease.id,
					path,
				});
			}
		}
		return {
			targetKey,
			retained: paths.length > 0,
			paths: paths.sort(compareRetentionPaths),
		};
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
		nodes: new Map(
			[...state.nodes].map(([key, node]) => [key, { ...node }]),
		),
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
		label: node.label ?? null,
		metadata: node.metadata ? { ...node.metadata } : undefined,
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

function deleteNode(
	state: GraphState,
	nodeKey: string,
	mode: "derived" | "prepared-asset",
): void {
	assertKnownNode(state, nodeKey);
	const node = state.nodes.get(nodeKey);
	if (!node) {
		throw new Error(`Renderer resource graph node is unknown: ${nodeKey}`);
	}
	if (mode === "derived" && node.kind === "prepared-asset") {
		throw new Error(
			`Renderer resource graph prepared asset node requires explicit prepared cleanup: ${nodeKey}`,
		);
	}
	if (mode === "prepared-asset" && node.kind !== "prepared-asset") {
		throw new Error(
			`Renderer resource graph node is not a prepared asset: ${nodeKey}`,
		);
	}
	assertNodeCanBeDeleted(state, nodeKey);
	state.nodes.delete(nodeKey);
	state.dependenciesByNodeKey.delete(nodeKey);
}

function assertNodeCanBeDeleted(state: GraphState, nodeKey: string): void {
	const retention = findRetentionPaths(state, nodeKey);
	if (retention.length > 0) {
		throw new Error(
			`Renderer resource graph node is still retained and cannot be deleted: ${nodeKey}`,
		);
	}
	const dependentKeys = findDependentKeys(state, nodeKey);
	if (dependentKeys.length > 0) {
		throw new Error(
			`Renderer resource graph node still has dependents and cannot be deleted: ${nodeKey} <- ${dependentKeys.join(", ")}`,
		);
	}
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
		for (const dependencyKey of sortedStrings([
			...(state.dependenciesByNodeKey.get(nodeKey) ?? []),
		])) {
			visit(dependencyKey, [...path, nodeKey]);
		}
		visiting.delete(nodeKey);
		visited.add(nodeKey);
	};

	for (const nodeKey of sortedStrings([...state.nodes.keys()])) {
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

function sortedPreparedAssetIdsForKeys(nodeKeys: ReadonlySet<string>): string[] {
	return [...nodeKeys]
		.filter((nodeKey) => nodeKey.startsWith("prepared-asset/"))
		.map((nodeKey) => nodeKey.slice("prepared-asset/".length))
		.sort();
}

function findDependentKeys(state: GraphState, targetKey: string): string[] {
	const dependentKeys: string[] = [];
	for (const [nodeKey, dependencies] of state.dependenciesByNodeKey) {
		if (dependencies.has(targetKey)) {
			dependentKeys.push(nodeKey);
		}
	}
	return dependentKeys;
}

function canonicalExplanationTargetKey(
	state: GraphState,
	nodeKeyOrPreparedAssetId: string,
): string {
	if (state.nodes.has(nodeKeyOrPreparedAssetId)) {
		return nodeKeyOrPreparedAssetId;
	}
	const preparedNodeKey = preparedAssetGraphNodeKey(nodeKeyOrPreparedAssetId);
	if (state.nodes.has(preparedNodeKey)) {
		return preparedNodeKey;
	}
	return nodeKeyOrPreparedAssetId;
}

function canonicalPreparedAssetDeletionKey(
	state: GraphState,
	nodeKeyOrAssetId: string,
): string {
	if (state.nodes.get(nodeKeyOrAssetId)?.kind === "prepared-asset") {
		return nodeKeyOrAssetId;
	}
	return preparedAssetGraphNodeKey(nodeKeyOrAssetId);
}

function findDependencyPath(
	state: GraphState,
	startKey: string,
	targetKey: string,
): string[] | null {
	const visit = (
		nodeKey: string,
		path: readonly string[],
		visited: ReadonlySet<string>,
	): string[] | null => {
		if (nodeKey === targetKey) {
			return [...path, nodeKey];
		}
		if (visited.has(nodeKey)) {
			return null;
		}
		const nextVisited = new Set(visited);
		nextVisited.add(nodeKey);
		for (const dependencyKey of sortedStrings([
			...(state.dependenciesByNodeKey.get(nodeKey) ?? []),
		])) {
			const result = visit(dependencyKey, [...path, nodeKey], nextVisited);
			if (result) {
				return result;
			}
		}
		return null;
	};
	return visit(startKey, [], new Set());
}

function findRetentionPaths(
	state: GraphState,
	targetKey: string,
): RendererResourceGraphRetentionPath[] {
	const paths: RendererResourceGraphRetentionPath[] = [];
	for (const lease of sortedLeases(state.leasesById.values())) {
		const path = findDependencyPath(state, lease.nodeKey, targetKey);
		if (path) {
			paths.push({
				owner: lease.owner,
				leaseId: lease.id,
				path,
			});
		}
	}
	return paths.sort(compareRetentionPaths);
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

function compareRetentionPaths(
	left: RendererResourceGraphRetentionPath,
	right: RendererResourceGraphRetentionPath,
): number {
	const owner = left.owner.localeCompare(right.owner);
	if (owner !== 0) {
		return owner;
	}
	const path = left.path.join("\0").localeCompare(right.path.join("\0"));
	if (path !== 0) {
		return path;
	}
	return left.leaseId.localeCompare(right.leaseId);
}

function sortedStrings(values: readonly string[]): string[] {
	return [...values].sort((left, right) => left.localeCompare(right));
}
