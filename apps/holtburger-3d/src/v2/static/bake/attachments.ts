import type { StaticBakeBatchAttachments } from "../contracts";

export function createEmptyStaticBakeAttachments(): StaticBakeBatchAttachments {
	return { staticObjectSourceGeometry: [] };
}
