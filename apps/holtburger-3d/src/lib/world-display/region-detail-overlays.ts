import type {
	PreparedRegionDetailRole,
	PreparedRenderSurfacePayload,
	PreparedSurfaceTexturePayload,
} from "../assets/types";
import { formatHex32 } from "../landblocks";
import type { RendererAssetReadModel } from "./renderer-asset-read-model";

export type RegionDetailRoleKind =
	| "landscape"
	| "building"
	| "environment"
	| "object";

export type RegionDetailBlendMode = "src-alpha" | "dst-color";
export type RegionDetailFadeMode = "distance" | "constant";

export interface RegionDetailRolePolicy {
	roleKind: RegionDetailRoleKind;
	blendMode: RegionDetailBlendMode;
	fadeMode: RegionDetailFadeMode;
}

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

export function resolveRegionDetailOverlayPlan(options: {
	assetReadModel: RendererAssetReadModel;
	regionNumber: number;
	roleKind: RegionDetailRoleKind;
	reportDiagnostic?: (message: string) => void;
}): ResolvedRegionDetailOverlayPlan | null {
	const normalizedRegionNumber = Math.trunc(options.regionNumber);
	const policy = resolveRegionDetailRolePolicy(options.roleKind);
	if (!policy) {
		return null;
	}
	const profileAssetId = `region-render-profile/${normalizedRegionNumber}`;
	const profileRecord = options.assetReadModel.get(profileAssetId);
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
		options.assetReadModel,
		role.textureAssetId,
	);
	if (!surfaceTexture) {
		options.reportDiagnostic?.(
			`Missing ${options.roleKind} detail surface texture ${role.textureAssetId}.`,
		);
		return null;
	}
	const renderSurface = getSelectedRenderSurface({
		assetReadModel: options.assetReadModel,
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
		blendMode: policy.blendMode,
		fadeMode: policy.fadeMode,
		renderSurface,
		signature: describeRegionDetailOverlaySignature(
			normalizedRegionNumber,
			options.roleKind,
			role,
		),
	};
}

export function describeRegionDetailRoleSignature(options: {
	assetReadModel: RendererAssetReadModel;
	regionNumber: number;
	roleKind: RegionDetailRoleKind;
}): string {
	const normalizedRegionNumber = Math.trunc(options.regionNumber);
	const profileAssetId = `region-render-profile/${normalizedRegionNumber}`;
	const profileRecord = options.assetReadModel.get(profileAssetId);
	const profile =
		profileRecord?.payload.kind === "region-render-profile"
			? profileRecord.payload
			: null;
	const role =
		profile?.regionNumber === normalizedRegionNumber
			? profile.detailRoles[options.roleKind]
			: null;
	const policy = resolveRegionDetailRolePolicy(options.roleKind);
	return role && policy
		? describeRegionDetailOverlaySignature(
				normalizedRegionNumber,
				options.roleKind,
				role,
			)
		: `detail:${normalizedRegionNumber}:${options.roleKind}:none`;
}

function getSurfaceTexture(
	assetReadModel: RendererAssetReadModel,
	assetId: string,
): PreparedSurfaceTexturePayload | null {
	const record = assetReadModel.get(assetId);
	return record?.payload.kind === "surface-texture" ? record.payload : null;
}

function getSelectedRenderSurface({
	assetReadModel,
	surfaceTexture,
}: {
	assetReadModel: RendererAssetReadModel;
	surfaceTexture: PreparedSurfaceTexturePayload;
}): PreparedRenderSurfacePayload | null {
	const renderSurfaceIds = preferredDetailRenderSurfaceIds(surfaceTexture);
	for (const renderSurfaceId of renderSurfaceIds) {
		const assetId = `render-surface/${formatHex32(renderSurfaceId)}`;
		const record = assetReadModel.get(assetId);
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
		resolveRegionDetailRolePolicy(roleKind)?.blendMode ?? "disabled",
		resolveRegionDetailRolePolicy(roleKind)?.fadeMode ?? "disabled",
	].join(":");
}

export function resolveRegionDetailRolePolicy(
	roleKind: RegionDetailRoleKind,
): RegionDetailRolePolicy | null {
	if (roleKind === "landscape") {
		return {
			roleKind,
			blendMode: "src-alpha",
			fadeMode: "distance",
		};
	}
	if (roleKind === "building" || roleKind === "environment") {
		return {
			roleKind,
			blendMode: "dst-color",
			fadeMode: "constant",
		};
	}
	return null;
}
