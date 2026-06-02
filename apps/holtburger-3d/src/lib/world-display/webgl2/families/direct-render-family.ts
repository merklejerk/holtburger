import type { LegacyMaterialBehaviorDto } from "../../material-behavior";
import type { RenderMat4, RenderVec4 } from "../../render-math";
import type { Webgl2SceneDomain } from "../../webgl2-scene-domain-targets";
import type {
	Webgl2DetailOverlayResources,
	Webgl2IndexedMaterialResources,
	Webgl2WorldDrawUnit,
} from "../../webgl2-world-resources";
import type { TexturePageBinding } from "../../texture-pages/texture-page-binding";
import type { Webgl2TerrainBlendResources } from "../resources/terrain-tile-resources";

export type GeometrySubmissionLayout =
	| "position"
	| "position-uv"
	| "position-uv-material-slot";

interface DirectGeometrySubmission {
	mode: "direct";
	drawUnitId: string;
	drawUnitKind: Webgl2WorldDrawUnit["kind"];
	layout: GeometrySubmissionLayout;
	vertexArrayKey: string;
	modelMatrix: RenderMat4;
	firstIndex: 0;
	indexCount: number;
	indexType: GLenum;
	materialSlotIndex: 0;
	sceneDomain: Webgl2SceneDomain | null;
	triangleCount: number;
}

type DirectFamilyMaterialPayload =
	| DirectFlatConstantColorPayload
	| DirectRgbaTexturePagePayload
	| DirectIndexedPalettedPayload
	| DirectTerrainBlendPayload
	| DirectDebugPipelinePayload;

interface DirectFlatConstantColorPayload {
	family: "flat-constant-color";
	materialKey: string;
	color: RenderVec4;
	materialBehavior: LegacyMaterialBehaviorDto | null;
}

interface DirectRgbaTexturePagePayload {
	family: "rgba-texture-page";
	materialKey: string;
	color: RenderVec4;
	texture: NonNullable<Webgl2WorldDrawUnit["texture"]>;
	detailOverlay: Webgl2DetailOverlayResources | null;
	texturePageBindings: readonly TexturePageBinding[];
	materialBehavior: LegacyMaterialBehaviorDto | null;
}

interface DirectIndexedPalettedPayload {
	family: "indexed-paletted";
	materialKey: string;
	color: RenderVec4;
	indexedMaterial: Webgl2IndexedMaterialResources;
	detailOverlay: Webgl2DetailOverlayResources | null;
	texturePageBindings: readonly TexturePageBinding[];
	materialBehavior: LegacyMaterialBehaviorDto | null;
}

interface DirectTerrainBlendPayload {
	family: "terrain-blend";
	materialKey: string;
	terrainBlend: Webgl2TerrainBlendResources;
}

interface DirectDebugPipelinePayload {
	family: "debug-pipeline";
	materialKey: string;
	color: RenderVec4;
	debugKind: Webgl2WorldDrawUnit["kind"];
	materialBehavior: LegacyMaterialBehaviorDto | null;
}

export interface DirectRenderFamilySubmission {
	geometry: DirectGeometrySubmission;
	material: DirectFamilyMaterialPayload;
}

export function deriveDirectGeometrySubmissionLayout(
	drawUnit: Pick<Webgl2WorldDrawUnit, "uvBuffer">,
): GeometrySubmissionLayout {
	return drawUnit.uvBuffer ? "position-uv" : "position";
}

export function mapWebgl2DrawUnitToDirectRenderFamilySubmission(
	drawUnit: Webgl2WorldDrawUnit,
): DirectRenderFamilySubmission {
	return {
		geometry: {
			mode: "direct",
			drawUnitId: drawUnit.id,
			drawUnitKind: drawUnit.kind,
			layout: drawUnit.directGeometryLayout,
			vertexArrayKey: directVertexArrayKey(drawUnit.id),
			modelMatrix: drawUnit.modelMatrix,
			firstIndex: 0,
			indexCount: drawUnit.vertexCount,
			indexType: drawUnit.indexType,
			materialSlotIndex: 0,
			sceneDomain: drawUnit.sceneDomain,
			triangleCount: drawUnit.triangleCount,
		},
		material: mapDirectFamilyMaterialPayload(drawUnit),
	};
}

export function directVertexArrayKey(drawUnitId: string): string {
	return `${drawUnitId}/vertex-array`;
}

function mapDirectFamilyMaterialPayload(
	drawUnit: Webgl2WorldDrawUnit,
): DirectFamilyMaterialPayload {
	if (drawUnit.kind === "portal-mask") {
		return {
			family: "debug-pipeline",
			materialKey: drawUnit.materialKey,
			color: drawUnit.color,
			debugKind: drawUnit.kind,
			materialBehavior: drawUnit.materialBehavior,
		};
	}
	if (drawUnit.terrainBlend) {
		return {
			family: "terrain-blend",
			materialKey: drawUnit.materialKey,
			terrainBlend: drawUnit.terrainBlend,
		};
	}
	if (drawUnit.indexedMaterial) {
		return {
			family: "indexed-paletted",
			materialKey: drawUnit.materialKey,
			color: drawUnit.color,
			indexedMaterial: drawUnit.indexedMaterial,
			detailOverlay: drawUnit.detailOverlay,
			texturePageBindings: drawUnit.texturePageBindings,
			materialBehavior: drawUnit.materialBehavior,
		};
	}
	if (drawUnit.texture) {
		return {
			family: "rgba-texture-page",
			materialKey: drawUnit.materialKey,
			color: drawUnit.color,
			texture: drawUnit.texture,
			detailOverlay: drawUnit.detailOverlay,
			texturePageBindings: drawUnit.texturePageBindings,
			materialBehavior: drawUnit.materialBehavior,
		};
	}
	return {
		family: "flat-constant-color",
		materialKey: drawUnit.materialKey,
		color: drawUnit.color,
		materialBehavior: drawUnit.materialBehavior,
	};
}
