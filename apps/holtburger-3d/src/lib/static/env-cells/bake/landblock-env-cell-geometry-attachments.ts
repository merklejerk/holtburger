import type { LandblockEnvCellsPayloadDto } from "../../../../lib/host/contracts";
import type { PreparedAssetReader } from "../../../assets/contracts";
import { createHostAssetKey, describeHostAssetKey } from "../../../assets/keys";
import { createEmptyStaticBakeAttachments } from "../../bake/attachments";
import type {
	EnvCellCellStructureGeometryAttachment,
	EnvCellCellStructureGeometryIdentity,
	LandblockEnvCellStaticFacts,
	StaticBakeAttachmentProvider,
	StaticBakeAttachmentRequest,
	StaticBakeBatchAttachments,
} from "../../contracts";

export class LandblockEnvCellGeometryAttachmentProvider implements StaticBakeAttachmentProvider {
	readonly #assetReader: PreparedAssetReader;

	constructor(options: { readonly assetReader: PreparedAssetReader }) {
		this.#assetReader = options.assetReader;
	}

	async createAttachments(
		request: StaticBakeAttachmentRequest,
	): Promise<StaticBakeBatchAttachments> {
		if (request.domain !== "landblock-env-cells") {
			return createEmptyStaticBakeAttachments();
		}

		const identities = collectEnvCellGeometryIdentities(request);
		if (identities.length === 0) {
			return createEmptyStaticBakeAttachments();
		}

		const payloads = await Promise.all(
			collectLandblockIds(identities).map(async (landblockId) => {
				const key = createHostAssetKey("landblock-env-cells", landblockId);
				const asset = await this.#assetReader.requestPreparedAsset(key);
				return requireLandblockEnvCellsPayload(asset.payload, key);
			}),
		);
		const cellsByIdentity = createFullEnvCellsByIdentity(payloads);
		const envCellCellStructureGeometry = identities.map((identity) => {
			const cell = cellsByIdentity.get(
				describeEnvCellCellStructureGeometryIdentity(identity),
			);
			if (!cell) {
				throw new Error(
					`Missing env-cell geometry attachment ${describeEnvCellCellStructureGeometryIdentity(
						identity,
					)} in full landblock-env-cells payload.`,
				);
			}

			return createEnvCellCellStructureGeometryAttachment({ cell, identity });
		});

		return {
			...createEmptyStaticBakeAttachments(),
			envCellCellStructureGeometry,
		};
	}
}

export function createEnvCellCellStructureGeometryIdentity(options: {
	readonly envCell: Pick<
		LandblockEnvCellStaticFacts,
		"cellStructure" | "environment" | "identity" | "landblockId"
	>;
}): EnvCellCellStructureGeometryIdentity {
	return {
		cellStructure: options.envCell.cellStructure,
		envCell: options.envCell.identity,
		environment: options.envCell.environment,
		kind: "env-cell-cell-structure-geometry",
		landblockId: options.envCell.landblockId,
	};
}

export function describeEnvCellCellStructureGeometryIdentity(
	identity: EnvCellCellStructureGeometryIdentity,
): string {
	return [
		identity.kind,
		`landblock:${formatHex32(identity.landblockId)}`,
		`env-cell:${formatHex32(identity.envCell.envCellId)}`,
		`environment:${formatHex32(identity.environment.environmentId)}`,
		`cell-structure:${formatHex32(identity.cellStructure.cellStructureId)}`,
	].join("|");
}

function collectEnvCellGeometryIdentities(
	request: StaticBakeAttachmentRequest,
): readonly EnvCellCellStructureGeometryIdentity[] {
	const byKey = new Map<string, EnvCellCellStructureGeometryIdentity>();

	for (const item of request.items) {
		if (item.payload.scope.kind !== "landblock-env-cells") {
			continue;
		}

		for (const envCell of item.payload.scope.envCells) {
			const identity = createEnvCellCellStructureGeometryIdentity({ envCell });
			byKey.set(
				describeEnvCellCellStructureGeometryIdentity(identity),
				identity,
			);
		}
	}

	return [...byKey.values()].sort((left, right) =>
		describeEnvCellCellStructureGeometryIdentity(left).localeCompare(
			describeEnvCellCellStructureGeometryIdentity(right),
		),
	);
}

function collectLandblockIds(
	identities: readonly EnvCellCellStructureGeometryIdentity[],
): readonly number[] {
	return [...new Set(identities.map((identity) => identity.landblockId))].sort(
		(left, right) => left - right,
	);
}

function createFullEnvCellsByIdentity(
	payloads: readonly LandblockEnvCellsPayloadDto[],
): ReadonlyMap<string, LandblockEnvCellsPayloadDto["envCells"][number]> {
	const cellsByIdentity = new Map<
		string,
		LandblockEnvCellsPayloadDto["envCells"][number]
	>();

	for (const payload of payloads) {
		for (const cell of payload.envCells) {
			const identity = createFullPayloadGeometryIdentity(payload, cell);
			cellsByIdentity.set(
				describeEnvCellCellStructureGeometryIdentity(identity),
				cell,
			);
		}
	}

	return cellsByIdentity;
}

function createFullPayloadGeometryIdentity(
	payload: LandblockEnvCellsPayloadDto,
	cell: LandblockEnvCellsPayloadDto["envCells"][number],
): EnvCellCellStructureGeometryIdentity {
	return {
		cellStructure: {
			cellStructureId: cell.cellStructureId,
			kind: "cell-structure",
		},
		envCell: {
			envCellId: cell.envCellId,
			kind: "env-cell-source",
		},
		environment: {
			environmentId: cell.environmentId,
			kind: "environment",
		},
		kind: "env-cell-cell-structure-geometry",
		landblockId: payload.landblockId,
	};
}

function createEnvCellCellStructureGeometryAttachment(options: {
	readonly identity: EnvCellCellStructureGeometryIdentity;
	readonly cell: LandblockEnvCellsPayloadDto["envCells"][number];
}): EnvCellCellStructureGeometryAttachment {
	const renderGeometry = options.cell.renderGeometry;
	assertRenderGeometryVertexBuffers(options.identity, renderGeometry);

	return {
		bounds: renderGeometry.bounds,
		identity: options.identity,
		invalidPolygons: renderGeometry.invalidPolygons,
		normals: toFloat32Array(renderGeometry.normals),
		positions: toFloat32Array(renderGeometry.positions),
		skippedPolygonCount: renderGeometry.skippedPolygonCount,
		sourceId: renderGeometry.sourceId,
		surfaceIds: renderGeometry.surfaceIds,
		triangleCount: renderGeometry.triangleCount,
		triangles: renderGeometry.triangles,
		uvs: toFloat32Array(renderGeometry.uvs),
		vertexCount: renderGeometry.vertexCount,
	};
}

function assertRenderGeometryVertexBuffers(
	identity: EnvCellCellStructureGeometryIdentity,
	renderGeometry: Partial<
		LandblockEnvCellsPayloadDto["envCells"][number]["renderGeometry"]
	>,
): asserts renderGeometry is LandblockEnvCellsPayloadDto["envCells"][number]["renderGeometry"] {
	if (
		renderGeometry.positions === undefined ||
		renderGeometry.normals === undefined ||
		renderGeometry.uvs === undefined
	) {
		throw new Error(
			`Env-cell geometry attachment ${describeEnvCellCellStructureGeometryIdentity(
				identity,
			)} resolved metadata-only render geometry; full positions, normals, and UVs are required for bake attachments.`,
		);
	}
}

function requireLandblockEnvCellsPayload(
	payload: unknown,
	key: Parameters<typeof describeHostAssetKey>[0],
): LandblockEnvCellsPayloadDto {
	if (
		typeof payload === "object" &&
		payload !== null &&
		"kind" in payload &&
		payload.kind === "landblock-env-cells"
	) {
		return payload as LandblockEnvCellsPayloadDto;
	}

	throw new Error(
		`Env-cell geometry attachment expected ${describeHostAssetKey(
			key,
		)} to resolve to a landblock-env-cells payload.`,
	);
}

function toFloat32Array(values: ArrayLike<number>): Float32Array {
	return values instanceof Float32Array ? values : Float32Array.from(values);
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
