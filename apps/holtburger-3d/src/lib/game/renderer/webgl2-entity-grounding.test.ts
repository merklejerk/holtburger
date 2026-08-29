import { describe, expect, it } from "vitest";
import {
	DEFAULT_ENTITY_SHADOW_SETTINGS,
	MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER,
} from "./entity-shadow-policy";
import { createEntityGroundingSelection } from "./entity-grounding";
import {
	applyWebGL2EntityGroundingUniforms,
	entityGroundingUniformAttemptCount,
	type WebGL2EntityGroundingUniforms,
} from "./webgl2-entity-grounding";

describe("WebGL2 entity grounding uniforms", () => {
	it("binds only count zero for an empty cell", () => {
		const fixture = createFixture();
		const issued = applyWebGL2EntityGroundingUniforms(
			fixture.state,
			fixture.uniforms,
			createEntityGroundingSelection(),
			DEFAULT_ENTITY_SHADOW_SETTINGS.grounding,
		);
		expect(issued).toBe(entityGroundingUniformAttemptCount({ count: 0 }));
		expect(fixture.calls).toEqual(["1i:count:0"]);
	});

	it("binds one fixed record array and every appearance setting for a populated cell", () => {
		const fixture = createFixture();
		const selection = createEntityGroundingSelection();
		selection.count = 1;
		selection.records.set([1, 2, 3, 4]);
		const issued = applyWebGL2EntityGroundingUniforms(
			fixture.state,
			fixture.uniforms,
			selection,
			DEFAULT_ENTITY_SHADOW_SETTINGS.grounding,
		);
		expect(issued).toBe(entityGroundingUniformAttemptCount(selection));
		expect(fixture.calls[0]).toBe("1i:count:1");
		expect(fixture.calls[1]).toBe(
			`4fv:casters:${MAX_ENTITY_GROUNDING_CASTERS_PER_RECEIVER * 4}:1,2,3,4`,
		);
		expect(fixture.calls).toHaveLength(
			entityGroundingUniformAttemptCount(selection),
		);
	});
});

function createFixture() {
	const calls: string[] = [];
	const location = (name: string) =>
		({ name }) as unknown as WebGLUniformLocation;
	const uniforms = {
		casterCount: location("count"),
		casters: location("casters"),
		contactBias: location("contactBias"),
		dropSpread: location("dropSpread"),
		fullStrengthUpFacing: location("fullStrengthUpFacing"),
		maximumDrop: location("maximumDrop"),
		minimumUpFacing: location("minimumUpFacing"),
		radiusScale: location("radiusScale"),
		softness: location("softness"),
		strength: location("strength"),
	} satisfies WebGL2EntityGroundingUniforms;
	const named = (value: WebGLUniformLocation) =>
		(value as unknown as { readonly name: string }).name;
	return {
		calls,
		state: {
			applyUniform1f: (target: WebGLUniformLocation, value: number) => {
				calls.push(`1f:${named(target)}:${value}`);
				return true;
			},
			applyUniform1i: (target: WebGLUniformLocation, value: number) => {
				calls.push(`1i:${named(target)}:${value}`);
				return true;
			},
			applyUniform4fv: (target: WebGLUniformLocation, value: Float32Array) => {
				calls.push(
					`4fv:${named(target)}:${value.length}:${Array.from(value.slice(0, 4)).join(",")}`,
				);
				return true;
			},
		},
		uniforms,
	};
}
