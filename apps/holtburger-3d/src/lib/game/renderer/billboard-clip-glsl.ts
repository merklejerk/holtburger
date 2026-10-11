/** Shared clip-space offset for camera-facing text quads; callers own size/distance policy. */
export const BILLBOARD_CLIP_GLSL = `
vec4 offsetBillboardClip(vec4 clip, vec2 pixels, vec2 viewport, float distanceScale) {
    clip.xy += pixels * (2.0 / viewport) * distanceScale;
    return clip;
}
`;
