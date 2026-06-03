import { type Material, type Texture } from "three";

import type {
	AssetChannelState,
	PreparedRegionDetailRole,
	PreparedRenderSurfacePayload,
	PreparedSurfaceTexturePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";

export type RegionDetailRoleKind =
	| "landscape"
	| "building"
	| "environment"
	| "object";

type RegionDetailBlendMode = "src-alpha" | "dst-color";
type RegionDetailFadeMode = "distance" | "constant";

export interface ResolvedRegionDetailOverlayPlan {
	regionNumber: number;
	profileAssetId: string;
	roleKind: RegionDetailRoleKind;
	role: PreparedRegionDetailRole;
	blendMode: RegionDetailBlendMode;
	fadeMode: RegionDetailFadeMode;
	renderSurface: PreparedRenderSurfacePayload;
	signature: string;
}

export interface ResolvedRegionDetailOverlay {
	regionNumber: number;
	profileAssetId: string;
	role: PreparedRegionDetailRole;
	blendMode: RegionDetailBlendMode;
	fadeMode: RegionDetailFadeMode;
	texture: Texture;
	signature: string;
}

interface DetailOverlayShader {
	uniforms: Record<string, { value: unknown }>;
	fragmentShader: string;
}

const REGION_DETAIL_PROGRAM_KEY = "holtburger-region-detail-overlay";

export function resolveRegionDetailOverlayPlan(options: {
	assetState: AssetChannelState;
	regionNumber: number;
	roleKind: RegionDetailRoleKind;
	reportDiagnostic?: (message: string) => void;
}): ResolvedRegionDetailOverlayPlan | null {
	const normalizedRegionNumber = Math.trunc(options.regionNumber);
	const blendMode = regionDetailBlendModeForRole(options.roleKind);
	if (!blendMode) {
		return null;
	}
	const fadeMode = regionDetailFadeModeForRole(options.roleKind);
	const profileAssetId = `region-render-profile/${normalizedRegionNumber}`;
	const profileRecord = options.assetState.preparedByAssetId[profileAssetId];
	const profile =
		profileRecord?.payload.kind === "region-render-profile"
			? profileRecord.payload
			: null;
	if (!profile) {
		options.reportDiagnostic?.(
			`Missing region render profile ${profileAssetId}; ${options.roleKind} detail disabled.`,
		);
		return null;
	}
	if (profile.regionNumber !== normalizedRegionNumber) {
		options.reportDiagnostic?.(
			`Region render profile ${profileAssetId} reports region ${profile.regionNumber}; ${options.roleKind} detail disabled.`,
		);
		return null;
	}

	const role = profile.detailRoles[options.roleKind];
	if (!role) {
		options.reportDiagnostic?.(
			`Region render profile ${profileAssetId} has no ${options.roleKind} detail role.`,
		);
		return null;
	}
	if (role.tiling <= 0) {
		options.reportDiagnostic?.(
			`Invalid ${options.roleKind} detail tiling ${role.tiling} for ${role.textureAssetId}.`,
		);
		return null;
	}
	if (role.fadeFar <= role.fadeNear) {
		options.reportDiagnostic?.(
			`Invalid ${options.roleKind} detail fade range ${role.fadeNear}-${role.fadeFar} for ${role.textureAssetId}.`,
		);
		return null;
	}
	const surfaceTexture = getSurfaceTexture(
		options.assetState,
		role.textureAssetId,
	);
	if (!surfaceTexture) {
		options.reportDiagnostic?.(
			`Missing ${options.roleKind} detail surface texture ${role.textureAssetId}.`,
		);
		return null;
	}
	const renderSurface = getSelectedRenderSurface({
		assetState: options.assetState,
		surfaceTexture,
	});
	if (!renderSurface) {
		options.reportDiagnostic?.(
			`Missing selected render surface for ${options.roleKind} detail texture ${role.textureAssetId}.`,
		);
		return null;
	}
	return {
		regionNumber: normalizedRegionNumber,
		profileAssetId,
		roleKind: options.roleKind,
		role,
		blendMode,
		fadeMode,
		renderSurface,
		signature: describeRegionDetailOverlaySignature(
			normalizedRegionNumber,
			options.roleKind,
			role,
		),
	};
}

export function describeRegionDetailRoleSignature(options: {
	assetState: AssetChannelState;
	regionNumber: number;
	roleKind: RegionDetailRoleKind;
}): string {
	const normalizedRegionNumber = Math.trunc(options.regionNumber);
	const profileAssetId = `region-render-profile/${normalizedRegionNumber}`;
	const profileRecord = options.assetState.preparedByAssetId[profileAssetId];
	const profile =
		profileRecord?.payload.kind === "region-render-profile"
			? profileRecord.payload
			: null;
	const role =
		profile?.regionNumber === normalizedRegionNumber
			? profile.detailRoles[options.roleKind]
			: null;
	const blendMode = regionDetailBlendModeForRole(options.roleKind);
	return role && blendMode
		? describeRegionDetailOverlaySignature(
				normalizedRegionNumber,
				options.roleKind,
				role,
			)
		: `detail:${normalizedRegionNumber}:${options.roleKind}:none`;
}

export function applyRegionDetailOverlayToMaterials(options: {
	materials: readonly Material[];
	overlay: ResolvedRegionDetailOverlay | null;
}): { materials: Material[]; ownedByResourceCache: boolean } {
	if (!options.overlay) {
		return { materials: [...options.materials], ownedByResourceCache: true };
	}
	const overlay = options.overlay;
	return {
		materials: options.materials.map((material) =>
			createRegionDetailOverlayMaterial(material, overlay),
		),
		ownedByResourceCache: false,
	};
}

function createRegionDetailOverlayMaterial(
	material: Material,
	overlay: ResolvedRegionDetailOverlay,
): Material {
	const clone = material.clone();
	const previousOnBeforeCompile = material.onBeforeCompile.bind(clone);
	const previousCustomProgramCacheKey =
		material.customProgramCacheKey.bind(material);
	clone.onBeforeCompile = (...args) => {
		previousOnBeforeCompile(...args);
		const shader = args[0] as DetailOverlayShader;
		shader.uniforms.holtburgerRegionDetailMap = { value: overlay.texture };
		shader.uniforms.holtburgerRegionDetailTiling = {
			value: overlay.role.tiling,
		};
		shader.uniforms.holtburgerRegionDetailFadeNear = {
			value: overlay.role.fadeNear,
		};
		shader.uniforms.holtburgerRegionDetailFadeFar = {
			value: overlay.role.fadeFar,
		};
		shader.uniforms.holtburgerRegionDetailBlendMode = {
			value: overlay.blendMode === "dst-color" ? 1 : 0,
		};
		shader.uniforms.holtburgerRegionDetailFadeMode = {
			value: overlay.fadeMode === "distance" ? 1 : 0,
		};
		shader.fragmentShader = shader.fragmentShader.replace(
			"void main() {",
			`${regionDetailUniformDeclarations()}\nvoid main() {`,
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			"#include <color_fragment>",
			`${regionDetailFragmentChunk()}\n#include <color_fragment>`,
		);
	};
	clone.customProgramCacheKey = () =>
		`${previousCustomProgramCacheKey()}|${REGION_DETAIL_PROGRAM_KEY}`;
	clone.userData = {
		...clone.userData,
		holtburgerRegionDetailOverlay: {
			regionNumber: overlay.regionNumber,
			role: overlay.role.role,
			textureAssetId: overlay.role.textureAssetId,
			textureDid: overlay.role.textureDid,
			tiling: overlay.role.tiling,
			fadeNear: overlay.role.fadeNear,
			fadeFar: overlay.role.fadeFar,
			blendMode: overlay.blendMode,
			fadeMode: overlay.fadeMode,
		},
	};
	return clone;
}

function getSurfaceTexture(
	assetState: AssetChannelState,
	assetId: string,
): PreparedSurfaceTexturePayload | null {
	const record = assetState.preparedByAssetId[assetId];
	return record?.payload.kind === "surface-texture" ? record.payload : null;
}

function getSelectedRenderSurface({
	assetState,
	surfaceTexture,
}: {
	assetState: AssetChannelState;
	surfaceTexture: PreparedSurfaceTexturePayload;
}): PreparedRenderSurfacePayload | null {
	const renderSurfaceIds = preferredDetailRenderSurfaceIds(surfaceTexture);
	for (const renderSurfaceId of renderSurfaceIds) {
		const assetId = `render-surface/${formatHex32(renderSurfaceId)}`;
		const record = assetState.preparedByAssetId[assetId];
		if (record?.payload.kind === "render-surface") {
			return record.payload;
		}
	}
	return null;
}

function preferredDetailRenderSurfaceIds(
	surfaceTexture: PreparedSurfaceTexturePayload,
): number[] {
	const sourceIds = surfaceTexture.renderSurfaceIds;
	const fallbackIds =
		surfaceTexture.selectedRenderSurfaceId === null
			? []
			: [surfaceTexture.selectedRenderSurfaceId];
	if (sourceIds.length <= 1) {
		return [...sourceIds, ...fallbackIds];
	}
	const highDetailDroppedIds = [
		sourceIds[1],
		...sourceIds.slice(2),
		sourceIds[0],
	].filter(
		(renderSurfaceId): renderSurfaceId is number =>
			renderSurfaceId !== undefined,
	);
	return [...highDetailDroppedIds, ...fallbackIds];
}

function describeRegionDetailOverlaySignature(
	regionNumber: number,
	roleKind: RegionDetailRoleKind,
	role: PreparedRegionDetailRole,
): string {
	return [
		"detail",
		regionNumber,
		roleKind,
		role.textureAssetId,
		role.tiling,
		role.fadeNear,
		role.fadeFar,
		regionDetailBlendModeForRole(roleKind) ?? "disabled",
		regionDetailFadeModeForRole(roleKind),
	].join(":");
}

function regionDetailBlendModeForRole(
	roleKind: RegionDetailRoleKind,
): RegionDetailBlendMode | null {
	if (roleKind === "landscape") {
		return "src-alpha";
	}
	if (roleKind === "building" || roleKind === "environment") {
		return "dst-color";
	}
	return null;
}

function regionDetailFadeModeForRole(
	roleKind: RegionDetailRoleKind,
): RegionDetailFadeMode {
	return roleKind === "landscape" ? "distance" : "constant";
}

function regionDetailUniformDeclarations(): string {
	return `
uniform sampler2D holtburgerRegionDetailMap;
uniform float holtburgerRegionDetailTiling;
uniform float holtburgerRegionDetailFadeNear;
uniform float holtburgerRegionDetailFadeFar;
uniform int holtburgerRegionDetailBlendMode;
uniform int holtburgerRegionDetailFadeMode;
`;
}

function regionDetailFragmentChunk(): string {
	return `
#ifdef USE_MAP
	float holtburgerRegionDetailDepth = length(vViewPosition);
	float holtburgerRegionDetailFade = clamp(
		(holtburgerRegionDetailFadeFar - holtburgerRegionDetailDepth) /
			(holtburgerRegionDetailFadeFar - holtburgerRegionDetailFadeNear),
		0.0,
		1.0
	);
	if (holtburgerRegionDetailFadeMode == 0) {
		holtburgerRegionDetailFade = 1.0;
	}
	vec4 holtburgerRegionDetailColor = texture2D(
		holtburgerRegionDetailMap,
		vMapUv * holtburgerRegionDetailTiling
	);
	float holtburgerRegionDetailWeight = holtburgerRegionDetailFade;
	vec3 holtburgerRegionDetailTarget = holtburgerRegionDetailColor.rgb;
	if (holtburgerRegionDetailBlendMode == 1) {
		float holtburgerRegionDetailSourceAlpha = clamp(
			holtburgerRegionDetailColor.a * holtburgerRegionDetailWeight,
			0.0,
			1.0
		);
		diffuseColor.rgb = clamp(
			diffuseColor.rgb *
				(holtburgerRegionDetailColor.rgb + (1.0 - holtburgerRegionDetailSourceAlpha)),
			0.0,
			1.0
		);
	} else {
		float holtburgerRegionDetailSourceAlpha = clamp(
			holtburgerRegionDetailColor.a * holtburgerRegionDetailWeight,
			0.0,
			1.0
		);
		diffuseColor.rgb = mix(
			diffuseColor.rgb,
			holtburgerRegionDetailTarget,
			holtburgerRegionDetailSourceAlpha
		);
	}
#endif
`;
}
