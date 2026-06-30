import type { HostAssetKey, PreparedAssetReader } from "../assets/contracts";
import { createHostAssetKey, describeHostAssetKey } from "../assets/keys";
import {
	requirePreparedGfxObjPayload,
	type PreparedGfxObjPayloadDto,
} from "../assets/preparation/prepared-render-geometry";
import type { GfxObjPayloadDto } from "../host/contracts";
import type { DynamicEntityRecipe, DynamicVisualBakeInput } from "./contracts";
import type { StaticObjectSourceGeometryIdentity } from "../static/contracts";
import {
	createStaticObjectSourceGeometryAttachment,
	describeStaticObjectSourceGeometryIdentity,
} from "../static/objects/static-object-source-assets";

export async function createDynamicVisualBakeSourceGeometry(
	assetReader: PreparedAssetReader,
	recipes: readonly DynamicEntityRecipe[],
): Promise<DynamicVisualBakeInput["sourceGeometry"]> {
	const identities = collectDynamicVisualGeometryIdentities(recipes);
	return Promise.all(
		identities.map(async (identity) => {
			if (identity.gfxObj.sourceAssetKind !== "gfx-obj") {
				throw new Error(
					`Dynamic visual geometry attachment ${describeStaticObjectSourceGeometryIdentity(
						identity,
					)} expected gfx-obj source, got ${identity.gfxObj.sourceAssetKind}.`,
				);
			}
			const key = createHostAssetKey("gfx-obj", identity.gfxObj.sourceDid);
			const asset = await assetReader.requestPreparedAsset(key);
			const payload = requireGfxObjPayload(asset.payload, key);

			return createStaticObjectSourceGeometryAttachment({
				gfxObj: payload,
				identity,
			});
		}),
	);
}

function collectDynamicVisualGeometryIdentities(
	recipes: readonly DynamicEntityRecipe[],
): readonly StaticObjectSourceGeometryIdentity[] {
	const byKey = new Map<string, StaticObjectSourceGeometryIdentity>();

	for (const recipe of recipes) {
		for (const source of recipe.visual.sourceAssets) {
			for (const part of source.parts) {
				byKey.set(
					describeStaticObjectSourceGeometryIdentity(part.geometry),
					part.geometry,
				);
			}
		}
	}

	return [...byKey.values()].sort((left, right) =>
		describeStaticObjectSourceGeometryIdentity(left).localeCompare(
			describeStaticObjectSourceGeometryIdentity(right),
		),
	);
}

function requireGfxObjPayload(
	payload: unknown,
	key: HostAssetKey,
): PreparedGfxObjPayloadDto {
	if (
		typeof payload !== "object" ||
		payload === null ||
		!("kind" in payload) ||
		payload.kind !== "gfx-obj"
	) {
		throw new Error(
			`Dynamic visual geometry attachment expected gfx-obj payload for ${describeHostAssetKey(
				key,
			)}.`,
		);
	}
	return requirePreparedGfxObjPayload(
		payload as GfxObjPayloadDto,
		`Dynamic visual geometry attachment ${describeHostAssetKey(
			key,
		)}.renderGeometry`,
	);
}
