import { type Material, Vector2 } from "three";

const TEXTURE_VELOCITY_PROGRAM_KEY = "holtburger-uv-velocity";
const TEXTURE_VELOCITY_SAMPLE_LIMIT = 16;

export interface TextureVelocityRenderState {
	uSpeed: number;
	vSpeed: number;
}

export interface TextureVelocityMaterialSet {
	materials: Material[];
	ownedByResourceCache: boolean;
}

export interface TextureVelocityMetrics {
	textureVelocityPartCount: number;
	textureVelocityRenderGroupCount: number;
	textureVelocityMaterialCount: number;
	textureVelocitySignatureCount: number;
	textureVelocitySignatureSamples: string[];
}

interface TextureVelocityShader {
	uniforms: Record<string, { value: unknown }>;
	vertexShader: string;
}

interface TextureVelocityMaterialUserData {
	holtburgerTextureVelocity?: {
		uSpeed: number;
		vSpeed: number;
		uniform: { value: Vector2 };
	};
}

interface TextureVelocityMetricPart {
	textureVelocity: TextureVelocityRenderState | null;
	textureVelocitySignature: string;
}

interface TextureVelocityMetricGroup {
	textureVelocity: TextureVelocityRenderState | null;
}

export function normalizeTextureVelocity(
	velocity: TextureVelocityRenderState | null,
): TextureVelocityRenderState | null {
	if (!velocity || (velocity.uSpeed === 0 && velocity.vSpeed === 0)) {
		return null;
	}
	return velocity;
}

export function describeTextureVelocitySignature(
	velocity: TextureVelocityRenderState | null,
): string {
	return velocity
		? `uv:${formatVelocityComponent(velocity.uSpeed)},${formatVelocityComponent(
				velocity.vSpeed,
			)}`
		: "uv:none";
}

export function createTextureVelocityMaterialSet(
	materials: readonly Material[],
	textureVelocity: TextureVelocityRenderState | null,
): TextureVelocityMaterialSet {
	return textureVelocity
		? {
				materials: materials.map((material) =>
					createTextureVelocityMaterial(material, textureVelocity),
				),
				ownedByResourceCache: false,
			}
		: { materials: [...materials], ownedByResourceCache: true };
}

export function updateTextureVelocityMaterials(
	materialOwners: Iterable<{ material: Material | Material[] }>,
	elapsedSeconds: number,
): void {
	for (const owner of materialOwners) {
		for (const material of asMaterialArray(owner.material)) {
			const velocity = getTextureVelocityMaterialUserData(material);
			if (!velocity) {
				continue;
			}
			velocity.uniform.value.set(
				wrapUvOffset(velocity.uSpeed * elapsedSeconds),
				wrapUvOffset(velocity.vSpeed * elapsedSeconds),
			);
		}
	}
}

export function isTextureVelocityMaterial(material: Material): boolean {
	return Boolean(getTextureVelocityMaterialUserData(material));
}

export function deriveTextureVelocityMetrics(options: {
	parts: Iterable<TextureVelocityMetricPart>;
	groups: Iterable<TextureVelocityMetricGroup>;
	materialOwners: Iterable<{ material: Material | Material[] }>;
}): TextureVelocityMetrics {
	const signatures = new Set<string>();
	let textureVelocityPartCount = 0;
	for (const part of options.parts) {
		if (!part.textureVelocity) {
			continue;
		}
		textureVelocityPartCount += 1;
		signatures.add(part.textureVelocitySignature);
	}

	let textureVelocityRenderGroupCount = 0;
	for (const group of options.groups) {
		if (group.textureVelocity) {
			textureVelocityRenderGroupCount += 1;
		}
	}

	let textureVelocityMaterialCount = 0;
	for (const owner of options.materialOwners) {
		for (const material of asMaterialArray(owner.material)) {
			if (isTextureVelocityMaterial(material)) {
				textureVelocityMaterialCount += 1;
			}
		}
	}

	const textureVelocitySignatureSamples = [...signatures].sort();
	return {
		textureVelocityPartCount,
		textureVelocityRenderGroupCount,
		textureVelocityMaterialCount,
		textureVelocitySignatureCount: signatures.size,
		textureVelocitySignatureSamples: textureVelocitySignatureSamples.slice(
			0,
			TEXTURE_VELOCITY_SAMPLE_LIMIT,
		),
	};
}

function createTextureVelocityMaterial(
	material: Material,
	textureVelocity: TextureVelocityRenderState,
): Material {
	const clone = material.clone();
	const uniform = { value: new Vector2(0, 0) };
	const previousOnBeforeCompile = material.onBeforeCompile.bind(clone);
	const previousCustomProgramCacheKey =
		material.customProgramCacheKey.bind(material);
	clone.onBeforeCompile = (...args) => {
		previousOnBeforeCompile(...args);
		const shader = args[0] as TextureVelocityShader;
		shader.uniforms.holtburgerUvOffset = uniform;
		shader.vertexShader = shader.vertexShader.replace(
			"#include <uv_vertex>",
			`${uvVelocityUniformDeclaration()}\n#include <uv_vertex>\n#ifdef USE_MAP\n\tvMapUv += holtburgerUvOffset;\n#endif`,
		);
	};
	clone.customProgramCacheKey = () =>
		`${previousCustomProgramCacheKey()}|${TEXTURE_VELOCITY_PROGRAM_KEY}`;
	const userData = clone.userData as TextureVelocityMaterialUserData;
	userData.holtburgerTextureVelocity = {
		uSpeed: textureVelocity.uSpeed,
		vSpeed: textureVelocity.vSpeed,
		uniform,
	};
	return clone;
}

function getTextureVelocityMaterialUserData(
	material: Material,
): TextureVelocityMaterialUserData["holtburgerTextureVelocity"] | undefined {
	return (material.userData as TextureVelocityMaterialUserData)
		.holtburgerTextureVelocity;
}

function uvVelocityUniformDeclaration(): string {
	return "uniform vec2 holtburgerUvOffset;";
}

function wrapUvOffset(value: number): number {
	return value - Math.trunc(value);
}

function formatVelocityComponent(value: number): string {
	return Object.is(value, -0) ? "0" : value.toString();
}

function asMaterialArray(material: Material | Material[]): Material[] {
	return Array.isArray(material) ? material : [material];
}
