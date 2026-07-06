/** Replacement-native diagnostics for owner-indexed open-world streaming. */
export interface OpenWorldStreamingDiagnosticsSnapshot {
	readonly kind: "open-world-streaming-diagnostics";
	readonly pipeline: {
		readonly status: "idle" | "active" | "disposed";
		readonly selectedRuntimePipeline: "open-world-streaming";
	};
	readonly owners: {
		readonly current: number;
		readonly evicted: number;
	};
	readonly artifacts: {
		readonly inFlight: number;
		readonly ready: number;
		readonly staleRejected: number;
	};
	readonly textureResidency: {
		readonly bucketCount: number;
		readonly claimCount: number;
		readonly pageBuildsInFlight: number;
	};
	readonly sceneCommits: {
		readonly pending: number;
		readonly applied: number;
	};
	readonly frameBudget: {
		readonly yieldedPasses: number;
	};
	readonly compatibilityShims: readonly OpenWorldStreamingShimDiagnostics[];
}

/** Deletion-targeted compatibility projection outside replacement internals. */
interface OpenWorldStreamingShimDiagnostics {
	readonly deletionTarget: string;
	readonly kind: "compatibility-shim";
	readonly owner: "browser-runtime-adapter" | "browser-harness" | "ui";
	readonly reason: string;
}

/** Replacement-native atlas/page inspection contract. */
export interface OpenWorldStreamingAtlasInspectionSnapshot {
	readonly kind: "open-world-streaming-atlas-page";
	readonly bucketKey: string;
	readonly pageId: string;
	readonly state:
		| "resident"
		| "planned"
		| "building"
		| "reclaimable"
		| "missing";
	readonly claims: readonly {
		readonly ownerId: string;
		readonly textureBindingId: string;
	}[];
}
