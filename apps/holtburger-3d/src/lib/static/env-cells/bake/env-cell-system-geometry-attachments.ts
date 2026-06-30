import { createEmptyStaticBakeAttachments } from "../../bake/attachments";
import type {
	EnvCellCellStructureGeometryAttachment,
	EnvCellCellStructureGeometryIdentity,
	LandblockEnvCellStaticFacts,
	StaticBakeAttachmentProvider,
	StaticBakeAttachmentRequest,
	StaticBakeBatchAttachments,
} from "../../contracts";
import type { EnvCellSystemLayerSourcePayloadDto } from "../../source-payloads";

export class EnvCellSystemGeometryAttachmentProvider implements StaticBakeAttachmentProvider {
	async createAttachments(
		request: StaticBakeAttachmentRequest,
	): Promise<StaticBakeBatchAttachments> {
		if (request.domain !== "env-cell-system") {
			return createEmptyStaticBakeAttachments();
		}

		const identities = collectEnvCellGeometryIdentities(request);
		if (identities.length === 0) {
			return createEmptyStaticBakeAttachments();
		}

		const cellsByIdentity = createFullEnvCellsByIdentity(request);
		const envCellCellStructureGeometry = identities.map((identity) => {
			const cell = cellsByIdentity.get(
				describeEnvCellCellStructureGeometryIdentity(identity),
			);
			if (!cell) {
				throw new Error(
					`Missing env-cell geometry attachment ${describeEnvCellCellStructureGeometryIdentity(
						identity,
					)} in resolved landblock-scene-lod payload.`,
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
		if (item.payload.scope.kind !== "env-cell-system") {
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

function createFullEnvCellsByIdentity(
	request: StaticBakeAttachmentRequest,
): ReadonlyMap<string, LandblockEnvCellStaticFacts> {
	const cellsByIdentity = new Map<
		string,
		LandblockEnvCellStaticFacts
	>();

	for (const item of request.items) {
		if (item.payload.scope.kind !== "env-cell-system") {
			continue;
		}

		for (const cell of item.payload.scope.envCells) {
			const identity = createEnvCellCellStructureGeometryIdentity({
				envCell: cell,
			});
			cellsByIdentity.set(
				describeEnvCellCellStructureGeometryIdentity(identity),
				cell,
			);
		}
	}

	return cellsByIdentity;
}

function createEnvCellCellStructureGeometryAttachment(options: {
	readonly identity: EnvCellCellStructureGeometryIdentity;
	readonly cell: LandblockEnvCellStaticFacts;
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
		EnvCellSystemLayerSourcePayloadDto["envCells"][number]["renderGeometry"]
	>,
): asserts renderGeometry is EnvCellSystemLayerSourcePayloadDto["envCells"][number]["renderGeometry"] {
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

function toFloat32Array(values: ArrayLike<number>): Float32Array {
	return values instanceof Float32Array ? values : Float32Array.from(values);
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
