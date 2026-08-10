import { PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT } from "./portal-arrival-metadata";
import { PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES } from "./portal-propagation-metadata";

/** One binding shared by propagation, resolve, and deferred visibility programs. */
export const PORTAL_SCOPE_ATLAS_METADATA_BINDING_POINT = 0;

/** Link-visible name of the fixed scope-atlas metadata block. */
const PORTAL_SCOPE_ATLAS_METADATA_BLOCK_NAME = "PortalScopeAtlasMetadata";

/** std140 declarations shared verbatim by every scope-atlas shader family. */
export const PORTAL_SCOPE_ATLAS_METADATA_GLSL = `
struct PortalArrivalMetadata {
	vec4 entryPlane;
	uvec4 route;
};

struct PortalScopeMetadata {
	uvec4 atlasAndScreenOrigin;
	uvec4 extentAndReserved;
};

layout(std140) uniform ${PORTAL_SCOPE_ATLAS_METADATA_BLOCK_NAME} {
	mat4 uClipFromAnchor;
	PortalArrivalMetadata uArrivals[${PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT}];
	PortalScopeMetadata uScopes[${PORTAL_ARRIVAL_STATE_MAXIMUM_COUNT}];
};
`;

/** Bind and validate the one fixed metadata block after a program links. */
export function bindPortalScopeAtlasMetadataBlock(
	gl: WebGL2RenderingContext,
	program: WebGLProgram,
	bindingPoint: number,
): void {
	const block = gl.getUniformBlockIndex(
		program,
		PORTAL_SCOPE_ATLAS_METADATA_BLOCK_NAME,
	);
	if (block === gl.INVALID_INDEX) {
		throw new Error(
			`Portal scope-atlas program is missing ${PORTAL_SCOPE_ATLAS_METADATA_BLOCK_NAME}.`,
		);
	}
	const byteLength = gl.getActiveUniformBlockParameter(
		program,
		block,
		gl.UNIFORM_BLOCK_DATA_SIZE,
	) as number;
	if (byteLength !== PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES) {
		throw new Error(
			`Portal scope-atlas metadata block is ${byteLength} bytes; expected ${PORTAL_PROPAGATION_METADATA_CAPACITY_BYTES}.`,
		);
	}
	gl.uniformBlockBinding(program, block, bindingPoint);
}
