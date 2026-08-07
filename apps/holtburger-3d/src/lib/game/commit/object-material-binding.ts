import type {
	ResolvedGeometry,
	ResolvedMaterial,
} from "../resolution/presentation";
import { planObjectMaterial } from "../resolution/object-material-planner";
import type { StaticDetailRole } from "../resolution/static-detail-role";
import { TextureWrapMode } from "../textures/types";
import type { ObjectMaterialBinding } from "./artifacts";

/** Complete renderer-neutral binding and stable identity for one authored static triangle. */
export interface ResolvedObjectTriangleMaterial {
	readonly binding: ObjectMaterialBinding;
	readonly bindingId: string;
	readonly ordering: ReturnType<typeof planObjectMaterial>["ordering"];
	readonly textureRequirements: ReturnType<
		typeof planObjectMaterial
	>["textureRequirements"];
}

/** Resolve material, sampler, polygon-side, stippling, detail, and ordering as one contract. */
export function resolveObjectTriangleMaterial(options: {
	readonly detailRole: StaticDetailRole | null;
	readonly geometry: ResolvedGeometry;
	readonly materials: readonly ResolvedMaterial[];
	readonly sourceLabel: string;
	readonly triangle: number;
}): ResolvedObjectTriangleMaterial {
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
		cullFace: effectiveCullFace(sideType),
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
		// Keyed strictly on facts a draw honours. The expanded render side is excluded because
		// both sides of a CULL_MODE_NONE polygon resolve the same material, cull face, and
		// stippling, so keying on it would split every such polygon into its own pair of draw
		// ranges for no draw-state difference. CULL_MODE_CLOCKWISE sides stay separate on their
		// own merits, because they resolve different authored surfaces and so different plan ids.
		// `stippled` has no consumer yet, but it is retained because it is meant to become draw
		// state; it measures as a zero-cost axis today.
		bindingId: [plan.id, polygon.cullFace, polygon.stippled].join("|"),
		ordering: plan.ordering,
		textureRequirements: plan.textureRequirements,
	};
}

/**
 * Reject an unsupported authored culling mode and reduce the supported ones to draw state.
 *
 * Rust expands None and Clockwise into explicit reversed-winding sides, so every mode but
 * CounterClockwise arrives already one-sided about its own winding. Each resulting range must stay
 * one-sided or the paired ranges submit the same coplanar surface twice.
 *
 * The authored mode itself is deliberately not retained. Landblock, None, and Clockwise all reduce
 * to back-face rejection, so keeping the distinction would only split batches that share draw state.
 */
function effectiveCullFace(
	value: number,
): ObjectMaterialBinding["polygon"]["cullFace"] {
	switch (value) {
		case 0:
		case 1:
		case 2:
			return "back";
		case 3:
			return "front";
		default:
			throw new Error(`Unsupported polygon culling mode ${value}.`);
	}
}
