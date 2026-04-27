import type { AssetChannelState } from "../assets/types";
import type { HostBoundarySnapshot } from "../host/contracts";

export interface VerticalSliceReport {
	headline: string;
	runtimeSummary: string;
	assetSummary: string;
	observedFlows: string[];
	awkwardSeams: string[];
}

export function deriveVerticalSliceReport(
	snapshot: HostBoundarySnapshot | null,
	assetState: AssetChannelState,
): VerticalSliceReport {
	const preparedBootstrap = assetState.preparedByPriority.bootstrap;
	const preparedStreaming = assetState.preparedByPriority.streaming;

	const headline = snapshot
		? `Browser vertical slice is ${snapshot.source === "tauri" ? "running against the live host" : "running in browser preview"}.`
		: "Browser vertical slice is waiting for the first host snapshot.";

	const runtimeSummary = snapshot
		? `Tick ${snapshot.runtimeBatch.tick} with ${snapshot.runtimeBatch.entities.length} runtime entities at ${snapshot.runtimeBatch.residency.focusLocationLabel}.`
		: "No runtime snapshot has been loaded yet.";

	const assetSummary = preparedStreaming
		? `Observed bootstrap plus streaming asset preparation on the ${assetState.channel} channel.`
		: preparedBootstrap
			? `Observed bootstrap asset preparation on the ${assetState.channel} channel; streaming refresh is still pending.`
			: `No prepared asset has completed on the ${assetState.channel} channel yet.`;

	const observedFlows = [
		snapshot
			? `Lifecycle and runtime routing booted from the ${snapshot.source} snapshot.`
			: "Lifecycle and runtime routing are waiting for the first snapshot.",
		preparedBootstrap
			? `Bootstrap asset: ${preparedBootstrap.request.assetId}.`
			: "Bootstrap asset preparation has not completed yet.",
		preparedStreaming
			? `Streaming asset: ${preparedStreaming.request.assetId}.`
			: "Streaming asset preparation has not completed yet.",
	];

	const awkwardSeams = [
		"Asset payloads are still typed visual-asset stubs with debug primitives and palette keys; real DAT/HBA models, textures, animations, and terrain payload families are still deferred.",
		"The frontend currently keeps an activity log plus one live prepared-asset record, not a real scene-wide asset cache with eviction or invalidation policy.",
		"WorldDisplay now owns an explicit outdoor landblock-ring scene context, but the first terrain payload and indoor env-cell / visible-cell scene membership are still deferred.",
	];

	if (snapshot?.source === "browser-preview") {
		awkwardSeams.unshift(
			"Browser preview preserves the contract shapes, but only a Tauri run exercises the real host runtime, IPC timing, and native window lifecycle.",
		);
	}

	return {
		headline,
		runtimeSummary,
		assetSummary,
		observedFlows,
		awkwardSeams,
	};
}
