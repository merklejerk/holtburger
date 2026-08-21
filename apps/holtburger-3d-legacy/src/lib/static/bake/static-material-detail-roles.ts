import type {
	OutdoorStaticObjectDomain,
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	RegionDetailRoleFacts,
	RenderSurfaceIdentity,
	StaticObjectTextureRefFacts,
	SurfaceTextureIdentity,
} from "../contracts";
import type {
	ObjectVisualMaterialFallbackReason,
	ObjectVisualMaterialPlan,
	ObjectVisualMaterialTextureUseRole,
} from "../../visual/object-visual-material-planner";
import {
	createStaticMaterialBucketKey,
	createObjectVisualMaterialFallbackReason,
	findStaticRenderSurfaceRef,
	findStaticSurfaceTextureRef,
} from "./static-material-plan-primitives";

export type StaticMaterialDetailRoleDomain =
	| OutdoorStaticObjectDomain
	| "env-cell-system"
	| "runtime-authored-dynamic-object-material";

export interface StaticMaterialDetailRolePlan {
	readonly role: RegionDetailRoleFacts["role"];
	readonly texture: SurfaceTextureIdentity;
	readonly renderSurface: RenderSurfaceIdentity | null;
	readonly dataUse: PreparedRgbaRenderSurfaceTextureUseIdentity | null;
	readonly tiling: number;
	readonly fadeNear: number;
	readonly fadeFar: number;
	readonly renderCoverage:
		"classified-render-candidate" | "classified-render-deferred";
	readonly fallbackReasons: readonly ObjectVisualMaterialFallbackReason[];
}

export function planStaticMaterialDetailRoles(options: {
	readonly detailRoles: readonly RegionDetailRoleFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
}): readonly StaticMaterialDetailRolePlan[] {
	return options.detailRoles
		.filter((role) => role.role !== "landscape")
		.map((role) =>
			createStaticMaterialDetailRolePlan(role, options.textureRefs),
		);
}

export function composeStaticMaterialDetailRole(options: {
	readonly domain: StaticMaterialDetailRoleDomain;
	readonly detailRoles: readonly StaticMaterialDetailRolePlan[];
	readonly plan: ObjectVisualMaterialPlan;
}): ObjectVisualMaterialPlan {
	const detailRole = resolveComposableDetailRole(
		options.domain,
		options.detailRoles,
	);
	if (!detailRole) {
		return options.plan;
	}

	if (options.plan.renderCoverage !== "classified-render-candidate") {
		return {
			...options.plan,
			fallbackReasons: [
				...options.plan.fallbackReasons,
				createObjectVisualMaterialFallbackReason({
					code: "detail-overlay-render-deferred",
					material: options.plan.material,
					message:
						"Static material detail overlay is deferred until this material pass is renderable.",
					texture: detailRole.texture,
				}),
			],
		};
	}

	if (!detailRole.dataUse || !detailRole.renderSurface) {
		return options.plan;
	}

	const textureRoles: readonly ObjectVisualMaterialTextureUseRole[] = [
		...options.plan.textureRoles,
		{
			dataUse: detailRole.dataUse,
			fadeFar: detailRole.fadeFar,
			fadeNear: detailRole.fadeNear,
			renderSurface: detailRole.renderSurface,
			role: "detail-overlay",
			texture: detailRole.texture,
			tiling: detailRole.tiling,
		},
	];

	return {
		...options.plan,
		materialBucketKey: createStaticMaterialBucketKey({
			alphaPolicy: options.plan.alphaPolicy.mode,
			family: options.plan.family,
			material: options.plan.material,
			pass: options.plan.pass,
			textureRoles,
		}),
		textureRoles,
	};
}

function resolveComposableDetailRole(
	domain: StaticMaterialDetailRoleDomain,
	detailRoles: readonly StaticMaterialDetailRolePlan[],
): StaticMaterialDetailRolePlan | null {
	const role =
		domain === "outdoor-buildings"
			? "building"
			: domain === "env-cell-system"
				? "environment"
				: null;
	if (!role) {
		return null;
	}

	const detailRole =
		detailRoles.find((candidate) => candidate.role === role) ?? null;
	return detailRole?.renderCoverage === "classified-render-candidate"
		? detailRole
		: null;
}

function createStaticMaterialDetailRolePlan(
	role: RegionDetailRoleFacts,
	textureRefs: readonly StaticObjectTextureRefFacts[],
): StaticMaterialDetailRolePlan {
	if (role.role !== "building" && role.role !== "environment") {
		return {
			dataUse: null,
			fadeFar: role.fadeFar,
			fadeNear: role.fadeNear,
			fallbackReasons: [
				createObjectVisualMaterialFallbackReason({
					code: "detail-overlay-render-deferred",
					message:
						"Static material detail overlay role is not renderable for this static family yet.",
					texture: role.texture,
				}),
			],
			renderCoverage: "classified-render-deferred",
			renderSurface: null,
			role: role.role,
			texture: role.texture,
			tiling: role.tiling,
		};
	}

	const textureRef = findStaticSurfaceTextureRef(textureRefs, role.texture);
	const renderSurface = textureRef?.renderSurface ?? null;
	if (
		!renderSurface ||
		!findStaticRenderSurfaceRef(textureRefs, renderSurface)
	) {
		return {
			dataUse: null,
			fadeFar: role.fadeFar,
			fadeNear: role.fadeNear,
			fallbackReasons: [
				createObjectVisualMaterialFallbackReason({
					code: "missing-detail-render-surface",
					message:
						"Static material detail overlay texture has no resolved render surface.",
					texture: role.texture,
				}),
			],
			renderCoverage: "classified-render-deferred",
			renderSurface: null,
			role: role.role,
			texture: role.texture,
			tiling: role.tiling,
		};
	}

	return {
		dataUse: {
			kind: "prepared-render-surface-texture-use",
			renderSurface,
			usage: "rgba-detail",
		},
		fadeFar: role.fadeFar,
		fadeNear: role.fadeNear,
		fallbackReasons: [],
		renderCoverage: "classified-render-candidate",
		renderSurface,
		role: role.role,
		texture: role.texture,
		tiling: role.tiling,
	};
}
