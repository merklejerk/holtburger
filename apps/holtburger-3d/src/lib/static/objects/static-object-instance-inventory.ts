import type {
	StaticObjectGeometryStaticDrawUnit,
	StaticObjectSourceMappingCoverage,
} from "../contracts";

export interface GeneratedStaticObjectInstanceInventory {
	readonly domain: "outdoor-detail";
	readonly drawUnitCount: number;
	readonly generatedCoverageCount: number;
	readonly generatedObjectCount: number;
	readonly repeatedGroupCount: number;
	readonly repeatedGeneratedObjectCount: number;
	readonly candidateGroups: readonly GeneratedStaticObjectInstanceCandidateGroup[];
}

export interface GeneratedStaticObjectInstanceCandidateGroup {
	readonly key: string;
	readonly sourceDid: number;
	readonly gfxObjDid: number;
	readonly partIndex: number;
	readonly materialSlot: number;
	readonly generatedObjectCount: number;
	readonly drawUnitIds: readonly string[];
	readonly objectInstanceIds: readonly string[];
	readonly sourceTriangleCount: number;
}

export function inventoryGeneratedOutdoorDetailInstances(
	drawUnits: readonly StaticObjectGeometryStaticDrawUnit[],
): GeneratedStaticObjectInstanceInventory {
	const candidateGroupsByKey = new Map<
		string,
		GeneratedStaticObjectInstanceCandidateGroupBuilder
	>();
	const generatedObjectIds = new Set<string>();
	let generatedCoverageCount = 0;

	for (const drawUnit of drawUnits) {
		if (drawUnit.domain !== "outdoor-detail") {
			continue;
		}
		for (const coverage of drawUnit.sourceMappingCoverage) {
			if (coverage.object.objectKind !== "generated-scenery") {
				continue;
			}

			generatedCoverageCount += 1;
			generatedObjectIds.add(coverage.object.instanceId);
			const key = createGeneratedStaticObjectInstanceCandidateKey(coverage);
			const builder = candidateGroupsByKey.get(key) ?? {
				drawUnitIds: new Set<string>(),
				gfxObjDid: coverage.gfxObj.sourceDid,
				key,
				materialSlot: coverage.materialSlot,
				objectInstanceIds: new Set<string>(),
				partIndex: coverage.partIndex,
				sourceDid: coverage.source.sourceDid,
				sourceTriangleCount: 0,
			};
			builder.drawUnitIds.add(drawUnit.drawUnitId);
			builder.objectInstanceIds.add(coverage.object.instanceId);
			builder.sourceTriangleCount += coverage.sourceTriangleCount;
			candidateGroupsByKey.set(key, builder);
		}
	}

	const candidateGroups = Array.from(candidateGroupsByKey.values())
		.map(finalizeCandidateGroup)
		.filter((group) => group.generatedObjectCount > 1)
		.sort((left, right) => {
			const countDelta =
				right.generatedObjectCount - left.generatedObjectCount;
			if (countDelta !== 0) {
				return countDelta;
			}
			return left.key.localeCompare(right.key);
		});

	return {
		candidateGroups,
		domain: "outdoor-detail",
		drawUnitCount: drawUnits.filter((drawUnit) => drawUnit.domain === "outdoor-detail")
			.length,
		generatedCoverageCount,
		generatedObjectCount: generatedObjectIds.size,
		repeatedGeneratedObjectCount: candidateGroups.reduce(
			(total, group) => total + group.generatedObjectCount,
			0,
		),
		repeatedGroupCount: candidateGroups.length,
	};
}

function createGeneratedStaticObjectInstanceCandidateKey(
	coverage: StaticObjectSourceMappingCoverage,
): string {
	return [
		`source:${coverage.source.sourceAssetKind}:${formatHex32(
			coverage.source.sourceDid,
		)}`,
		`gfx:${coverage.gfxObj.sourceAssetKind}:${formatHex32(
			coverage.gfxObj.sourceDid,
		)}`,
		`part:${coverage.partIndex}`,
		`slot:${coverage.materialSlot}`,
		`materials:${coverage.materialIds
			.map(formatHex32)
			.sort((left, right) => left.localeCompare(right))
			.join(",")}`,
		`geometry-surfaces:${coverage.geometrySurfaceIds
			.map(String)
			.sort((left, right) => left.localeCompare(right))
			.join(",")}`,
		`variants:${coverage.materialVariantSignatures
			.map((signature) => signature ?? "none")
			.sort((left, right) => left.localeCompare(right))
			.join(",")}`,
	].join("|");
}

interface GeneratedStaticObjectInstanceCandidateGroupBuilder {
	readonly key: string;
	readonly sourceDid: number;
	readonly gfxObjDid: number;
	readonly partIndex: number;
	readonly materialSlot: number;
	readonly drawUnitIds: Set<string>;
	readonly objectInstanceIds: Set<string>;
	sourceTriangleCount: number;
}

function finalizeCandidateGroup(
	builder: GeneratedStaticObjectInstanceCandidateGroupBuilder,
): GeneratedStaticObjectInstanceCandidateGroup {
	return {
		drawUnitIds: Array.from(builder.drawUnitIds).sort((left, right) =>
			left.localeCompare(right),
		),
		generatedObjectCount: builder.objectInstanceIds.size,
		gfxObjDid: builder.gfxObjDid,
		key: builder.key,
		materialSlot: builder.materialSlot,
		objectInstanceIds: Array.from(builder.objectInstanceIds).sort((left, right) =>
			left.localeCompare(right),
		),
		partIndex: builder.partIndex,
		sourceDid: builder.sourceDid,
		sourceTriangleCount: builder.sourceTriangleCount,
	};
}

function formatHex32(value: number): string {
	return `0x${value.toString(16).padStart(8, "0")}`;
}
