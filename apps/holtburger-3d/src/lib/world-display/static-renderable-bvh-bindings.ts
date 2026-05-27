import {
	envStaticBvhItemKey,
	outdoorStaticBvhItemKey,
	type RenderBvhItemKey,
} from "./prepared-bvh-visibility";
import type { StaticRenderablePart } from "./static-renderables";

export interface StaticRenderableBatchBvhBinding {
	batchId: string;
	itemKeys: readonly RenderBvhItemKey[];
	fallbackReason: string | null;
}

export function staticRenderableBatchId(groupKey: string): string {
	return `static-renderable:${groupKey}`;
}

export function deriveStaticRenderableBatchBvhBinding(
	groupKey: string,
	parts: readonly StaticRenderablePart[],
): StaticRenderableBatchBvhBinding {
	const itemKeys = new Set<RenderBvhItemKey>();
	for (const part of parts) {
		const itemKey = deriveStaticRenderablePartBvhItemKey(part);
		if (!itemKey) {
			return {
				batchId: staticRenderableBatchId(groupKey),
				itemKeys: [],
				fallbackReason: `static render batch ${groupKey} contains an unkeyed ${part.kind} part`,
			};
		}
		itemKeys.add(itemKey);
	}

	return {
		batchId: staticRenderableBatchId(groupKey),
		itemKeys: [...itemKeys],
		fallbackReason: itemKeys.size === 0
			? `static render batch ${groupKey} contains no parts`
			: null,
	};
}

export function deriveStaticRenderablePartBvhItemKey(
	part: StaticRenderablePart,
): RenderBvhItemKey | null {
	if (part.kind === "indoor-static") {
		return part.owningEnvCellId === null
			? null
			: envStaticBvhItemKey(part.owningEnvCellId, part.instanceId);
	}

	return outdoorStaticBvhItemKey(part.owningLandblockId, part.instanceId);
}
