import type { StaticObjectBatchPayload } from "./static-object-batch-partitioner";
import type {
	EnvCellSystemStaticScopePayload,
	OutdoorStaticObjectDomain,
	StaticBakeBatchItem,
	StaticDomain,
	StaticObjectSourceIdentity,
} from "../../contracts";

export function createStaticObjectBatchPayload(
	item: StaticBakeBatchItem,
): StaticObjectBatchPayload {
	if (
		(item.task.domain === "outdoor-buildings" ||
			item.task.domain === "outdoor-explicit-objects" ||
			item.task.domain === "outdoor-generated-scenery") &&
		item.payload.scope.kind === "outdoor-static-objects"
	) {
		return item.payload.scope;
	}
	if (
		item.task.domain === "env-cell-system" &&
		item.payload.scope.kind === "env-cell-system"
	) {
		return createEnvCellStaticObjectBatchPayload(item.payload.scope);
	}

	throw new Error(
		`Static object batch baker only supports static object payloads. Received ${item.task.domain}/${item.payload.scope.kind}.`,
	);
}

function createEnvCellStaticObjectBatchPayload(
	payload: EnvCellSystemStaticScopePayload,
): StaticObjectBatchPayload {
	const sourceByKey = new Map(
		(payload.sourceAssets ?? []).map((source) => [
			createSourceKey(source.identity),
			source,
		]),
	);
	const objects = payload.envCells.flatMap((envCell) =>
		envCell.staticObjectPlacements.flatMap((seed) => {
			const source = sourceByKey.get(createSourceKey(seed.source));
			if (!source || isEnvCellStaticObjectDynamicSource(source)) {
				return [];
			}
			return {
				debug: seed.debug,
				generated: null,
				identity: seed.identity,
				instanceBounds: null,
				localPlacement: seed.localPlacement,
				owningEnvCellId: envCell.identity.envCellId,
				portalCount: 0,
				source: seed.source,
				sourceBounds: null,
				sourceIndex: seed.sourceIndex,
				sourceScale: seed.sourceScale ?? { x: 1, y: 1, z: 1 },
			};
		}),
	);

	return {
		domain: "env-cell-system",
		landblock: payload.landblock,
		materialSlots: [],
		materialSources: payload.materialSources ?? [],
		objects,
		paletteSources: payload.paletteSources ?? [],
		regionRenderProfile: { detailRoles: [] },
		sourceAssets: payload.sourceAssets ?? [],
		textureRefs: payload.textureRefs ?? [],
	};
}

function isEnvCellStaticObjectDynamicSource(
	source: StaticObjectBatchPayload["sourceAssets"][number],
): boolean {
	return (
		source.sourceAssetKind === "setup-model" && source.defaultAnimation !== null
	);
}

export function isStaticObjectDomain(
	domain: StaticDomain,
): domain is Extract<
	StaticDomain,
	OutdoorStaticObjectDomain | "env-cell-system"
> {
	return (
		domain === "outdoor-buildings" ||
		domain === "outdoor-explicit-objects" ||
		domain === "outdoor-generated-scenery" ||
		domain === "env-cell-system"
	);
}

function createSourceKey(source: StaticObjectSourceIdentity): string {
	return [
		source.kind,
		source.sourceAssetKind,
		formatHex32(source.sourceDid),
	].join(":");
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}
