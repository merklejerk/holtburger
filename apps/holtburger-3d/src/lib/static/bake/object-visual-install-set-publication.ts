import type {
	StaticDrawUnit,
	StaticObjectRenderInstance,
	StaticObjectVisualResource,
} from "../contracts";
import type { TextureResourceDependencies } from "../../textures/placement";
import {
	createObjectVisualInstallSet,
	type ObjectVisualInstallSet,
	type ObjectVisualDirectDrawUnit,
} from "../../visual/object-visual-install-set";

export function createStaticBakeObjectVisualInstallSet(input: {
	readonly drawUnits: readonly StaticDrawUnit[];
	readonly staticObjectRenderInstances?: readonly StaticObjectRenderInstance[];
	readonly staticObjectVisualResources?: readonly StaticObjectVisualResource[];
	readonly textureDependencies?: readonly TextureResourceDependencies[];
}): ObjectVisualInstallSet {
	return createObjectVisualInstallSet({
		directDrawUnits: input.drawUnits.filter(isObjectVisualDirectDrawUnit),
		dynamicAnimationPartBindings: [],
		renderInstances: input.staticObjectRenderInstances ?? [],
		textureDependencies: input.textureDependencies ?? [],
		visualResources: input.staticObjectVisualResources ?? [],
	});
}

function isObjectVisualDirectDrawUnit(
	drawUnit: StaticDrawUnit,
): drawUnit is ObjectVisualDirectDrawUnit {
	return (
		drawUnit.kind === "static-object-geometry" ||
		drawUnit.kind === "structured-interior-geometry"
	);
}
