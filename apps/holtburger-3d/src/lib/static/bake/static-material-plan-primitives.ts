import type {
	PaletteIdentity,
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

export function createStaticMaterialSourceKey(
	material: StaticMaterialSourceIdentity,
): string {
	return formatHex32(material.materialId);
}

export function findStaticSurfaceTextureRef(
	textureRefs: readonly StaticObjectTextureRefFacts[],
	texture: SurfaceTextureIdentity,
): Extract<
	StaticObjectTextureRefFacts,
	{ readonly role: "surface-texture" }
> | null {
	return (
		textureRefs.find(
			(
				ref,
			): ref is Extract<
				StaticObjectTextureRefFacts,
				{ readonly role: "surface-texture" }
			> =>
				ref.role === "surface-texture" &&
				ref.texture.surfaceTextureId === texture.surfaceTextureId,
		) ?? null
	);
}

export function findStaticRenderSurfaceRef(
	textureRefs: readonly StaticObjectTextureRefFacts[],
	renderSurface: RenderSurfaceIdentity,
): Extract<
	StaticObjectTextureRefFacts,
	{ readonly role: "render-surface" }
> | null {
	return (
		textureRefs.find(
			(
				ref,
			): ref is Extract<
				StaticObjectTextureRefFacts,
				{ readonly role: "render-surface" }
			> =>
				ref.role === "render-surface" &&
				ref.renderSurface.renderSurfaceId === renderSurface.renderSurfaceId,
		) ?? null
	);
}

export function createStaticMaterialBucketKey(options: {
	readonly family: StaticMaterialPlan["family"];
	readonly material: StaticMaterialSourceIdentity;
	readonly pass: StaticMaterialPlan["pass"];
	readonly alphaPolicy: StaticMaterialPlan["alphaPolicy"]["mode"];
	readonly textureRoles: readonly StaticMaterialTextureUseRole[];
}): string {
	return [
		`family:${options.family}`,
		"domain:static-objects",
		`pass:${options.pass}`,
		`alpha:${options.alphaPolicy}`,
		`material:${formatHex32(options.material.materialId)}`,
		`roles:${createStaticTextureRoleSignature(options.textureRoles)}`,
	].join("|");
}

export function createStaticMaterialFallbackReason(options: {
	readonly code: StaticMaterialFallbackReason["code"];
	readonly message: string;
	readonly material?: StaticMaterialSourceIdentity | null;
	readonly texture?: SurfaceTextureIdentity | null;
	readonly renderSurface?: RenderSurfaceIdentity | null;
	readonly palette?: PaletteIdentity | null;
}): StaticMaterialFallbackReason {
	return {
		code: options.code,
		material: options.material ?? null,
		message: options.message,
		palette: options.palette ?? null,
		renderSurface: options.renderSurface ?? null,
		texture: options.texture ?? null,
	};
}

function createStaticTextureRoleSignature(
	roles: readonly StaticMaterialTextureUseRole[],
): string {
	if (roles.length === 0) {
		return "none";
	}

	return roles
		.map((role) => `${role.role}:${createTextureRoleDataUseSignature(role)}`)
		.join(",");
}

function createTextureRoleDataUseSignature(
	role: StaticMaterialTextureUseRole,
): string {
	const detailSuffix =
		role.role === "detail-overlay" ? `:tiling=${role.tiling}` : "";
	if (role.dataUse.kind === "palette-texture-use") {
		return (
			[
				formatHex32(role.dataUse.palette.paletteId),
				`${role.dataUse.firstIndex}-${role.dataUse.indexCount}`,
				role.dataUse.usage,
			].join(":") + detailSuffix
		);
	}

	return (
		[
			formatHex32(role.dataUse.renderSurface.renderSurfaceId),
			role.dataUse.usage,
		].join(":") + detailSuffix
	);
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}
