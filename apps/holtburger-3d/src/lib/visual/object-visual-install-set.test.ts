import { describe, expect, it } from "vitest";

import {
	createEmptyObjectVisualInstallSet,
	createObjectVisualInstallSet,
} from "./object-visual-install-set";

describe("object visual install sets", () => {
	it("creates an empty publication without implicit legacy buckets", () => {
		expect(createEmptyObjectVisualInstallSet()).toEqual({
			directDrawUnits: [],
			dynamicAnimationPartBindings: [],
			renderInstances: [],
			textureDependencies: [],
			visualResources: [],
		});
	});

	it("preserves dynamic animation bindings as first-class publication data", () => {
		const installSet = createObjectVisualInstallSet({
			dynamicAnimationPartBindings: [
				{
					renderPartIds: ["render-part:0", "render-part:1"],
					sourcePartIndex: 3,
				},
			],
		});

		expect(installSet.dynamicAnimationPartBindings).toEqual([
			{
				renderPartIds: ["render-part:0", "render-part:1"],
				sourcePartIndex: 3,
			},
		]);
	});
});
