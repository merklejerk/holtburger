/** Shared envelope carried by replacement scene commits. */
interface OpenWorldStreamingSceneCommitEnvelope {
	readonly currentnessToken: string;
	readonly emittedAtMs: number;
	readonly ownerId: string;
}

/** Phase 1 scene commit contract; concrete domain payloads arrive in later phases. */
export interface OpenWorldStreamingSceneCommit {
	readonly envelope: OpenWorldStreamingSceneCommitEnvelope;
	readonly kind:
		| "terrain-layer-commit"
		| "outdoor-buildings-layer-commit"
		| "outdoor-explicit-objects-layer-commit"
		| "outdoor-generated-scenery-layer-commit"
		| "env-cell-system-layer-commit"
		| "static-authored-dynamic-resource-commit"
		| "runtime-authored-dynamic-resource-commit"
		| "dynamic-instance-commit";
}

export function describeOpenWorldStreamingSceneCommit(
	commit: OpenWorldStreamingSceneCommit,
): string {
	return `${commit.kind}:${commit.envelope.ownerId}`;
}
