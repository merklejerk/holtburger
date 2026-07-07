import type { PreparedAssetReader } from "../assets/contracts";
import type {
	DynamicVisualBakeResult,
	DynamicVisualPrepInput,
} from "./contracts";
import { bakeDynamicVisuals } from "./visual-baker";
import { createDynamicVisualBakeSourceGeometry } from "./visual-bake-sidecars";

export interface DynamicVisualPrepper {
	prepare(input: DynamicVisualPrepInput): Promise<DynamicVisualBakeResult>;
}

export class LocalDynamicVisualPrepper implements DynamicVisualPrepper {
	readonly #assetReader: PreparedAssetReader;

	constructor(assetReader: PreparedAssetReader) {
		this.#assetReader = assetReader;
	}

	async prepare(input: DynamicVisualPrepInput): Promise<DynamicVisualBakeResult> {
		const sourceGeometry = await createDynamicVisualBakeSourceGeometry(
			this.#assetReader,
			[input.recipe],
		);
		return bakeDynamicVisuals({
			...input,
			sourceGeometry,
		});
	}
}
