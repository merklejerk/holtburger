import type { ActiveRegionSource } from "../../assets/active-region-source";
import type { TexturePixelSource } from "../../assets/texture-pixel-source";
import type { DatAssetId } from "../game-types";
import { resolveActiveRegionTerrainPresentation } from "../terrain/active-region-terrain-resolver";
import {
	createAssetTextureKey,
	TexturePixelFormat,
	TexturePurpose,
	type AssetTextureKey,
} from "../textures/types";
import type { PreparedTextureSurface } from "../textures/texture-preparer";
import {
	STATIC_DETAIL_ROLES,
	type StaticDetailRole,
} from "./static-detail-role";

/** One regional static-detail texture and tiling binding selected by semantic role. */
interface ActiveRegionStaticDetailRoleBinding {
	readonly key: AssetTextureKey;
	readonly role: StaticDetailRole;
	readonly sourceAssetId: DatAssetId;
	readonly surface: PreparedTextureSurface;
	readonly tiling: number;
}

/** Complete static-detail payload owned by one active-region generation. */
export interface ActiveRegionStaticDetailBinding {
	readonly activeRegionKey: string;
	readonly roles: Readonly<
		Record<StaticDetailRole, ActiveRegionStaticDetailRoleBinding>
	>;
}

/**
 * Owns building, environment, and object detail payloads independently of landblock resources.
 *
 * CPU preparation happens once per active-region generation. The runtime promotes the complete
 * role set into device ownership without adding regional textures to per-landblock atlas jobs.
 */
export class ActiveRegionStaticDetailOwner {
	readonly #pixelSource: TexturePixelSource;
	#binding: ActiveRegionStaticDetailBinding | null = null;
	#pending: {
		readonly activeRegionKey: string;
		readonly promise: Promise<ActiveRegionStaticDetailBinding>;
	} | null = null;
	/** Invalidates a late request when a region is replaced or the owner tears down. */
	#generation = 0;

	constructor(pixelSource: TexturePixelSource) {
		this.#pixelSource = pixelSource;
	}

	/** Install or reuse one complete active-region static-detail payload. */
	install(
		activeRegion: ActiveRegionSource,
	): Promise<ActiveRegionStaticDetailBinding> {
		const activeRegionKey = `${activeRegion.provenance.sourceRecordId}@${activeRegion.provenance.version}`;
		if (this.#binding?.activeRegionKey === activeRegionKey) {
			return Promise.resolve(this.#binding);
		}
		if (this.#pending?.activeRegionKey === activeRegionKey) {
			return this.#pending.promise;
		}
		const generation = ++this.#generation;
		const promise = this.#prepare(activeRegion, activeRegionKey).then(
			(binding) => {
				if (this.#generation !== generation) {
					throw new Error(
						"Active-region static-detail request was superseded.",
					);
				}
				this.#binding = binding;
				return binding;
			},
		);
		const pending = { activeRegionKey, promise };
		this.#pending = pending;
		return promise.finally(() => {
			if (this.#pending === pending) this.#pending = null;
		});
	}

	/** Current complete binding; absent until every required role is prepared. */
	get binding(): ActiveRegionStaticDetailBinding | null {
		return this.#binding;
	}

	/** Release active-region-owned CPU payloads before replacement or destruction. */
	teardown(): void {
		this.#generation += 1;
		this.#binding = null;
	}

	async #prepare(
		activeRegion: ActiveRegionSource,
		activeRegionKey: string,
	): Promise<ActiveRegionStaticDetailBinding> {
		const sourceRoles = new Map(
			resolveActiveRegionTerrainPresentation(activeRegion).detailRoles.map(
				(detail) => [detail.role, detail] as const,
			),
		);
		const details = STATIC_DETAIL_ROLES.map((role) => {
			const detail = sourceRoles.get(role);
			if (!detail) {
				throw new Error(
					`Installed active region has no ${role} detail texture role.`,
				);
			}
			return { detail, role };
		});
		const prepared = await Promise.all(
			details.map(async ({ detail, role }) => {
				const sourceAssetId = detail.textureId;
				const response = await this.#pixelSource.loadTexturePixels({
					kind: "prepared-object-texture",
					purpose: TexturePurpose.ObjectDetail,
					sourceAssetId,
				});
				if (
					response.kind !== "prepared-object-texture" ||
					response.purpose !== TexturePurpose.ObjectDetail ||
					response.surface.sourceAssetId !== sourceAssetId ||
					response.surface.format !== TexturePixelFormat.RGBA8
				) {
					throw new Error(
						`Host returned an incompatible active-region ${role} detail texture.`,
					);
				}
				return {
					key: createAssetTextureKey(
						TexturePurpose.ObjectDetail,
						sourceAssetId,
					),
					role,
					sourceAssetId,
					surface: response.surface,
					tiling: detail.tiling,
				};
			}),
		);
		const roles = Object.fromEntries(
			prepared.map((binding) => [binding.role, binding]),
		) as Record<StaticDetailRole, ActiveRegionStaticDetailRoleBinding>;
		return { activeRegionKey, roles };
	}
}
