import { acFrameTransform } from "../../assets/ac-frame";
import { composeObjectPartTransform } from "../resolution/object-part-transform";
import { mat4ToFloat32Array, multiplyMat4 } from "../math/matrices";
import { createTexture2DUpload } from "../textures/texture-manager";
import { resolveObjectMaterialRanges } from "../commit/object-material-ranges";
import { SKY_MATERIAL_KIND, SKY_TEXTURE_UNITS } from "./webgl2-sky-program";
import { objectBlendPolicy, sourceOpacity } from "./object-rendering-policy";
import { Mat4, Vec3 } from "../math/types";
import type {
	AssetTextureFact,
	AssetTextureKey,
	TextureWrapMode,
} from "../textures/types";
import type { ObjectMaterialBinding } from "../commit/artifacts";
import type { ObjectMaterialOrdering } from "../resolution/object-material-planner";
import type {
	GeometryResourceKey,
	Texture2DResourceKey,
} from "./resource-manager";
import type { WebGL2ResourceManager } from "./webgl2-resource-manager";
import type {
	DecodedStaticPresentation,
	SkySourcePresentations,
} from "../../assets/decode-sky-record";
import type { ResolvedSkyState } from "../environment/sky-state";
import type { TextureFilteringPolicy } from "./texture-filtering-policy";
import type { TexturePreparer } from "../textures/texture-preparer";
import type { WebGL2SkyProgram } from "./webgl2-sky-program";
import type { WebGL2TextureSamplerCatalog } from "./webgl2-texture-sampler-catalog";

/** Per-frame device and view state the sky pass draws against. */
export interface SkyDrawContext {
	readonly gl: WebGL2RenderingContext;
	readonly program: WebGL2SkyProgram;
	readonly samplers: WebGL2TextureSamplerCatalog;
	readonly textureFiltering: TextureFilteringPolicy;
	/** Projection built with the far plane extended by `SKY_FAR_PLANE_SCALE`. */
	readonly projection: Float32Array;
	/** View matrix with its translation removed, keeping the sky centred on the camera. */
	readonly view: Float32Array;
	/** Shared clock seconds driving derived `tex_velocity` phase. */
	readonly clockSeconds: number;
	/** Reusable scratch avoiding per-draw allocation in the frame path. */
	readonly matrixScratch: Float32Array;
}

/**
 * Retail's alpha-test threshold for cutout object surfaces (`webgl2-renderer` object path).
 * Restated here rather than imported so the sky pass owns one readable draw policy.
 */
const SKY_ALPHA_TEST = 200 / 255;

/**
 * Absolute far plane for the sky pass: retail's `Render::zfar` of 4000 (acclient.c:44524) times the
 * fourfold extension `GameSky::Draw` applies (acclient.c:297400).
 *
 * Absolute rather than a multiple of the active camera's far plane, because the authored sky
 * geometry has a fixed extent while our draw distance is a tuning choice. The shipped cloud sheets
 * span +/-10087 in x and z at y up to 780, putting their far corners about 14285 out; scaling our
 * 2000 unit camera far by four would clip them and leave the frustum corners empty. Retail's
 * multiplier only works because it multiplies retail's own fixed 4000.
 */
export const SKY_FAR_PLANE = 16_000;

/** One contiguous single-material span of one sky object's geometry. */
interface SkyDrawRange {
	readonly geometry: GeometryResourceKey;
	readonly indexStart: number;
	readonly indexCount: number;
	readonly materialKind: number;
	readonly palettedClipMap: boolean;
	readonly alphaTest: number;
	/** Retail blend class; additive surfaces such as the sun must not composite their black backing. */
	readonly ordering: ObjectMaterialOrdering;
	readonly wrap: TextureWrapMode;
	readonly base: AssetTextureKey;
	readonly palette: AssetTextureKey | null;
	/** Authored surface values used when the day group replaces neither brightness channel. */
	readonly source: ObjectMaterialBinding["source"];
	/** Setup-authored part placement and scale, composed once at preparation. */
	readonly partTransform: Mat4;
}

/** Everything one celestial DAT id needs to draw, resolved once at region load. */
interface SkyObjectResources {
	readonly ranges: readonly SkyDrawRange[];
}

/**
 * The sky's private GPU residency and draw submission.
 *
 * Owns stages 4 and 5 of the object path — residency and draw — while reusing stages 1 to 3 for
 * resource decoding. Textures are standalone rather than atlas pages: the set is fixed for the
 * region, it gains nothing from packing at roughly seven draws a frame, and the authored
 * `tex_velocity` layers need real `GL_REPEAT` rather than shader-emulated wrapping.
 */
export class WebGL2SkyPass {
	readonly #resources: WebGL2ResourceManager;
	readonly #objects = new Map<string, SkyObjectResources>();
	readonly #textures = new Map<AssetTextureKey, Texture2DResourceKey>();
	readonly #geometries: GeometryResourceKey[] = [];

	private constructor(resources: WebGL2ResourceManager) {
		this.#resources = resources;
	}

	/**
	 * Make every celestial object resident.
	 *
	 * Eager and complete: the census found 16 unique ids across all 20 day groups, so there is no
	 * pop-in on a day-group rollover or a time-of-day scrub, and no on-demand machinery to own.
	 */
	static async prepare(
		resources: WebGL2ResourceManager,
		preparer: TexturePreparer,
		source: SkySourcePresentations,
	): Promise<WebGL2SkyPass> {
		const pass = new WebGL2SkyPass(resources);
		const facts = new Map<AssetTextureKey, AssetTextureFact>();
		for (const [gfxObjectId, decoded] of source.presentations) {
			pass.#objects.set(
				gfxObjectId,
				pass.#prepareObject(gfxObjectId, decoded, facts),
			);
		}
		await Promise.all(
			[...facts.values()].map(async (fact) => {
				const prepared = await preparer.prepare(fact);
				if (!("pixels" in prepared)) {
					throw new Error(
						`Sky texture ${fact.key} prepared as an array source; sky surfaces are standalone.`,
					);
				}
				if (prepared.key !== fact.key) {
					throw new Error(
						`Sky texture preparation returned ${prepared.key} for ${fact.key}.`,
					);
				}
				pass.#textures.set(
					fact.key,
					resources.createTexture2D(createTexture2DUpload(prepared)),
				);
			}),
		);
		return pass;
	}

	#prepareObject(
		gfxObjectId: string,
		decoded: DecodedStaticPresentation,
		facts: Map<AssetTextureKey, AssetTextureFact>,
	): SkyObjectResources {
		// Every decoded presentation carries exactly one authored placement pose; sky objects have
		// no animation, so that pose is the only one they ever use.
		const pose = decoded.presentation.placementPoses.get(0);
		if (pose === undefined) {
			throw new Error(`Sky object ${gfxObjectId} authors no placement pose.`);
		}
		const ranges: SkyDrawRange[] = [];
		for (const part of decoded.presentation.parts) {
			const label = `Sky object ${gfxObjectId} part ${part.partIndex}`;
			const geometry = this.#resources.createGeometry({
				bakedLight: null,
				indices: part.geometry.indices,
				kind: "object",
				normals: part.geometry.normals,
				positions: part.geometry.positions,
				textureCoordinates: part.geometry.textureCoordinates,
			});
			this.#geometries.push(geometry);
			// Setup-backed sky objects compose their authored part pose and geometry scale once; a
			// bare GfxObj resolves to a single identity-posed part. Sky objects carry no source
			// scale of their own, so the composition uses unit scale.
			const rigidPose = pose.partTransforms[part.partIndex];
			if (rigidPose === undefined) {
				throw new Error(`${label} has no rigid pose in its placement.`);
			}
			const partTransform = composeObjectPartTransform(
				rigidPose,
				UNIT_SCALE,
				part.defaultScale,
			);
			for (const range of resolveObjectMaterialRanges(part, label, facts)) {
				const material = range.material;
				if (material.textures.base === null) {
					throw new Error(
						`${label} resolves a material with no base texture; sky surfaces are always textured.`,
					);
				}
				ranges.push({
					alphaTest: range.ordering === "alpha-test" ? SKY_ALPHA_TEST : 0,
					ordering: range.ordering,
					base: material.textures.base,
					geometry,
					indexCount: range.indexCount,
					indexStart: range.indexStart,
					materialKind: materialKind(material, label),
					palette: material.textures.palette,
					palettedClipMap: material.palettedClipMap,
					partTransform,
					source: material.source,
					wrap: material.sampler.wrap,
				});
			}
		}
		return { ranges };
	}

	/** Release every device resource the sky owns. */
	destroy(): void {
		for (const geometry of this.#geometries)
			this.#resources.releaseResource(geometry);
		for (const texture of this.#textures.values())
			this.#resources.releaseResource(texture);
		this.#geometries.length = 0;
		this.#textures.clear();
		this.#objects.clear();
	}

	/**
	 * Draw the resolved celestial sky under retail's pass policy.
	 *
	 * Depth test always with depth writes off, no fog, and a far-extended projection
	 * (`GameSky::Draw`, acclient.c:297381): the sky can never occlude world geometry and is never
	 * occluded by it, because it is drawn first into an untouched depth buffer.
	 */
	draw(context: SkyDrawContext, sky: ResolvedSkyState): void {
		const { gl, program } = context;
		const celestial = sky.objects.filter((object) => object.isCelestial);
		if (celestial.length === 0) return;

		gl.useProgram(program.program);
		// Culling stays off: the camera sits inside every sky mesh, so the authored cull face —
		// derived for objects viewed from outside — would reject the faces the viewer needs.
		// Enabling it was measured to change nothing on shipped content.
		gl.disable(gl.CULL_FACE);
		gl.depthFunc(gl.ALWAYS);
		gl.depthMask(false);
		gl.enable(gl.BLEND);
		gl.uniformMatrix4fv(program.uniforms.projection, false, context.projection);
		gl.uniformMatrix4fv(program.uniforms.view, false, context.view);

		for (const object of celestial) {
			const resources = this.resolveObject(object.gfxObjectId);
			if (resources === null) {
				throw new Error(
					`Resolved sky object ${object.gfxObjectId} has no prepared resources.`,
				);
			}
			const orientation = acFrameTransform(
				{ origin: ORIGIN, orientation: object.orientation },
				UNIT_SCALE_TUPLE,
			);
			const offset = skyTextureOffset(
				object.textureVelocity,
				context.clockSeconds,
			);
			gl.uniform2f(program.uniforms.textureOffset, offset[0], offset[1]);
			for (const range of resources.ranges) {
				this.#drawRange(context, range, orientation, object.material);
			}
		}

		gl.bindVertexArray(null);
		gl.depthFunc(gl.LEQUAL);
		gl.depthMask(true);
		gl.disable(gl.BLEND);
	}

	#drawRange(
		context: SkyDrawContext,
		range: SkyDrawRange,
		orientation: Mat4,
		material: ResolvedSkyState["objects"][number]["material"],
	): void {
		const { gl, program } = context;
		const geometry = this.#resources.getGeometry(range.geometry);
		// Retail's own flag-to-blend mapping, shared with the object path rather than guessed from
		// the ordering class: additive surfaces keep their destination so the sun's black backing
		// adds nothing, while a translucent clip-map surface falls back to ordinary alpha blending.
		const blend = objectBlendPolicy(range.source.rawSurfaceFlags);
		gl.blendFunc(
			blend.source === "one"
				? gl.ONE
				: blend.source === "one-minus-src-alpha"
					? gl.ONE_MINUS_SRC_ALPHA
					: gl.SRC_ALPHA,
			blend.destination === "one"
				? gl.ONE
				: blend.destination === "src-alpha"
					? gl.SRC_ALPHA
					: gl.ONE_MINUS_SRC_ALPHA,
		);
		gl.bindVertexArray(geometry.vertexArray);
		gl.uniformMatrix4fv(
			program.uniforms.model,
			false,
			mat4ToFloat32Array(
				multiplyMat4(orientation, range.partTransform),
				context.matrixScratch,
			),
		);
		gl.uniform1i(program.uniforms.materialKind, range.materialKind);
		gl.uniform1f(program.uniforms.alphaTest, range.alphaTest);
		gl.uniform1i(
			program.uniforms.palettedClipMap,
			range.palettedClipMap ? 1 : 0,
		);
		// The surface's own diffuse scale, which modulates the sampled texture exactly as it does in
		// the object path.
		gl.uniform1f(program.uniforms.diffuse, range.source.diffuseScale);
		// An unauthored luminosity leaves the surface at full brightness, because retail skips the
		// material write entirely at its -1 sentinel (acclient.c:297764). Falling back to the
		// surface's own luminosity instead would black out layers that author none, such as the
		// night stars.
		gl.uniform1f(program.uniforms.luminosity, material.luminosity ?? 1);
		// Two independent transparency sources multiply, exactly as the object path composes them:
		// the surface's own authored translucency, and the day group's per-tick `transparent`
		// replacement. Applying only the latter left additive cloud sheets contributing at full
		// strength and washing the sky out.
		gl.uniform1f(
			program.uniforms.alpha,
			sourceOpacity(range.source.translucency) *
				(1 - (material.translucency ?? 0)),
		);
		this.#bindTexture(context, SKY_TEXTURE_UNITS.base, range.base, range.wrap);
		if (range.palette !== null) {
			// Palette lookups are exact texel fetches, so their wrap mode never applies.
			this.#bindTexture(
				context,
				SKY_TEXTURE_UNITS.palette,
				range.palette,
				range.wrap,
			);
		}
		gl.drawElements(
			gl.TRIANGLES,
			range.indexCount,
			geometry.indexType,
			range.indexStart * geometry.indexElementBytes,
		);
	}

	#bindTexture(
		context: SkyDrawContext,
		unit: number,
		key: AssetTextureKey,
		wrap: TextureWrapMode,
	): void {
		const binding = this.#resources.getTexture2D(this.resolveTexture(key));
		context.gl.activeTexture(context.gl.TEXTURE0 + unit);
		context.gl.bindTexture(context.gl.TEXTURE_2D, binding.texture);
		context.samplers.bind(unit, {
			mipLevels: binding.mipLevels,
			policy: context.textureFiltering,
			samplingClass: "filterable",
			wrap,
		});
	}

	/** Resolve one object's prepared ranges, or null when the region authors none for that id. */
	resolveObject(gfxObjectId: string): SkyObjectResources | null {
		return this.#objects.get(gfxObjectId.toLowerCase()) ?? null;
	}

	/** Device resource backing one prepared sky texture. */
	resolveTexture(key: AssetTextureKey): Texture2DResourceKey {
		const resource = this.#textures.get(key);
		if (resource === undefined) {
			throw new Error(`Sky texture ${key} is not resident.`);
		}
		return resource;
	}
}

/**
 * Strip a view matrix's translation, keeping the sky centred on the camera.
 *
 * Retail achieves the same by placing every celestial object at the viewer cell's origin each tick
 * (`GameSky::UseTime`, acclient.c:297744) rather than by editing the view; expressing it here keeps
 * the resolved contract free of camera state.
 */
export function skyViewMatrix(view: Mat4, target: Float32Array): Float32Array {
	mat4ToFloat32Array(view, target);
	target[12] = 0;
	target[13] = 0;
	target[14] = 0;
	return target;
}

/** Sky objects have no authored source scale; only their setup-default geometry scale applies. */
const UNIT_SCALE = new Vec3(1, 1, 1);
const UNIT_SCALE_TUPLE = [1, 1, 1] as const;
const ORIGIN = [0, 0, 0] as const;

function materialKind(material: ObjectMaterialBinding, label: string): number {
	if (material.source.kind !== "texture") {
		throw new Error(`${label} resolves a non-texture material.`);
	}
	switch (material.source.textureEncoding) {
		case "direct-color":
			return SKY_MATERIAL_KIND.direct;
		case "index8":
			return SKY_MATERIAL_KIND.index8;
		case "index16":
			return SKY_MATERIAL_KIND.index16;
	}
}

/**
 * Derive the UV scroll phase for one authored rate.
 *
 * Retail accumulates instead (`CPhysics::UpdateTexVelocity`, acclient.c:299999, adds
 * `rate * dt` per frame and wraps at 1), but every authored sky rate is constant, so deriving
 * from the shared clock is identical up to an unobservable phase origin and keeps the pass free of
 * mutable per-frame state. Computed in f64 before it reaches an f32 uniform so a long session
 * cannot lose precision in the fractional part.
 */
export function skyTextureOffset(
	velocity: readonly [number, number],
	clockSeconds: number,
): [number, number] {
	return [
		wrapUnit(velocity[0] * clockSeconds),
		wrapUnit(velocity[1] * clockSeconds),
	];
}

function wrapUnit(value: number): number {
	const wrapped = value % 1;
	return wrapped < 0 ? wrapped + 1 : wrapped;
}
