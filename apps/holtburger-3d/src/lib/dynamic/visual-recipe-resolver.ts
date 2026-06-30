import type {
	DynamicEntityRecipe,
	DynamicEntityRecipeSource,
	DynamicEntityAnimationSelection,
	DynamicEntityAppearanceOverride,
	DynamicVisualMaterialPolicy,
	DynamicEntityTransformState,
} from "./contracts";

export interface DynamicVisualRecipeResolutionRequest {
	readonly animationSelection: DynamicEntityAnimationSelection;
	readonly baseTransform: DynamicEntityTransformState;
	readonly materialPolicy: DynamicVisualMaterialPolicy;
	readonly modelData: DynamicEntityAppearanceOverride | null;
	readonly setupModelId: number;
	readonly source: DynamicEntityRecipeSource;
}

export interface DynamicVisualRecipeResolver {
	resolveRecipe(
		request: DynamicVisualRecipeResolutionRequest,
	): Promise<DynamicEntityRecipe>;
}
