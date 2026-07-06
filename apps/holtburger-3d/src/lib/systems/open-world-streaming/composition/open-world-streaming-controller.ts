import type {
	OpenWorldStreamingAtlasInspectionSnapshot,
	OpenWorldStreamingDiagnosticsSnapshot,
} from "../diagnostics/contracts";

export class OpenWorldStreamingController {
	#disposed = false;
	#activeSceneInterest = false;

	updateSceneInterest(active: boolean): void {
		this.#assertUsable();
		this.#activeSceneInterest = active;
	}

	createDiagnosticsSnapshot(): OpenWorldStreamingDiagnosticsSnapshot {
		return {
			artifacts: {
				inFlight: 0,
				ready: 0,
				staleRejected: 0,
			},
			compatibilityShims: [
				{
					deletionTarget: "Phase 14 browser runtime cutover",
					kind: "compatibility-shim",
					owner: "browser-runtime-adapter",
					reason:
						"ClientRuntime still requires legacy-shaped overview and diagnostics snapshots.",
				},
			],
			frameBudget: {
				yieldedPasses: 0,
			},
			kind: "open-world-streaming-diagnostics",
			owners: {
				current: this.#activeSceneInterest ? 1 : 0,
				evicted: 0,
			},
			pipeline: {
				selectedRuntimePipeline: "open-world-streaming",
				status: this.#disposed
					? "disposed"
					: this.#activeSceneInterest
						? "active"
						: "idle",
			},
			sceneCommits: {
				applied: 0,
				pending: 0,
			},
			textureResidency: {
				bucketCount: 0,
				claimCount: 0,
				pageBuildsInFlight: 0,
			},
		};
	}

	createAtlasInspectionSnapshot(input: {
		readonly bucketKey: string;
		readonly pageId: string;
	}): OpenWorldStreamingAtlasInspectionSnapshot {
		return {
			bucketKey: input.bucketKey,
			claims: [],
			kind: "open-world-streaming-atlas-page",
			pageId: input.pageId,
			state: "missing",
		};
	}

	dispose(): void {
		this.#disposed = true;
	}

	#assertUsable(): void {
		if (this.#disposed) {
			throw new Error("Open world streaming controller has been disposed.");
		}
	}
}
