#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const shaderSourcePath = join(
	scriptDirectory,
	"../src/lib/game/renderer/webgl2-terrain-program.ts",
);
const farShaderSourcePath = join(
	scriptDirectory,
	"../src/lib/game/renderer/webgl2-far-terrain-program.ts",
);
/** Shared GLSL blocks the shaders interpolate, by exported constant name. */
const sharedGlslModules = {
	WEBGL2_DISTANCE_FOG_GLSL: "../src/lib/game/renderer/webgl2-fog.ts",
	WEBGL2_SCENE_LIGHTING_GLSL: "../src/lib/game/renderer/webgl2-lighting.ts",
	WEBGL2_DIRECTIONAL_LIGHTING_GLSL:
		"../src/lib/game/renderer/webgl2-lighting.ts",
	POINT_LIGHT_FALLOFF_GLSL:
		"../src/lib/game/environment/point-light-falloff.ts",
};
/** Numeric constants those blocks interpolate, so the GLSL and TypeScript cannot drift. */
const sharedConstantModules = [
	"../src/lib/game/environment/point-light-falloff.ts",
	"../src/lib/game/environment/runtime-lights.ts",
	"../src/lib/game/landblocks.ts",
	"../src/lib/game/renderer/webgl2-lighting.ts",
	"../src/lib/game/terrain/pcode.ts",
];
const source = await readFile(shaderSourcePath, "utf8");
const farSource = await readFile(farShaderSourcePath, "utf8");
const substitutions = new Map(
	await Promise.all(
		Object.entries(sharedGlslModules).map(async ([name, relativePath]) => {
			const modulePath = join(scriptDirectory, relativePath);
			return /** @type {const} */ ([
				name,
				extractTemplateLiteral(
					await readFile(modulePath, "utf8"),
					name,
					modulePath,
				),
			]);
		}),
	),
);
for (const relativePath of sharedConstantModules) {
	const moduleSource = await readFile(
		join(scriptDirectory, relativePath),
		"utf8",
	);
	for (const match of moduleSource.matchAll(
		// Shader-facing constants need not be exported: some are consumed only by the GLSL in
		// their own module, and exporting them purely to be validated would read as dead code.
		/(?:export )?const ([A-Z][A-Z0-9_]*) = ([-0-9.]+);/g,
	)) {
		substitutions.set(match[1], match[2]);
	}
	const numericArrayLengths = new Map(
		[
			...moduleSource.matchAll(
				/export const ([A-Z][A-Z0-9_]*) = \[([0-9,\s-]+)\] as const;/g,
			),
		].map((match) => [
			match[1],
			match[2]
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean).length,
		]),
	);
	for (const match of moduleSource.matchAll(
		/export const ([A-Z][A-Z0-9_]*) = ([A-Z][A-Z0-9_]*)\.length;/g,
	)) {
		const length = numericArrayLengths.get(match[2]);
		if (length !== undefined) substitutions.set(match[1], String(length));
	}
}
const temporaryDirectory = await mkdtemp(
	join(tmpdir(), "holtburger-terrain-shader-"),
);

try {
	const vertexPath = join(temporaryDirectory, "terrain.vert");
	const fragmentPath = join(temporaryDirectory, "terrain.frag");
	const farVertexPath = join(temporaryDirectory, "far-terrain.vert");
	const farFragmentPath = join(temporaryDirectory, "far-terrain.frag");
	await Promise.all([
		writeFile(
			vertexPath,
			extractShader(source, "TERRAIN_VERTEX_SHADER", shaderSourcePath),
		),
		writeFile(
			fragmentPath,
			extractShader(source, "TERRAIN_FRAGMENT_SHADER", shaderSourcePath),
		),
		writeFile(
			farVertexPath,
			extractShader(
				farSource,
				"WEBGL2_FAR_TERRAIN_VERTEX_SHADER",
				farShaderSourcePath,
			),
		),
		writeFile(
			farFragmentPath,
			extractShader(
				farSource,
				"WEBGL2_FAR_TERRAIN_FRAGMENT_SHADER",
				farShaderSourcePath,
			),
		),
	]);
	await run("glslangValidator", ["-l", vertexPath, fragmentPath]);
	await run("glslangValidator", ["-l", farVertexPath, farFragmentPath]);
} finally {
	await rm(temporaryDirectory, { force: true, recursive: true });
}

/** Extract one embedded template-literal shader without relying on source line numbers. */
function extractShader(sourceText, name, sourcePath) {
	const match = sourceText.match(
		new RegExp("const " + name + " = `([\\s\\S]*?)`;"),
	);
	if (match?.[1] === undefined) {
		throw new Error(`Could not find ${name} in ${sourcePath}.`);
	}
	return resolveInterpolations(match[1]);
}

/**
 * Resolve `${NAME}` placeholders repeatedly, because a shared GLSL block may itself interpolate
 * constants or another block. Stops when nothing remains, and fails loudly on an unknown name so
 * a renamed export cannot silently leave a literal `${...}` in validated source.
 */
function resolveInterpolations(shader) {
	let resolved = shader;
	for (let pass = 0; pass < 8; pass += 1) {
		if (!resolved.includes("${")) return resolved;
		resolved = resolved.replaceAll(/\$\{([A-Za-z0-9_]+)\}/g, (whole, name) => {
			const value = substitutions.get(name);
			if (value === undefined) {
				throw new Error(`Shader interpolates unknown ${name}.`);
			}
			return value;
		});
	}
	throw new Error("Shader interpolations did not converge.");
}

function extractTemplateLiteral(sourceText, name, sourcePath) {
	const match = sourceText.match(
		new RegExp("(?:export )?const " + name + " = `([\\s\\S]*?)`;"),
	);
	if (match?.[1] === undefined) {
		throw new Error(`Could not find ${name} in ${sourcePath}.`);
	}
	return match[1];
}

/** Run one external validator while preserving its diagnostics for the caller. */
function run(command, arguments_) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, arguments_, { stdio: "inherit" });
		child.once("error", (error) => {
			reject(
				new Error(
					`Could not run ${command}. Install glslangValidator to validate terrain GLSL: ${error.message}`,
				),
			);
		});
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolve();
				return;
			}
			reject(
				new Error(
					`${command} failed with ${signal === null ? `exit code ${code}` : `signal ${signal}`}.`,
				),
			);
		});
	});
}
