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
/** Shared GLSL blocks the terrain shaders interpolate, by exported constant name. */
const sharedGlslModules = {
	WEBGL2_DISTANCE_FOG_GLSL: "../src/lib/game/renderer/webgl2-fog.ts",
	WEBGL2_SCENE_LIGHTING_GLSL: "../src/lib/game/renderer/webgl2-lighting.ts",
};
const source = await readFile(shaderSourcePath, "utf8");
const sharedGlsl = new Map(
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
const temporaryDirectory = await mkdtemp(
	join(tmpdir(), "holtburger-terrain-shader-"),
);

try {
	const vertexPath = join(temporaryDirectory, "terrain.vert");
	const fragmentPath = join(temporaryDirectory, "terrain.frag");
	await Promise.all([
		writeFile(vertexPath, extractShader(source, "TERRAIN_VERTEX_SHADER")),
		writeFile(fragmentPath, extractShader(source, "TERRAIN_FRAGMENT_SHADER")),
	]);
	await run("glslangValidator", ["-l", vertexPath, fragmentPath]);
} finally {
	await rm(temporaryDirectory, { force: true, recursive: true });
}

/** Extract one embedded template-literal shader without relying on source line numbers. */
function extractShader(sourceText, name) {
	const match = sourceText.match(
		new RegExp("const " + name + " = `([\\s\\S]*?)`;"),
	);
	if (match?.[1] === undefined) {
		throw new Error(`Could not find ${name} in ${shaderSourcePath}.`);
	}
	return [...sharedGlsl].reduce(
		(shader, [name, glsl]) => shader.replaceAll("${" + name + "}", glsl),
		match[1],
	);
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
