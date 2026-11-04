import { z } from "zod";

import type { DatAssetId } from "../game/game-types";
import type { AnimationAssetSource } from "./animation-asset-source";
import { decodeAnimationRecord } from "./decode-animation-record";
import type { HostTransport } from "../host/host-transport";
import { asHostBinary } from "../host/binary-response";

/** Host adapter for typed immutable animation records. */
export class AnimationHostSource implements AnimationAssetSource {
	readonly #transport: HostTransport;
	#destroyed = false;

	protected constructor(transport: HostTransport) {
		this.#transport = transport;
	}

	static build(transport: HostTransport): AnimationHostSource {
		return new AnimationHostSource(transport);
	}

	async loadAnimation(animationId: DatAssetId) {
		if (this.#destroyed)
			throw new Error("Cannot load animation from a destroyed host source.");
		const response = await this.#transport.invoke("load_animation", {
			request: { animationId },
		});
		return decodeAnimationRecord(
			asHostBinary(response, "Animation host command"),
			animationId,
		);
	}

	async loadMotionTableClosure(
		motionTableId: DatAssetId,
	): Promise<DatAssetId[]> {
		if (this.#destroyed)
			throw new Error(
				"Cannot load a motion closure from a destroyed host source.",
			);
		const response = await this.#transport.invoke("load_motion_table_closure", {
			request: { motionTableId },
		});
		return motionTableClosureSchema.parse(response) as DatAssetId[];
	}

	destroy(): void {
		this.#destroyed = true;
	}
}

const motionTableClosureSchema = z.array(z.string().regex(/^0x[0-9a-f]{8}$/i));
