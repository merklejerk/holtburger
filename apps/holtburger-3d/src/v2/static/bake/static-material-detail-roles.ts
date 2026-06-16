import type {
	PreparedRgbaRenderSurfaceTextureUseIdentity,
	RegionDetailRoleFacts,
	RenderSurfaceIdentity,
	StaticMaterialSourceIdentity,
	StaticObjectTextureRefFacts,
	SurfaceTextureIdentity,
} from "../contracts";
import type {
	StaticMaterialFallbackReason,
	StaticMaterialPlan,
	StaticMaterialTextureUseRole,
} from "../objects/bake/static-object-material-planner";
import { createMaterialTextureDataUseKey } from "./static-material-texture-policy";

export type StaticMaterialDetailRoleDomain =
	| "outdoor-buildings"
	| "outdoor-detail"
	| "landblock-env-cells";

export interface StaticMaterialDetailRolePlan {
	readonly role: RegionDetailRoleFacts["role"];
	readonly texture: SurfaceTextureIdentity;
	readonly renderSurface: RenderSurfaceIdentity | null;
	readonly dataUse: PreparedRgbaRenderSurfaceTextureUseIdentity | null;
	readonly tiling: number;
	readonly fadeNear: number;
	readonly fadeFar: number;
	readonly renderCoverage:
		| "classified-render-candidate"
		| "classified-render-deferred";
	readonly fallbackReasons: readonly StaticMaterialFallbackReason[];
}

export function planStaticMaterialDetailRoles(options: {
	readonly detailRoles: readonly RegionDetailRoleFacts[];
	readonly textureRefs: readonly StaticObjectTextureRefFacts[];
}): readonly StaticMaterialDetailRolePlan[] {
	return options.detailRoles
		.filter((role) => role.role !== "landscape")
		.map((role) => createStaticMaterialDetailRolePlan(role, options.textureRefs));
}

export function composeStaticMaterialDetailRole(options: {
	readonly domain: StaticMaterialDetailRoleDomain;
	readonly detailRoles: readonly StaticMaterialDetailRolePlan[];
	readonly plan: StaticMaterialPlan;
}): StaticMaterialPlan {
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
				createFallbackReason({
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

	const textureRoles: readonly StaticMaterialTextureUseRole[] = [
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
		materialBucketKey: createMaterialBucketKey({
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
			: domain === "landblock-env-cells"
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
				createFallbackReason({
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

	const textureRef = findSurfaceTextureRef(textureRefs, role.texture);
	const renderSurface = textureRef?.renderSurface ?? null;
	if (!renderSurface || !findRenderSurfaceRef(textureRefs, renderSurface)) {
		return {
			dataUse: null,
			fadeFar: role.fadeFar,
			fadeNear: role.fadeNear,
			fallbackReasons: [
				createFallbackReason({
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

function findSurfaceTextureRef(
	textureRefs: readonly StaticObjectTextureRefFacts[],
	texture: SurfaceTextureIdentity,
): StaticObjectTextureRefFacts | null {
	return (
		textureRefs.find(
			(ref) =>
				ref.role === "surface-texture" &&
				ref.texture.surfaceTextureId === texture.surfaceTextureId,
		) ?? null
	);
}

function findRenderSurfaceRef(
	textureRefs: readonly StaticObjectTextureRefFacts[],
	renderSurface: RenderSurfaceIdentity,
): StaticObjectTextureRefFacts | null {
	return (
		textureRefs.find(
			(ref) =>
				ref.role === "render-surface" &&
				ref.renderSurface?.renderSurfaceId === renderSurface.renderSurfaceId,
		) ?? null
	);
}

function createMaterialBucketKey(options: {
	readonly family: StaticMaterialPlan["family"];
	readonly material: StaticMaterialSourceIdentity;
	readonly textureRoles: readonly StaticMaterialTextureUseRole[];
	readonly alphaPolicy: StaticMaterialPlan["alphaPolicy"]["mode"];
	readonly pass: StaticMaterialPlan["pass"];
}): string {
	return [
		options.family,
		options.pass,
		options.alphaPolicy,
		createMaterialSourceKey(options.material),
		options.textureRoles
			.map((role) => createMaterialTextureDataUseKey(role.dataUse))
			.join(","),
	].join("|");
}

function createMaterialSourceKey(material: StaticMaterialSourceIdentity): string {
	return `${material.materialId}`;
}

function createFallbackReason(options: {
	readonly code: StaticMaterialFallbackReason["code"];
	readonly message: string;
	readonly material?: StaticMaterialSourceIdentity | null;
	readonly texture?: SurfaceTextureIdentity | null;
	readonly renderSurface?: RenderSurfaceIdentity | null;
}): StaticMaterialFallbackReason {
	return {
		code: options.code,
		material: options.material ?? null,
		message: options.message,
		palette: null,
		renderSurface: options.renderSurface ?? null,
		texture: options.texture ?? null,
	};
}
