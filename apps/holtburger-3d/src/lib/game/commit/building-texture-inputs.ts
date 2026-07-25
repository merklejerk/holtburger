import type { DatAssetId } from "../game-types";
import type { ResolvedObjectLayerSource } from "../resolution/landblock-layer";
import { planObjectMaterial } from "../resolution/object-material-planner";
import type { TexturePreparationServiceRequest } from "../textures/texture-preparer";
import {
	TextureWrapMode,
	type AssetTextureFact,
	type AssetTextureKey,
	type TexturePurpose,
} from "../textures/types";

/** One complete logical building texture requirement beside its active page-pack input. */
export interface BuildingTextureDependency {
	readonly fact: AssetTextureFact;
	readonly key: AssetTextureKey;
	readonly purpose: TexturePurpose;
	readonly request: TexturePreparationServiceRequest;
}

/** Collect exactly the logical pixel dependencies used by static object triangles. */
export function collectBuildingTextureDependencies(
	source: ResolvedObjectLayerSource,
): readonly BuildingTextureDependency[] {
	const dependencies = new Map<AssetTextureKey, BuildingTextureDependency>();
	for (const resident of source.staticResidents) {
		for (const part of resident.presentation.parts) {
			for (const [
				triangle,
				slot,
			] of part.geometry.materialSlotIndices.entries()) {
				const material = part.materials[slot];
				if (!material) {
					throw new Error(
						`Static resident ${resident.id} part ${part.partIndex} triangle ${triangle} has no material slot ${slot}.`,
					);
				}
				const plan = planObjectMaterial(
					material,
					part.geometry.materialWrapModes[triangle] === 1
						? TextureWrapMode.Repeat
						: TextureWrapMode.Clamp,
				);
				addDependency(dependencies, plan.baseTexture, plan.textureRequests);
				addDependency(dependencies, plan.paletteTexture, plan.textureRequests);
			}
		}
	}
	return [...dependencies.values()].sort((left, right) =>
		left.key.localeCompare(right.key),
	);
}

function addDependency(
	target: Map<AssetTextureKey, BuildingTextureDependency>,
	key: AssetTextureKey | null,
	requests: readonly TexturePreparationServiceRequest[],
): void {
	if (key === null) return;
	const request = requests.find((candidate) =>
		requestMatchesKey(candidate, key),
	);
	if (!request)
		throw new Error(`Material plan lacks a pixel request for ${key}.`);
	const existing = target.get(key);
	if (existing) {
		if (
			existing.fact.sourceAssetId !== sourceAssetIdForKey(key) ||
			existing.purpose !== request.purpose ||
			existing.request.kind !== request.kind ||
			existing.request.sourceAssetId !== request.sourceAssetId
		) {
			throw new Error(
				`Logical texture ${key} has incompatible closed pixel requests.`,
			);
		}
		return;
	}
	target.set(key, {
		fact: {
			kind: "asset",
			key,
			purpose: request.purpose,
			sourceAssetId: sourceAssetIdForKey(key),
		},
		key,
		purpose: request.purpose,
		request,
	});
}

/** Recover the logical DAT identity only after the closed request/key compatibility check. */
function sourceAssetIdForKey(key: AssetTextureKey): DatAssetId {
	const [, , sourceAssetId] = key.split(":", 3);
	if (!sourceAssetId)
		throw new Error(`Texture key ${key} has no source asset identity.`);
	return sourceAssetId;
}

function requestMatchesKey(
	request: TexturePreparationServiceRequest,
	key: AssetTextureKey,
): boolean {
	const [, purpose, sourceAssetId] = key.split(":", 3);
	if (purpose !== request.purpose) return false;
	if (request.kind === "prepared-object-texture") {
		return request.sourceAssetId === `surface-texture/${sourceAssetId}`;
	}
	if (request.kind === "prepared-object-palette") {
		return request.sourceAssetId === `palette/${sourceAssetId}`;
	}
	return false;
}
