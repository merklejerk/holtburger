import type { HostAssetKey, PreparedAssetReader } from "../assets/contracts";
import { createHostAssetKey, describeHostAssetKey } from "../assets/keys";
import {
	requirePreparedGfxObjPayload,
	type PreparedGfxObjPayloadDto,
} from "../assets/preparation/prepared-render-geometry";
import type { GfxObjPayloadDto } from "../host/contracts";
import type { DynamicEntityRecipe, DynamicVisualBakeInput } from "./contracts";
import type { StaticObjectCanonicalGeometryIdentity } from "../static/contracts";
import {
	createStaticObjectSourceGeometryAttachment,
	describeStaticObjectCanonicalGeometryIdentity,
	getStaticObjectCanonicalGeometryIdentity,
} from "../static/objects/static-object-source-assets";

export async function createDynamicVisualBakeSourceGeometry(
	assetReader: PreparedAssetReader,
	recipes: readonly DynamicEntityRecipe[],
): Promise<DynamicVisualBakeInput["sourceGeometry"]> {
	const identities = collectDynamicVisualCanonicalGeometryIdentities(recipes);
	return Promise.all(
		identities.map(async (identity) => {
			if (identity.gfxObj.sourceAssetKind !== "gfx-obj") {
				throw new Error(
					`Dynamic visual geometry attachment ${describeStaticObjectCanonicalGeometryIdentity(
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

function collectDynamicVisualCanonicalGeometryIdentities(
	recipes: readonly DynamicEntityRecipe[],
): readonly StaticObjectCanonicalGeometryIdentity[] {
	const byKey = new Map<string, StaticObjectCanonicalGeometryIdentity>();

	for (const recipe of recipes) {
		for (const source of recipe.visual.sourceAssets) {
			for (const part of source.parts) {
				const canonical = getStaticObjectCanonicalGeometryIdentity(
					part.geometry,
				);
				byKey.set(
					describeStaticObjectCanonicalGeometryIdentity(canonical),
					canonical,
				);
			}
		}
	}

	return [...byKey.values()].sort((left, right) =>
		describeStaticObjectCanonicalGeometryIdentity(left).localeCompare(
			describeStaticObjectCanonicalGeometryIdentity(right),
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
