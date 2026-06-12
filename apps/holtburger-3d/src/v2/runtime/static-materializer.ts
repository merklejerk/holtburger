import {
	OUTDOOR_LANDBLOCK_WORLD_SIZE,
	getOutdoorLandblockCoords,
} from "../../lib/landblocks";
import type {
	StaticResidencyDelta,
	TextureDrawUnitBinding,
	TexturePlacementUpdate,
} from "../renderer/types";
import type {
	StaticCoordinatorCommitDelta,
	StaticDrawUnit,
} from "../static/contracts";

export interface StaticMaterializationInput {
	readonly commit: StaticCoordinatorCommitDelta;
	readonly renderAnchorLandblockId: number | null;
	readonly textureUpdate: TexturePlacementUpdate | null;
}

export interface StaticMaterializationResult {
	readonly staticDelta: StaticResidencyDelta;
	readonly textureUpdate: TexturePlacementUpdate | null;
}

export function materializeStaticCommit(
	input: StaticMaterializationInput,
): StaticMaterializationResult {
	assertTexturedDrawUnitsHaveCommittedBindings(
		input.commit.addedDrawUnits,
		input.textureUpdate?.drawUnitBindings ?? [],
	);

	return {
		staticDelta: {
			addedDrawUnitPlacements: input.commit.addedDrawUnits.map((drawUnit) => ({
				drawUnit,
				translation: createStaticDrawUnitTranslation(
					drawUnit,
					input.renderAnchorLandblockId,
				),
			})),
			removedDrawUnitIds: input.commit.removedDrawUnitIds,
			revision: input.commit.revision,
		},
		textureUpdate: input.textureUpdate,
	};
}

function assertTexturedDrawUnitsHaveCommittedBindings(
	drawUnits: readonly StaticDrawUnit[],
	bindings: readonly TextureDrawUnitBinding[],
): void {
	const textureUseIdsByDrawUnitId = new Map<string, Set<string>>();
	for (const binding of bindings) {
		const textureUseIds =
			textureUseIdsByDrawUnitId.get(binding.drawUnitId) ?? new Set<string>();
		textureUseIds.add(binding.textureUseId);
		textureUseIdsByDrawUnitId.set(binding.drawUnitId, textureUseIds);
	}

	for (const drawUnit of drawUnits) {
		const expectedTextureUseIds = getStaticDrawUnitTextureUseIds(drawUnit);
		if (expectedTextureUseIds.length === 0) {
			continue;
		}

		const committedTextureUseIds =
			textureUseIdsByDrawUnitId.get(drawUnit.drawUnitId) ?? new Set<string>();
		const missingTextureUseIds = expectedTextureUseIds.filter(
			(textureUseId) => !committedTextureUseIds.has(textureUseId),
		);
		if (missingTextureUseIds.length > 0) {
			throw new Error(
				`Static draw unit ${drawUnit.drawUnitId} is missing committed texture bindings for ${missingTextureUseIds.join(", ")}.`,
			);
		}
	}
}

function getStaticDrawUnitTextureUseIds(
	drawUnit: StaticDrawUnit,
): readonly string[] {
	if (
		drawUnit.kind === "terrain-geometry" ||
		drawUnit.kind === "static-object-geometry"
	) {
		return drawUnit.textureUseIds;
	}

	return [];
}

function createStaticDrawUnitTranslation(
	drawUnit: StaticDrawUnit,
	focusLandblockId: number | null,
): readonly [number, number, number] {
	if (
		(drawUnit.kind !== "terrain-geometry" &&
			drawUnit.kind !== "static-object-geometry") ||
		focusLandblockId === null
	) {
		return [0, 0, 0];
	}

	const drawUnitCoords = getOutdoorLandblockCoords(drawUnit.landblockId);
	const focusCoords = getOutdoorLandblockCoords(focusLandblockId);

	return [
		normalizeZero(
			(drawUnitCoords.x - focusCoords.x) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
		0,
		normalizeZero(
			-(drawUnitCoords.y - focusCoords.y) * OUTDOOR_LANDBLOCK_WORLD_SIZE,
		),
	];
}

function normalizeZero(value: number): number {
	return Object.is(value, -0) ? 0 : value;
}
