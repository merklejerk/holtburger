import type {
	DynamicVisualBakeInput,
	DynamicVisualBakeResult,
} from "./contracts";

export interface DynamicVisualBaker {
	bake(input: DynamicVisualBakeInput): Promise<DynamicVisualBakeResult>;
}
