export interface TextureVelocityRenderState {
	uSpeed: number;
	vSpeed: number;
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

function formatVelocityComponent(value: number): string {
	return Object.is(value, -0) ? "0" : value.toString();
}
