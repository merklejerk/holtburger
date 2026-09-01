import { createWebGL2PssmCasterProgram } from "./webgl2-pssm-caster-program";
import { WebGL2OutdoorPssmReceiverPrograms } from "./webgl2-pssm-receiver-programs";
import { WebGL2EntityGroundingPrograms } from "./webgl2-entity-grounding-programs";
import {
	WebGL2PssmShadowTargets,
	type WebGL2PssmShadowTargetDiagnostics,
} from "./webgl2-pssm-shadow-targets";

const INITIAL_CONFIGURATION = { cascadeCount: 1, resolution: 256 } as const;
const RESIZED_CONFIGURATION = { cascadeCount: 2, resolution: 512 } as const;

/** Real-browser evidence for the outdoor depth-array format, lifecycle, and caster shader. */
export interface WebGL2PssmFixtureResult {
	readonly casterProgramLinked: boolean;
	readonly groundingProgramsLinked: boolean;
	readonly receiverProgramsLinked: boolean;
	readonly disposedDiagnostics: WebGL2PssmShadowTargetDiagnostics;
	readonly initialDiagnostics: WebGL2PssmShadowTargetDiagnostics;
	readonly initialLayersComplete: boolean;
	readonly initialResourcesValid: boolean;
	readonly resizedDiagnostics: WebGL2PssmShadowTargetDiagnostics;
	readonly resizedLayersComplete: boolean;
	readonly resizedResourcesValid: boolean;
	readonly resizedTargetReplaced: boolean;
	readonly sameConfigurationReused: boolean;
}

/** Compile and validate the production PSSM resources directly against one browser context. */
export function runWebGL2PssmFixture(
	gl: WebGL2RenderingContext,
): WebGL2PssmFixtureResult {
	requireNoWebGL2Error(gl, "before outdoor PSSM fixture");
	const previousDraw = gl.getParameter(
		gl.DRAW_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	const previousRead = gl.getParameter(
		gl.READ_FRAMEBUFFER_BINDING,
	) as WebGLFramebuffer | null;
	const targets = new WebGL2PssmShadowTargets(gl);
	const receiverPrograms = new WebGL2OutdoorPssmReceiverPrograms(gl);
	const groundingPrograms = new WebGL2EntityGroundingPrograms(gl);
	let casterProgram: WebGLProgram | null = null;
	try {
		const initial = targets.resize(
			INITIAL_CONFIGURATION.resolution,
			INITIAL_CONFIGURATION.cascadeCount,
		);
		const initialDiagnostics = targets.getDiagnostics();
		const initialLayersComplete = layersComplete(
			gl,
			targets,
			initial.cascadeCount,
		);
		const initialResourcesValid = resourcesValid(gl, initial);
		const sameConfigurationReused =
			targets.resize(
				INITIAL_CONFIGURATION.resolution,
				INITIAL_CONFIGURATION.cascadeCount,
			) === initial;
		const resized = targets.resize(
			RESIZED_CONFIGURATION.resolution,
			RESIZED_CONFIGURATION.cascadeCount,
		);
		const resizedDiagnostics = targets.getDiagnostics();
		const resizedLayersComplete = layersComplete(
			gl,
			targets,
			resized.cascadeCount,
		);
		const resizedResourcesValid = resourcesValid(gl, resized);
		const compiled = createWebGL2PssmCasterProgram(gl);
		casterProgram = compiled.program;
		const casterProgramLinked =
			gl.isProgram(casterProgram) &&
			Boolean(gl.getProgramParameter(casterProgram, gl.LINK_STATUS));
		const receivers = [
			receiverPrograms.terrain(),
			receiverPrograms.directionalTerrain(),
			receiverPrograms.hybridTerrain(),
			receiverPrograms.foggedBaked(),
			receiverPrograms.foggedInstanced(),
			receiverPrograms.blendedBaked(false),
			receiverPrograms.blendedInstanced(false),
			receiverPrograms.blendedBaked(true),
			receiverPrograms.blendedInstanced(true),
		];
		const receiverProgramsLinked = receivers.every(
			(receiver) =>
				gl.isProgram(receiver.program) &&
				Boolean(gl.getProgramParameter(receiver.program, gl.LINK_STATUS)),
		);
		const groundingReceivers = [
			groundingPrograms.fogged(),
			groundingPrograms.blended(false),
			groundingPrograms.blended(true),
		];
		const groundingProgramsLinked = groundingReceivers.every(
			(receiver) =>
				gl.isProgram(receiver.program) &&
				Boolean(gl.getProgramParameter(receiver.program, gl.LINK_STATUS)),
		);
		requireNoWebGL2Error(gl, "after outdoor PSSM fixture");
		targets.disable();
		return {
			casterProgramLinked,
			groundingProgramsLinked,
			receiverProgramsLinked,
			disposedDiagnostics: targets.getDiagnostics(),
			initialDiagnostics,
			initialLayersComplete,
			initialResourcesValid,
			resizedDiagnostics,
			resizedLayersComplete,
			resizedResourcesValid,
			resizedTargetReplaced: resized !== initial,
			sameConfigurationReused,
		};
	} finally {
		if (casterProgram) gl.deleteProgram(casterProgram);
		groundingPrograms.destroy();
		receiverPrograms.destroy();
		targets.destroy();
		gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDraw);
		gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousRead);
	}
}

function layersComplete(
	gl: WebGL2RenderingContext,
	targets: WebGL2PssmShadowTargets,
	cascadeCount: number,
): boolean {
	for (let layer = 0; layer < cascadeCount; layer += 1) {
		targets.attachLayer(layer);
		if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
			return false;
		}
	}
	return true;
}

function resourcesValid(
	gl: WebGL2RenderingContext,
	targets: ReturnType<WebGL2PssmShadowTargets["resize"]>,
): boolean {
	return gl.isFramebuffer(targets.framebuffer) && gl.isTexture(targets.depth);
}

function requireNoWebGL2Error(
	gl: WebGL2RenderingContext,
	checkpoint: string,
): void {
	const error = gl.getError();
	if (error !== gl.NO_ERROR) {
		throw new Error(`WebGL2 error ${error} observed ${checkpoint}.`);
	}
}
