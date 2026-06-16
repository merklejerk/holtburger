import type { GfxObjPayloadDto } from "../../../../lib/host/contracts";
import type { PreparedAssetReader } from "../../../assets/contracts";
import { createHostAssetKey, describeHostAssetKey } from "../../../assets/keys";
import type {
	StaticBakeAttachmentProvider,
	StaticBakeAttachmentRequest,
	StaticBakeBatchAttachments,
	StaticObjectSourceGeometryIdentity,
} from "../../contracts";
import { createEmptyStaticBakeAttachments } from "../../bake/attachments";
import {
	createStaticObjectSourceGeometryAttachment,
	describeStaticObjectSourceGeometryIdentity,
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
			request.domain !== "outdoor-detail" &&
			request.domain !== "landblock-env-cells"
		) {
			return createEmptyStaticBakeAttachments();
		}

		const identities = collectStaticObjectGeometryIdentities(request);
		const staticObjectSourceGeometry = await Promise.all(
			identities.map(async (identity) => {
				if (identity.gfxObj.sourceAssetKind !== "gfx-obj") {
					throw new Error(
						`Static object geometry attachment ${describeStaticObjectSourceGeometryIdentity(
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

function collectStaticObjectGeometryIdentities(
	request: StaticBakeAttachmentRequest,
): readonly StaticObjectSourceGeometryIdentity[] {
	const byKey = new Map<string, StaticObjectSourceGeometryIdentity>();

	for (const item of request.items) {
		if (
			item.payload.scope.kind !== "outdoor-static-objects" &&
			item.payload.scope.kind !== "landblock-env-cells"
		) {
			continue;
		}

		for (const source of item.payload.scope.sourceAssets) {
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
	key: Parameters<typeof describeHostAssetKey>[0],
): GfxObjPayloadDto {
	if (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "gfx-obj"
	) {
		return payload as GfxObjPayloadDto;
	}

	throw new Error(
		`Static object geometry attachment expected ${describeHostAssetKey(
			key,
		)} to resolve to a gfx-obj payload.`,
	);
}
