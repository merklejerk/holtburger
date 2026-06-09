import { formatHex32 } from "../landblocks";

export function formatMaterialAssetId(surfaceId: number): string {
	return `material/${formatHex32(surfaceId)}`;
}
