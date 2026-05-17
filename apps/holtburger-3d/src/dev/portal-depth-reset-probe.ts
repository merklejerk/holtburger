import {
	AlwaysDepth,
	AlwaysStencilFunc,
	Color,
	EqualStencilFunc,
	GLSL3,
	KeepStencilOp,
	Mesh,
	MeshBasicMaterial,
	OrthographicCamera,
	PlaneGeometry,
	ReplaceStencilOp,
	Scene,
	ShaderMaterial,
	WebGLRenderer,
} from "three";

export interface PortalDepthResetProbeResult {
	webglVersion: "webgl2" | "webgl1";
	renderer: string;
	vendor: string;
	stencilBits: number;
	fragmentDepthPath: "webgl2-gl-frag-depth" | "unavailable";
	withoutDepthResetRevealed: boolean;
	withDepthResetRevealed: boolean;
	cornerPreserved: boolean;
	selectedProductionRoute:
		| "shader-fragment-depth-aperture-reset"
		| "blocked";
	verdict: "go" | "blocked";
	notes: string[];
}

interface SampledProbePixels {
	center: Uint8Array;
	corner: Uint8Array;
}

const PROBE_SIZE_PX = 320;
const APERTURE_STENCIL_REF = 1;

export function runPortalDepthResetProbe(
	host: HTMLElement,
): PortalDepthResetProbeResult {
	const renderer = new WebGLRenderer({
		alpha: false,
		antialias: true,
		preserveDrawingBuffer: true,
		stencil: true,
	});
	renderer.setPixelRatio(1);
	renderer.setSize(PROBE_SIZE_PX, PROBE_SIZE_PX, false);
	renderer.autoClear = false;
	renderer.setClearColor(new Color("#111827"), 1);
	renderer.domElement.className = "portal-depth-reset-probe__canvas";
	host.append(renderer.domElement);

	try {
		const gl = renderer.getContext();
		const webglVersion = isWebGL2RenderingContext(gl) ? "webgl2" : "webgl1";
		const stencilBits = Number(gl.getParameter(gl.STENCIL_BITS));
		const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
		const vendor = debugInfo
			? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
			: String(gl.getParameter(gl.VENDOR));
		const rendererName = debugInfo
			? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
			: String(gl.getParameter(gl.RENDERER));

		const withoutDepthResetPixels = renderSyntheticProbeScene(renderer, false);
		const withDepthResetPixels = renderSyntheticProbeScene(renderer, true);
		const withoutDepthResetRevealed = isInteriorPixel(
			withoutDepthResetPixels.center,
		);
		const withDepthResetRevealed = isInteriorPixel(withDepthResetPixels.center);
		const cornerPreserved = isExteriorPixel(withDepthResetPixels.corner);
		const fragmentDepthPath =
			webglVersion === "webgl2"
				? "webgl2-gl-frag-depth"
				: "unavailable";
		const verdict =
			fragmentDepthPath === "webgl2-gl-frag-depth" &&
			stencilBits > 0 &&
			!withoutDepthResetRevealed &&
			withDepthResetRevealed &&
			cornerPreserved
				? "go"
				: "blocked";

		return {
			webglVersion,
			renderer: rendererName,
			vendor,
			stencilBits,
			fragmentDepthPath,
			withoutDepthResetRevealed,
			withDepthResetRevealed,
			cornerPreserved,
			selectedProductionRoute:
				verdict === "go" ? "shader-fragment-depth-aperture-reset" : "blocked",
			verdict,
			notes: buildProbeNotes({
				webglVersion,
				stencilBits,
				withoutDepthResetRevealed,
				withDepthResetRevealed,
				cornerPreserved,
			}),
		};
	} catch (error) {
		return {
			webglVersion: "webgl1",
			renderer: "unavailable",
			vendor: "unavailable",
			stencilBits: 0,
			fragmentDepthPath: "unavailable",
			withoutDepthResetRevealed: false,
			withDepthResetRevealed: false,
			cornerPreserved: false,
			selectedProductionRoute: "blocked",
			verdict: "blocked",
			notes: [
				`Probe failed before producing a pixel verdict: ${
					error instanceof Error ? error.message : String(error)
				}`,
			],
		};
	}
}

function renderSyntheticProbeScene(
	renderer: WebGLRenderer,
	withDepthReset: boolean,
): SampledProbePixels {
	const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
	camera.position.set(0, 0, 2);
	camera.lookAt(0, 0, 0);

	const exteriorScene = new Scene();
	exteriorScene.add(createPlane(2, 2, -0.25, createExteriorMaterial()));

	const stencilScene = new Scene();
	stencilScene.add(createPlane(0.9, 0.9, -0.5, createStencilMaterial()));

	const depthResetScene = new Scene();
	depthResetScene.add(createPlane(0.9, 0.9, -0.5, createDepthResetMaterial()));

	const interiorScene = new Scene();
	interiorScene.add(createPlane(2, 2, -1.25, createInteriorMaterial()));

	renderer.clear(true, true, true);
	renderer.render(exteriorScene, camera);
	renderer.render(stencilScene, camera);
	if (withDepthReset) {
		renderer.render(depthResetScene, camera);
	}
	renderer.render(interiorScene, camera);

	const gl = renderer.getContext();
	const center = readCanvasPixel(gl, PROBE_SIZE_PX / 2, PROBE_SIZE_PX / 2);
	const corner = readCanvasPixel(gl, 24, 24);

	disposeScene(exteriorScene);
	disposeScene(stencilScene);
	disposeScene(depthResetScene);
	disposeScene(interiorScene);

	return { center, corner };
}

function createPlane(
	width: number,
	height: number,
	z: number,
	material: MeshBasicMaterial | ShaderMaterial,
): Mesh {
	const mesh = new Mesh(new PlaneGeometry(width, height), material);
	mesh.position.z = z;
	return mesh;
}

function createExteriorMaterial(): MeshBasicMaterial {
	return new MeshBasicMaterial({
		color: "#3f8f5b",
		depthTest: true,
		depthWrite: true,
	});
}

function createInteriorMaterial(): MeshBasicMaterial {
	return new MeshBasicMaterial({
		color: "#d82f54",
		depthTest: true,
		depthWrite: true,
		stencilWrite: true,
		stencilFunc: EqualStencilFunc,
		stencilRef: APERTURE_STENCIL_REF,
		stencilFail: KeepStencilOp,
		stencilZFail: KeepStencilOp,
		stencilZPass: KeepStencilOp,
	});
}

function createStencilMaterial(): MeshBasicMaterial {
	return new MeshBasicMaterial({
		colorWrite: false,
		depthTest: false,
		depthWrite: false,
		stencilWrite: true,
		stencilFunc: AlwaysStencilFunc,
		stencilRef: APERTURE_STENCIL_REF,
		stencilFail: KeepStencilOp,
		stencilZFail: KeepStencilOp,
		stencilZPass: ReplaceStencilOp,
	});
}

function createDepthResetMaterial(): ShaderMaterial {
	return new ShaderMaterial({
		glslVersion: GLSL3,
		vertexShader: `
			void main() {
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
			}
		`,
		fragmentShader: `
			out vec4 outputColor;

			void main() {
				gl_FragDepth = 1.0;
				outputColor = vec4(0.0, 0.0, 0.0, 1.0);
			}
		`,
		colorWrite: false,
		depthFunc: AlwaysDepth,
		depthTest: true,
		depthWrite: true,
		stencilWrite: true,
		stencilFunc: EqualStencilFunc,
		stencilRef: APERTURE_STENCIL_REF,
		stencilFail: KeepStencilOp,
		stencilZFail: KeepStencilOp,
		stencilZPass: KeepStencilOp,
	});
}

function readCanvasPixel(
	gl: WebGLRenderingContext | WebGL2RenderingContext,
	x: number,
	y: number,
): Uint8Array {
	const pixel = new Uint8Array(4);
	gl.readPixels(
		Math.floor(x),
		Math.floor(y),
		1,
		1,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		pixel,
	);
	return pixel;
}

function isInteriorPixel(pixel: Uint8Array): boolean {
	return pixel[0] > 160 && pixel[1] < 90 && pixel[2] < 120;
}

function isExteriorPixel(pixel: Uint8Array): boolean {
	return pixel[0] < 120 && pixel[1] > 100 && pixel[2] < 120;
}

function buildProbeNotes(details: {
	webglVersion: "webgl2" | "webgl1";
	stencilBits: number;
	withoutDepthResetRevealed: boolean;
	withDepthResetRevealed: boolean;
	cornerPreserved: boolean;
}): string[] {
	const notes: string[] = [];
	if (details.webglVersion !== "webgl2") {
		notes.push("WebGL2 is required for the GLSL3 gl_FragDepth route.");
	}
	if (details.stencilBits <= 0) {
		notes.push("The renderer did not allocate a stencil buffer.");
	}
	if (details.withoutDepthResetRevealed) {
		notes.push(
			"The control scene revealed the interior without a reset, so the fixture is invalid.",
		);
	}
	if (!details.withDepthResetRevealed) {
		notes.push("The reset scene did not reveal the interior through the aperture.");
	}
	if (!details.cornerPreserved) {
		notes.push("Pixels outside the aperture were not preserved as exterior color.");
	}
	if (notes.length === 0) {
		notes.push(
			"WebGL2 fragment-depth aperture reset succeeded with stencil equality, color writes disabled, depth writes enabled, and normal-depth interior rendering.",
		);
	}
	return notes;
}

function disposeScene(scene: Scene): void {
	for (const child of scene.children) {
		if (!(child instanceof Mesh)) {
			continue;
		}
		child.geometry.dispose();
		if (Array.isArray(child.material)) {
			for (const material of child.material) {
				material.dispose();
			}
		} else {
			child.material.dispose();
		}
	}
}

function isWebGL2RenderingContext(
	context: WebGLRenderingContext | WebGL2RenderingContext,
): context is WebGL2RenderingContext {
	return (
		typeof WebGL2RenderingContext !== "undefined" &&
		context instanceof WebGL2RenderingContext
	);
}
