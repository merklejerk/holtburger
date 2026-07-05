import type { TextureBindingId } from "../../textures/identity";
import type {
	ResolvedTexturePlacement,
	TexturePlacementUpdate,
} from "../types";

export type RendererTextureBindingState =
	| {
			readonly kind: "pending";
			readonly bindingId: TextureBindingId;
	  }
	| {
			readonly kind: "resident";
			readonly bindingId: TextureBindingId;
			readonly placement: ResolvedTexturePlacement;
	  }
	| {
			readonly kind: "failed";
			readonly bindingId: TextureBindingId;
			readonly reason: string;
	  };

export interface ResidentRendererTextureBinding {
	readonly bindingId: TextureBindingId;
	readonly placement: ResolvedTexturePlacement;
	readonly texture: WebGLTexture;
}

export interface RendererTextureBindingTableChange {
	readonly changed: boolean;
}

interface RendererTextureBindingTableTextureOperations {
	readonly createTexture: (
		placement: TexturePlacementUpdate["placements"][number],
	) => WebGLTexture;
	readonly deleteTexture: (texture: WebGLTexture) => void;
}

export class Webgl2RendererTextureBindingTable {
	readonly #states = new Map<TextureBindingId, RendererTextureBindingState>();
	readonly #textures = new Map<string, WebGLTexture>();

	getState(bindingId: TextureBindingId): RendererTextureBindingState {
		return this.#states.get(bindingId) ?? { bindingId, kind: "pending" };
	}

	getResident(
		bindingId: TextureBindingId,
	): ResidentRendererTextureBinding | null {
		const state = this.getState(bindingId);
		if (state.kind !== "resident") {
			return null;
		}
		const texture = this.#textures.get(state.placement.textureRefId);
		if (!texture) {
			return null;
		}
		return {
			bindingId,
			placement: state.placement,
			texture,
		};
	}

	getTexture(textureRefId: string): WebGLTexture | null {
		return this.#textures.get(textureRefId) ?? null;
	}

	applyPlacementUpdate(
		update: TexturePlacementUpdate,
		operations: RendererTextureBindingTableTextureOperations,
	): RendererTextureBindingTableChange {
		let changed = false;

		for (const textureRefId of update.removedTextureRefIds) {
			const texture = this.#textures.get(textureRefId);
			if (texture) {
				operations.deleteTexture(texture);
				this.#textures.delete(textureRefId);
				changed = true;
			}
			changed = this.#markTextureRefPending(textureRefId) || changed;
		}

		for (const placement of update.placements) {
			const texture = operations.createTexture(placement);
			const previousTexture = this.#textures.get(placement.textureRefId);
			if (previousTexture) {
				operations.deleteTexture(previousTexture);
			}
			this.#textures.set(placement.textureRefId, texture);
			changed = true;
		}

		for (const placement of update.resolvedTexturePlacements) {
			this.#states.set(placement.bindingId, {
				bindingId: placement.bindingId,
				kind: "resident",
				placement,
			});
			changed = true;
		}

		return { changed };
	}

	markFailed(bindingId: TextureBindingId, reason: string): void {
		this.#states.set(bindingId, { bindingId, kind: "failed", reason });
	}

	clear(
		operations: Pick<
			RendererTextureBindingTableTextureOperations,
			"deleteTexture"
		>,
	): void {
		for (const texture of this.#textures.values()) {
			operations.deleteTexture(texture);
		}
		this.#textures.clear();
		this.#states.clear();
	}

	#markTextureRefPending(textureRefId: string): boolean {
		let changed = false;
		for (const [bindingId, state] of this.#states) {
			if (
				state.kind === "resident" &&
				state.placement.textureRefId === textureRefId
			) {
				this.#states.set(bindingId, { bindingId, kind: "pending" });
				changed = true;
			}
		}
		return changed;
	}
}
