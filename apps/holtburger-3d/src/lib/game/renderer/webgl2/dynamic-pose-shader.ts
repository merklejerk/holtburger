/** Shared matrix decoding for merged rigid selection, shadow, and subsequent color consumers. */
export const DYNAMIC_POSE_GLSL = `
uniform highp sampler2D uPoses;
uniform int uFirstPoseRow;

mat4 dynamicSourceToLandblock(uint selector) {
	int row = uFirstPoseRow + int(selector);
	return mat4(
		texelFetch(uPoses, ivec2(0, row), 0),
		texelFetch(uPoses, ivec2(1, row), 0),
		texelFetch(uPoses, ivec2(2, row), 0),
		texelFetch(uPoses, ivec2(3, row), 0));
}
`;
