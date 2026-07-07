import type {
	PaletteIdentity,
	RenderSurfaceIdentity,
	StaticMaterialSourceIdentity,
	StaticObjectTextureRefFacts,
	SurfaceTextureIdentity,
} from "../contracts";
import type {
	ObjectVisualMaterialFallbackReason,
	ObjectVisualMaterialPlan,
	ObjectVisualMaterialTextureUseRole,
} from "../../visual/object-visual-material-planner";

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
	readonly family: ObjectVisualMaterialPlan["family"];
	readonly material: StaticMaterialSourceIdentity;
	readonly pass: ObjectVisualMaterialPlan["pass"];
	readonly alphaPolicy: ObjectVisualMaterialPlan["alphaPolicy"]["mode"];
	readonly textureRoles: readonly ObjectVisualMaterialTextureUseRole[];
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

export function createObjectVisualMaterialFallbackReason(options: {
	readonly code: ObjectVisualMaterialFallbackReason["code"];
	readonly message: string;
	readonly material?: StaticMaterialSourceIdentity | null;
	readonly texture?: SurfaceTextureIdentity | null;
	readonly renderSurface?: RenderSurfaceIdentity | null;
	readonly palette?: PaletteIdentity | null;
}): ObjectVisualMaterialFallbackReason {
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
	roles: readonly ObjectVisualMaterialTextureUseRole[],
): string {
	if (roles.length === 0) {
		return "none";
	}

	return roles
		.map((role) => `${role.role}:${createTextureRoleDataUseSignature(role)}`)
		.join(",");
}

function createTextureRoleDataUseSignature(
	role: ObjectVisualMaterialTextureUseRole,
): string {
	const detailSuffix =
		role.role === "detail-overlay" ? `:tiling=${role.tiling}` : "";
	if (role.dataUse.kind === "prepared-palette-texture-use") {
		return (
			[
				formatHex32(role.dataUse.palette.paletteId),
				role.dataUse.domain,
				createPreparedPaletteReplacementsSignature(role.dataUse.replacements),
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

function createPreparedPaletteReplacementsSignature(
	replacements: readonly {
		readonly palette: { readonly paletteId: number };
		readonly offset: number;
		readonly count: number;
	}[],
): string {
	if (replacements.length === 0) {
		return "repl:none";
	}
	return [
		"repl",
		...replacements.map(
			(replacement) =>
				`${formatHex32(replacement.palette.paletteId)}@${replacement.offset}+${replacement.count}`,
		),
	].join(":");
}

function formatHex32(value: number): string {
	return value.toString(16).padStart(8, "0");
}
