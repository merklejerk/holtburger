import type {
	StaticDrawUnit,
	StaticObjectRenderInstance,
	StaticObjectVisualResource,
} from "../static/contracts";
import type { TextureResourceDependencies } from "../textures/placement";
import type { DynamicAnimationPartBinding } from "./object-visual-recipe-bundle";

export type ObjectVisualDirectDrawUnit = Extract<
	StaticDrawUnit,
	{ readonly kind: "static-object-geometry" | "structured-interior-geometry" }
>;

export interface ObjectVisualInstallSet {
	/** Object-like draw units that are already renderer-ready and do not use resource instancing. */
	readonly directDrawUnits: readonly ObjectVisualDirectDrawUnit[];
	/** Source-part animation bindings for dynamic or dynamic-shaped object visuals. */
	readonly dynamicAnimationPartBindings: readonly DynamicAnimationPartBinding[];
	/** Per-instance placements for reusable object visual resources. */
	readonly renderInstances: readonly StaticObjectRenderInstance[];
	/** Texture dependencies pinned by renderer resource identity. */
	readonly textureDependencies: readonly TextureResourceDependencies[];
	/** Reusable object visual resources shared by one or more render instances. */
	readonly visualResources: readonly StaticObjectVisualResource[];
}

export function createEmptyObjectVisualInstallSet(): ObjectVisualInstallSet {
	return {
		directDrawUnits: [],
		dynamicAnimationPartBindings: [],
		renderInstances: [],
		textureDependencies: [],
		visualResources: [],
	};
}

export function createObjectVisualInstallSet(input: {
	readonly directDrawUnits?: readonly ObjectVisualDirectDrawUnit[];
	readonly dynamicAnimationPartBindings?: readonly DynamicAnimationPartBinding[];
	readonly renderInstances?: readonly StaticObjectRenderInstance[];
	readonly textureDependencies?: readonly TextureResourceDependencies[];
	readonly visualResources?: readonly StaticObjectVisualResource[];
}): ObjectVisualInstallSet {
	return {
		directDrawUnits: input.directDrawUnits ?? [],
		dynamicAnimationPartBindings: input.dynamicAnimationPartBindings ?? [],
		renderInstances: input.renderInstances ?? [],
		textureDependencies: input.textureDependencies ?? [],
		visualResources: input.visualResources ?? [],
	};
}
