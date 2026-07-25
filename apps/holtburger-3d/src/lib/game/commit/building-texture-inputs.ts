import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import type { ResolvedObjectLayerSource } from "../resolution/landblock-layer";
import { planObjectMaterial } from "../resolution/object-material-planner";
import type { TexturePreparationServiceRequest } from "../textures/texture-preparer";
import {
	TextureWrapMode,
	type AssetTextureKey,
	type TexturePurpose,
	texturePurposePolicy,
} from "../textures/types";
import type { BuildingTexturePackInput } from "./building-texture-worker";

interface TextureDependency {
	readonly key: AssetTextureKey;
	readonly purpose: TexturePurpose;
	readonly request: TexturePreparationServiceRequest;
}

/** Collect exactly the logical pixel dependencies used by static object triangles. */
export function collectBuildingTextureDependencies(
	source: ResolvedObjectLayerSource,
): readonly TextureDependency[] {
	const dependencies = new Map<AssetTextureKey, TextureDependency>();
	for (const resident of source.staticResidents) {
		for (const part of resident.presentation.parts) {
			for (const [triangle, slot] of part.geometry.materialSlotIndices.entries()) {
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
	return [...dependencies.values()].sort((left, right) => left.key.localeCompare(right.key));
}

/** Load every pixel byte before dispatching the texture worker. */
export async function prepareBuildingTextureInputs(
	pixelSource: TexturePixelSource,
	source: ResolvedObjectLayerSource,
): Promise<readonly BuildingTexturePackInput[]> {
	const dependencies = collectBuildingTextureDependencies(source);
	return Promise.all(
		dependencies.map(async (dependency) => {
			const response = await pixelSource.loadTexturePixels(dependency.request);
			if (
				response.kind !== dependency.request.kind ||
				response.purpose !== dependency.purpose ||
				response.surface.sourceAssetId !== dependency.request.sourceAssetId ||
				response.surface.format !== texturePurposePolicy(dependency.purpose).format
			) {
				throw new Error(`Host returned an incompatible building texture for ${dependency.key}.`);
			}
			return {
				height: response.surface.height,
				key: dependency.key,
				pixels: response.surface.pixels,
				purpose: dependency.purpose,
				width: response.surface.width,
			};
		}),
	);
}

function addDependency(
	target: Map<AssetTextureKey, TextureDependency>,
	key: AssetTextureKey | null,
	requests: readonly TexturePreparationServiceRequest[],
): void {
	if (key === null) return;
	const request = requests.find((candidate) => requestMatchesKey(candidate, key));
	if (!request) throw new Error(`Material plan lacks a pixel request for ${key}.`);
	const existing = target.get(key);
	if (existing) {
		if (
			existing.purpose !== request.purpose ||
			existing.request.kind !== request.kind ||
			existing.request.sourceAssetId !== request.sourceAssetId
		) {
			throw new Error(`Logical texture ${key} has incompatible closed pixel requests.`);
		}
		return;
	}
	target.set(key, { key, purpose: request.purpose, request });
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
