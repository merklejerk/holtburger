import { type Material, type Texture } from "three";

import type {
	AssetChannelState,
	PreparedRegionDetailRole,
	PreparedRenderSurfacePayload,
	PreparedSurfaceTexturePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import type { WorldMaterialResourceCache } from "./material-resources";

export type RegionDetailRoleKind =
	| "landscape"
	| "building"
	| "environment"
	| "object";

export interface ResolvedRegionDetailOverlay {
	regionNumber: number;
	profileAssetId: string;
	role: PreparedRegionDetailRole;
	texture: Texture;
	signature: string;
}

interface DetailOverlayShader {
	uniforms: Record<string, { value: unknown }>;
	fragmentShader: string;
}

const REGION_DETAIL_PROGRAM_KEY = "holtburger-region-detail-overlay";

export function resolveRegionDetailOverlay(options: {
	assetState: AssetChannelState;
	regionNumber: number;
	roleKind: RegionDetailRoleKind;
	materialResourceCache: WorldMaterialResourceCache;
	reportDiagnostic: (message: string) => void;
}): ResolvedRegionDetailOverlay | null {
	const normalizedRegionNumber = Math.trunc(options.regionNumber);
	const profileAssetId = `region-render-profile/${normalizedRegionNumber}`;
	const profileRecord = options.assetState.preparedByAssetId[profileAssetId];
	const profile =
		profileRecord?.payload.kind === "region-render-profile"
			? profileRecord.payload
			: null;
	if (!profile) {
		options.reportDiagnostic(
			`Missing region render profile ${profileAssetId}; ${options.roleKind} detail disabled.`,
		);
		return null;
	}
	if (profile.regionNumber !== normalizedRegionNumber) {
		options.reportDiagnostic(
			`Region render profile ${profileAssetId} reports region ${profile.regionNumber}; ${options.roleKind} detail disabled.`,
		);
		return null;
	}

	const role = profile.detailRoles[options.roleKind];
	if (!role) {
		options.reportDiagnostic(
			`Region render profile ${profileAssetId} has no ${options.roleKind} detail role.`,
		);
		return null;
	}
	if (role.tiling <= 0) {
		options.reportDiagnostic(
			`Invalid ${options.roleKind} detail tiling ${role.tiling} for ${role.textureAssetId}.`,
		);
		return null;
	}
	if (role.fadeFar <= role.fadeNear) {
		options.reportDiagnostic(
			`Invalid ${options.roleKind} detail fade range ${role.fadeNear}-${role.fadeFar} for ${role.textureAssetId}.`,
		);
		return null;
	}

	const texture = resolveRegionDetailTexture({
		roleKind: options.roleKind,
		role,
		assetState: options.assetState,
		materialResourceCache: options.materialResourceCache,
		reportDiagnostic: options.reportDiagnostic,
	});
	return texture
		? {
				regionNumber: normalizedRegionNumber,
				profileAssetId,
				role,
				texture,
				signature: describeRegionDetailOverlaySignature(
					normalizedRegionNumber,
					options.roleKind,
					role,
				),
			}
		: null;
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
	return role
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
		},
	};
	return clone;
}

function resolveRegionDetailTexture(options: {
	roleKind: RegionDetailRoleKind;
	role: PreparedRegionDetailRole;
	assetState: AssetChannelState;
	materialResourceCache: WorldMaterialResourceCache;
	reportDiagnostic: (message: string) => void;
}): Texture | null {
	const surfaceTexture = getSurfaceTexture(
		options.assetState,
		options.role.textureAssetId,
	);
	if (!surfaceTexture) {
		options.reportDiagnostic(
			`Missing ${options.roleKind} detail surface texture ${options.role.textureAssetId}.`,
		);
		return null;
	}
	const renderSurface = getSelectedRenderSurface(
		options.assetState,
		surfaceTexture,
	);
	if (!renderSurface) {
		options.reportDiagnostic(
			`Missing selected render surface for ${options.roleKind} detail texture ${options.role.textureAssetId}.`,
		);
		return null;
	}
	const samplingPolicy =
		options.materialResourceCache.getDefaultTextureSamplingPolicy(
			renderSurface,
		);
	const texture = options.materialResourceCache.getTexture({
		renderSurface,
		samplingPolicy: {
			...samplingPolicy,
			wrapS: "repeat",
			wrapT: "repeat",
		},
	});
	if (!texture) {
		options.reportDiagnostic(
			`Could not upload ${options.roleKind} detail render surface ${formatHex32(renderSurface.renderSurfaceId)} for ${options.role.textureAssetId}.`,
		);
	}
	return texture;
}

function getSurfaceTexture(
	assetState: AssetChannelState,
	assetId: string,
): PreparedSurfaceTexturePayload | null {
	const record = assetState.preparedByAssetId[assetId];
	return record?.payload.kind === "surface-texture" ? record.payload : null;
}

function getSelectedRenderSurface(
	assetState: AssetChannelState,
	surfaceTexture: PreparedSurfaceTexturePayload,
): PreparedRenderSurfacePayload | null {
	if (surfaceTexture.selectedRenderSurfaceId === null) {
		return null;
	}
	const assetId = `render-surface/${formatHex32(surfaceTexture.selectedRenderSurfaceId)}`;
	const record = assetState.preparedByAssetId[assetId];
	return record?.payload.kind === "render-surface" ? record.payload : null;
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
	].join(":");
}

function regionDetailUniformDeclarations(): string {
	return `
uniform sampler2D holtburgerRegionDetailMap;
uniform float holtburgerRegionDetailTiling;
uniform float holtburgerRegionDetailFadeNear;
uniform float holtburgerRegionDetailFadeFar;
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
	vec4 holtburgerRegionDetailColor = texture2D(
		holtburgerRegionDetailMap,
		vMapUv * holtburgerRegionDetailTiling
	);
	diffuseColor.rgb = mix(
		diffuseColor.rgb,
		holtburgerRegionDetailColor.rgb,
		clamp(holtburgerRegionDetailColor.a * holtburgerRegionDetailFade, 0.0, 1.0)
	);
#endif
`;
}
