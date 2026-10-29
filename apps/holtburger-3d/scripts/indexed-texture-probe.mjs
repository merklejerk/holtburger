import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createServer } from "vite";
import { probeIndexedTextures } from "./indexed-texture-readback.mjs";

// Use the actual shader generators without starting a content host or needing DAT assets.
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
if (args.some((argument) => argument !== "--gpu"))
	throw new Error("Usage: npm run probe:indexed-textures -- [--gpu]");
const directory = await mkdtemp(join(tmpdir(), "holtburger-indexed-textures-"));
let server;
try {
	server = await createServer({
		root,
		configFile: false,
		server: { middlewareMode: true, ws: false },
		appType: "custom",
	});
	const object = await server.ssrLoadModule(
		"/src/lib/game/renderer/webgl2-object-program.ts",
	);
	const sky = await server.ssrLoadModule(
		"/src/lib/game/renderer/webgl2-sky-program.ts",
	);
	const particle = await server.ssrLoadModule(
		"/src/lib/game/renderer/webgl2-particle-program.ts",
	);
	const sources = {
		object: object.createObjectFragmentShader(false),
		sky: sky.createSkyFragmentShader(),
		particle: particle.PARTICLE_FRAGMENT_SHADER,
	};
	await server.close();
	server = undefined;
	const page = join(directory, "probe.html");
	await writeFile(
		page,
		`<!doctype html><body><script>
	try { document.body.textContent = JSON.stringify((${probeIndexedTextures.toString()})(${JSON.stringify(sources)})); }
	catch (error) { document.body.textContent = JSON.stringify({error: error.stack}); }
	</script>`,
	);
	const { stdout } = await promisify(execFile)(
		process.env.CHROME_PATH ?? "/opt/google/chrome/chrome",
		[
			"--headless=new",
			"--no-sandbox",
			"--use-gl=angle",
			...(args.includes("--gpu")
				? ["--use-angle=vulkan", "--ignore-gpu-blocklist"]
				: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
			`--user-data-dir=${join(directory, "chrome")}`,
			"--dump-dom",
			pathToFileURL(page).href,
		],
		{ timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
	);
	const body = /<body>([\s\S]*?)<\/body>/.exec(stdout);
	if (!body) throw new Error(`Chrome returned no probe result: ${stdout}`);
	const result = JSON.parse(body[1]);
	if (result.error) throw new Error(result.error);
	console.log(JSON.stringify(result, null, 2));
} finally {
	await server?.close();
	await rm(directory, { recursive: true, force: true });
}
