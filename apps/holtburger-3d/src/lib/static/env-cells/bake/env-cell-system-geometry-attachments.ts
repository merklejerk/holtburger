import { createEmptyStaticBakeAttachments } from "../../bake/attachments";
import { requirePreparedRenderGeometryBuffers } from "../../../assets/preparation/prepared-render-geometry";
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
	const cellsByIdentity = new Map<string, LandblockEnvCellStaticFacts>();

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
	const renderGeometry = options.cell
		.renderGeometry as EnvCellSystemLayerSourcePayloadDto["envCells"][number]["renderGeometry"];
	requirePreparedRenderGeometryBuffers(
		renderGeometry,
		`Env-cell geometry attachment ${describeEnvCellCellStructureGeometryIdentity(
			options.identity,
		)}.renderGeometry`,
	);

	return {
		bounds: renderGeometry.bounds,
		identity: options.identity,
		invalidPolygons: renderGeometry.invalidPolygons,
		normals: renderGeometry.normals,
		positions: renderGeometry.positions,
		skippedPolygonCount: renderGeometry.skippedPolygonCount,
		sourceId: renderGeometry.sourceId,
		surfaceIds: renderGeometry.surfaceIds,
		triangleCount: renderGeometry.triangleCount,
		triangles: renderGeometry.triangles,
		uvs: renderGeometry.uvs,
		vertexCount: renderGeometry.vertexCount,
	};
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
