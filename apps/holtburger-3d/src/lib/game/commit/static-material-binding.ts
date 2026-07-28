import type {
	ResolvedGeometry,
	ResolvedMaterial,
} from "../resolution/presentation";
import { planObjectMaterial } from "../resolution/object-material-planner";
import type { StaticDetailRole } from "../resolution/static-detail-role";
import { TextureWrapMode } from "../textures/types";
import type { StaticObjectMaterialBinding } from "./artifacts";

/** Complete renderer-neutral binding and stable identity for one authored static triangle. */
export interface ResolvedStaticTriangleMaterial {
	readonly binding: StaticObjectMaterialBinding;
	readonly bindingId: string;
	readonly ordering: ReturnType<typeof planObjectMaterial>["ordering"];
	readonly textureRequirements: ReturnType<
		typeof planObjectMaterial
	>["textureRequirements"];
}

/** Resolve material, sampler, polygon-side, stippling, detail, and ordering as one contract. */
export function resolveStaticTriangleMaterial(options: {
	readonly detailRole: StaticDetailRole;
	readonly geometry: ResolvedGeometry;
	readonly materials: readonly ResolvedMaterial[];
	readonly sourceLabel: string;
	readonly triangle: number;
}): ResolvedStaticTriangleMaterial {
	const slot = options.geometry.materialSlotIndices[options.triangle];
	const material = options.materials[slot ?? -1];
	if (!material) {
		throw new Error(
			`${options.sourceLabel} triangle ${options.triangle} has no material slot ${slot}.`,
		);
	}
	const wrap =
		options.geometry.materialWrapModes[options.triangle] === 1
			? TextureWrapMode.Repeat
			: TextureWrapMode.Clamp;
	const plan = planObjectMaterial(material, wrap, options.detailRole);
	const sideKind = options.geometry.materialSideKinds[options.triangle];
	const sideType = options.geometry.materialSideTypes[options.triangle];
	const stippling = options.geometry.materialStippling[options.triangle];
	if (
		sideKind === undefined ||
		sideType === undefined ||
		stippling === undefined
	) {
		throw new Error(
			`${options.sourceLabel} triangle ${options.triangle} is missing polygon facts.`,
		);
	}
	const polygon = {
		authoredCullMode: authoredCullMode(sideType),
		cullFace: effectiveCullFace(sideType),
		renderSide: renderSide(sideKind),
		stippled: (stippling & (sideKind === 2 ? 0x02 : 0x01)) !== 0,
	} as const;
	return {
		binding: {
			detailRole: plan.detailRole,
			palettedClipMap: plan.palettedClipMap,
			polygon,
			sampler: plan.sampler,
			source: material,
			textures: { base: plan.baseTexture, palette: plan.paletteTexture },
		},
		bindingId: [
			plan.id,
			polygon.authoredCullMode,
			polygon.cullFace,
			polygon.renderSide,
			polygon.stippled,
		].join("|"),
		ordering: plan.ordering,
		textureRequirements: plan.textureRequirements,
	};
}

function authoredCullMode(
	value: number,
): StaticObjectMaterialBinding["polygon"]["authoredCullMode"] {
	switch (value) {
		case 0:
			return "landblock";
		case 1:
			return "none";
		case 2:
			return "clockwise";
		case 3:
			return "counter-clockwise";
		default:
			throw new Error(`Unsupported polygon culling mode ${value}.`);
	}
}

function effectiveCullFace(
	value: number,
): StaticObjectMaterialBinding["polygon"]["cullFace"] {
	// Rust expands None and Clockwise into explicit reversed-winding sides. Each resulting range
	// must remain one-sided or the paired ranges submit the same coplanar surface twice.
	return value === 3 ? "front" : "back";
}

function renderSide(
	value: number,
): StaticObjectMaterialBinding["polygon"]["renderSide"] {
	switch (value) {
		case 0:
			return "positive";
		case 1:
			return "positive-reversed";
		case 2:
			return "negative";
		default:
			throw new Error(`Unsupported polygon render side ${value}.`);
	}
}
