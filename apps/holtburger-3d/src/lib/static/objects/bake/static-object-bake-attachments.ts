import type { GfxObjPayloadDto } from "../../../../lib/host/contracts";
import type { PreparedAssetReader } from "../../../assets/contracts";
import { createHostAssetKey, describeHostAssetKey } from "../../../assets/keys";
import {
	requirePreparedGfxObjPayload,
	type PreparedGfxObjPayloadDto,
} from "../../../assets/preparation/prepared-render-geometry";
import type {
	StaticBakeAttachmentProvider,
	StaticBakeAttachmentRequest,
	StaticBakeBatchAttachments,
	StaticObjectCanonicalGeometryIdentity,
} from "../../contracts";
import { createEmptyStaticBakeAttachments } from "../../bake/attachments";
import {
	createStaticObjectSourceGeometryAttachment,
	describeStaticObjectCanonicalGeometryIdentity,
	getStaticObjectCanonicalGeometryIdentity,
} from "../static-object-source-assets";

export class StaticObjectBakeAttachmentProvider implements StaticBakeAttachmentProvider {
	readonly #assetReader: PreparedAssetReader;

	constructor(options: { readonly assetReader: PreparedAssetReader }) {
		this.#assetReader = options.assetReader;
	}

	async createAttachments(
		request: StaticBakeAttachmentRequest,
	): Promise<StaticBakeBatchAttachments> {
		if (
			request.domain !== "outdoor-buildings" &&
			request.domain !== "outdoor-explicit-objects" &&
			request.domain !== "outdoor-generated-scenery" &&
			request.domain !== "env-cell-system"
		) {
			return createEmptyStaticBakeAttachments();
		}

		const identities = collectStaticObjectCanonicalGeometryIdentities(request);
		const staticObjectSourceGeometry = await Promise.all(
			identities.map(async (identity) => {
				if (identity.gfxObj.sourceAssetKind !== "gfx-obj") {
					throw new Error(
						`Static object geometry attachment ${describeStaticObjectCanonicalGeometryIdentity(
							identity,
						)} expected gfx-obj source, got ${identity.gfxObj.sourceAssetKind}.`,
					);
				}
				const key = createHostAssetKey("gfx-obj", identity.gfxObj.sourceDid);
				const asset = await this.#assetReader.requestPreparedAsset(key);
				const payload = requireGfxObjPayload(asset.payload, key);

				return createStaticObjectSourceGeometryAttachment({
					gfxObj: payload,
					identity,
				});
			}),
		);

		return {
			...createEmptyStaticBakeAttachments(),
			staticObjectSourceGeometry,
		};
	}
}

function collectStaticObjectCanonicalGeometryIdentities(
	request: StaticBakeAttachmentRequest,
): readonly StaticObjectCanonicalGeometryIdentity[] {
	const byKey = new Map<string, StaticObjectCanonicalGeometryIdentity>();

	for (const item of request.items) {
		if (
			item.payload.scope.kind !== "outdoor-static-objects" &&
			item.payload.scope.kind !== "env-cell-system"
		) {
			continue;
		}

		for (const source of item.payload.scope.sourceAssets) {
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
	key: Parameters<typeof describeHostAssetKey>[0],
): PreparedGfxObjPayloadDto {
	if (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "gfx-obj"
	) {
		return requirePreparedGfxObjPayload(
			payload as GfxObjPayloadDto,
			`Static object geometry attachment ${describeHostAssetKey(
				key,
			)}.renderGeometry`,
		);
	}

	throw new Error(
		`Static object geometry attachment expected ${describeHostAssetKey(
			key,
		)} to resolve to a gfx-obj payload.`,
	);
}
