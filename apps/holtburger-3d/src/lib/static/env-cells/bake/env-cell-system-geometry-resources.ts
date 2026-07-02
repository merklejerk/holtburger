import { createEmptyStaticBakeJobResources } from "../../bake/resources";
import { requirePreparedRenderGeometryBuffers } from "../../../assets/preparation/prepared-render-geometry";
import { objectVisualGeometryBufferId } from "../../../visual/object-visual-recipe-bundle";
import type {
	EnvCellCellStructureGeometrySidecar,
	EnvCellCellStructureGeometryIdentity,
	LandblockEnvCellStaticFacts,
	StaticBakeResourceProvider,
	StaticBakeResourceRequest,
	StaticBakeJobResources,
} from "../../contracts";
import type { EnvCellSystemLayerSourcePayloadDto } from "../../source-payloads";

export class EnvCellSystemGeometryResourceProvider implements StaticBakeResourceProvider {
	async createResources(
		request: StaticBakeResourceRequest,
	): Promise<StaticBakeJobResources> {
		if (request.domain !== "env-cell-system") {
			return createEmptyStaticBakeJobResources();
		}

		const identities = collectEnvCellGeometryIdentities(request);
		if (identities.length === 0) {
			return createEmptyStaticBakeJobResources();
		}

		const cellsByIdentity = createFullEnvCellsByIdentity(request);
		const envCellCellStructureGeometry = identities.map(
			(identity, bufferIndex) => {
				const cell = cellsByIdentity.get(
					describeEnvCellCellStructureGeometryIdentity(identity),
				);
				if (!cell) {
					throw new Error(
						`Missing env-cell geometry sidecar ${describeEnvCellCellStructureGeometryIdentity(
							identity,
						)} in resolved landblock-scene-lod payload.`,
					);
				}

				return createEnvCellCellStructureGeometrySidecar({
					bufferId: objectVisualGeometryBufferId(bufferIndex),
					cell,
					identity,
				});
			},
		);

		return {
			...createEmptyStaticBakeJobResources(),
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
	request: StaticBakeResourceRequest,
): readonly EnvCellCellStructureGeometryIdentity[] {
	const byKey = new Map<string, EnvCellCellStructureGeometryIdentity>();

	if (request.payload.scope.kind !== "env-cell-system") {
		return [];
	}

	for (const envCell of request.payload.scope.envCells) {
		const identity = createEnvCellCellStructureGeometryIdentity({ envCell });
		byKey.set(describeEnvCellCellStructureGeometryIdentity(identity), identity);
	}

	return [...byKey.values()].sort((left, right) =>
		describeEnvCellCellStructureGeometryIdentity(left).localeCompare(
			describeEnvCellCellStructureGeometryIdentity(right),
		),
	);
}

function createFullEnvCellsByIdentity(
	request: StaticBakeResourceRequest,
): ReadonlyMap<string, LandblockEnvCellStaticFacts> {
	const cellsByIdentity = new Map<string, LandblockEnvCellStaticFacts>();

	if (request.payload.scope.kind !== "env-cell-system") {
		return cellsByIdentity;
	}

	for (const cell of request.payload.scope.envCells) {
		const identity = createEnvCellCellStructureGeometryIdentity({
			envCell: cell,
		});
		cellsByIdentity.set(
			describeEnvCellCellStructureGeometryIdentity(identity),
			cell,
		);
	}

	return cellsByIdentity;
}

function createEnvCellCellStructureGeometrySidecar(options: {
	readonly bufferId: ReturnType<typeof objectVisualGeometryBufferId>;
	readonly identity: EnvCellCellStructureGeometryIdentity;
	readonly cell: LandblockEnvCellStaticFacts;
}): EnvCellCellStructureGeometrySidecar {
	const renderGeometry = options.cell
		.renderGeometry as EnvCellSystemLayerSourcePayloadDto["envCells"][number]["renderGeometry"];
	requirePreparedRenderGeometryBuffers(
		renderGeometry,
		`Env-cell geometry sidecar ${describeEnvCellCellStructureGeometryIdentity(
			options.identity,
		)}.renderGeometry`,
	);

	return {
		buffer: {
			bounds: renderGeometry.bounds,
			bufferId: options.bufferId,
			coordinateSpace: "source-local",
			normals: renderGeometry.normals,
			positions: renderGeometry.positions,
			texCoords: renderGeometry.uvs,
			triangleCount: renderGeometry.triangleCount,
			triangles: renderGeometry.triangles.map((triangle) => ({
				firstVertex: triangle.firstVertex,
				materialVariantSignature: triangle.materialVariantSignature ?? null,
				polygonId: triangle.polygonId,
				surfaceId: triangle.surfaceId,
			})),
			vertexCount: renderGeometry.vertexCount,
		},
		identity: options.identity,
		invalidPolygons: renderGeometry.invalidPolygons,
		skippedPolygonCount: renderGeometry.skippedPolygonCount,
		sourceId: renderGeometry.sourceId,
		surfaceIds: renderGeometry.surfaceIds,
	};
}

function formatHex32(value: number): string {
	return (value >>> 0).toString(16).padStart(8, "0");
}
