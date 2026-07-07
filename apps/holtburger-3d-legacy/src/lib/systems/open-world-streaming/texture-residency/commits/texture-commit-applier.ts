import type { TexturePlacementUpdate } from "../../../../renderer/types";
import type {
	OpenWorldStreamingTextureBindingResolution,
	OpenWorldStreamingTextureCommit,
} from "./contracts";

export interface OpenWorldStreamingTextureRendererPort {
	applyTexturePlacementUpdate(update: TexturePlacementUpdate): void;
}

export function applyOpenWorldStreamingTextureCommit(
	renderer: OpenWorldStreamingTextureRendererPort,
	commit: OpenWorldStreamingTextureCommit,
	options: { readonly revision: number },
): void {
	renderer.applyTexturePlacementUpdate(
		createTexturePlacementUpdate(commit, options.revision),
	);
}

export function createTexturePlacementUpdate(
	commit: OpenWorldStreamingTextureCommit,
	revision: number,
): TexturePlacementUpdate {
	return {
		bindingReadinessUpdates: commit.bindingUpdates.flatMap(
			createTextureBindingReadinessUpdate,
		),
		placements: commit.pageUpdates.map((page) => ({
			anisotropy: page.anisotropy,
			bindingId: page.uploadBindingId,
			filteringMode: page.filteringMode,
			format: page.format,
			height: page.height,
			mipmapsGenerated: page.mipmapsGenerated,
			pageVersion: {
				placementRevision: revision,
				textureRefId: page.textureRefId,
			},
			pixels: page.pixels,
			placementRevision: revision,
			rect: [0, 0, page.width, page.height],
			sampleClass: page.sampleClass,
			samplerPolicyKey: page.samplerPolicyKey,
			textureRefId: page.textureRefId,
			width: page.width,
			wrapS: page.wrapS,
			wrapT: page.wrapT,
		})),
		removedTextureRefIds: commit.pageRemovals.map(
			(removal) => removal.textureRefId,
		),
		resolvedTexturePlacements: commit.bindingUpdates.flatMap((binding) => {
			const readiness = binding.readiness;
			if (readiness.kind !== "resident") {
				return [];
			}
			return [
				{
					bindingId: binding.bindingId,
					pageVersion: {
						placementRevision: revision,
						textureRefId: readiness.textureRefId,
					},
					rect: readiness.rect,
					textureHeight: readiness.textureHeight,
					textureRefId: readiness.textureRefId,
					textureWidth: readiness.textureWidth,
				},
			];
		}),
		revision,
	};
}

function createTextureBindingReadinessUpdate(
	binding: OpenWorldStreamingTextureBindingResolution,
): TexturePlacementUpdate["bindingReadinessUpdates"][number][] {
	const readiness = binding.readiness;
	switch (readiness.kind) {
		case "resident":
			return [];
		case "pending":
			return [
				{
					bindingId: binding.bindingId,
					kind: "pending",
					reason: readiness.reason,
				},
			];
		case "failed":
			return [
				{
					bindingId: binding.bindingId,
					kind: "failed",
					reason: readiness.message,
				},
			];
		case "missing-not-in-flight":
			return [
				{
					bindingId: binding.bindingId,
					kind: "missing-not-in-flight",
					reason: readiness.message,
				},
			];
	}
}
