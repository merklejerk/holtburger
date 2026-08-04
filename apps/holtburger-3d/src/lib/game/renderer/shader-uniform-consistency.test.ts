import { describe, expect, it } from "vitest";
import {
	createObjectFragmentShader,
	createObjectVertexShader,
	type ObjectVertexTransformSource,
} from "./webgl2-object-program";

/**
 * Guard against a uniform or varying being renamed in one place but not the other.
 *
 * Shader sources are assembled from interpolated fragments, so a stale declaration compiles
 * fine as text and only fails at `glslCompileShader` inside a real GL context — which surfaces
 * as a renderer that refuses to construct. `check:terrain-shader` validates the terrain program
 * against glslangValidator, but the object program is built by functions the file-based
 * validator cannot reach, so its uniform usage is checked here instead.
 */
function undeclaredNames(shader: string): readonly string[] {
	const declared = new Set<string>();
	for (const match of shader.matchAll(
		/\b(?:uniform|in|out)\s+\w+\s+([uv][A-Za-z0-9_]*)/g,
	)) {
		declared.add(match[1]!);
	}
	const used = new Set<string>();
	for (const match of shader.matchAll(/\b([uv][A-Z][A-Za-z0-9_]*)\b/g)) {
		used.add(match[1]!);
	}
	return [...used].filter((name) => !declared.has(name)).sort();
}

const TRANSFORM_SOURCES: readonly ObjectVertexTransformSource[] = [
	"baked",
	"instanced",
];

describe("object shader uniform and varying consistency", () => {
	for (const distanceFog of [true, false]) {
		for (const transformSource of TRANSFORM_SOURCES) {
			it(`declares every uniform and varying the ${transformSource} vertex shader uses (fog: ${distanceFog})`, () => {
				expect(
					undeclaredNames(
						createObjectVertexShader(distanceFog, transformSource),
					),
				).toEqual([]);
			});
		}

		it(`declares every uniform and varying the fragment shader uses (fog: ${distanceFog})`, () => {
			expect(undeclaredNames(createObjectFragmentShader(distanceFog))).toEqual(
				[],
			);
		});
	}

	it("omits fog uniforms entirely from the unfogged variants", () => {
		expect(createObjectVertexShader(false, "baked")).not.toContain("uFog");
		expect(createObjectFragmentShader(false)).not.toContain("uFog");
	});
});
