import type { GamePresentationOwner } from "../../lib/game/runtime/game-presentation-owner";
import { resolveSceneInterestRequest } from "../../lib/game/runtime/scene-target";
import { resolveSceneEnvironment } from "../../lib/game/environment/scene-environment";
import { createLandblockWorldOrigin } from "../../lib/game/landblocks";
import { sceneVec3, sceneVector3 } from "../../lib/assets/ac-frame";
import { Vec3 } from "../../lib/game/math/types";
import { createCameraRotationRadians } from "../../lib/game/math/camera-orientation";
import { CLIENT_TUNING } from "../../client/client-tuning";
import { CLIENT_GRAPHICS_DEFAULTS } from "../../client/client-settings-policy";

/** An outdoor consumer of the same scene/environment APIs, separate from the dungeon candidate. */
export async function probePregameOutdoorEnvironment(
	owner: GamePresentationOwner,
) {
	const runtime = owner.runtime;
	const landblockId = "0xda55ffff";
	const target = await resolveSceneInterestRequest(
		{ kind: "outdoor", landblockId },
		{
			terrainRadius: 1,
			buildingRadius: 0,
			explicitObjectRadius: 0,
			generatedObjectRadius: 0,
			envCellRadius: 0,
		},
		owner.profileSource,
	);
	const receipt = await runtime.activateScene({ generation: 0, target });
	const dayGroupOverride = owner.activeRegion.data.sky?.dayGroups.findIndex(
		(group) => /rain/i.test(group.dayName),
	);
	if (dayGroupOverride === undefined || dayGroupOverride < 0)
		throw new Error("Outdoor proof requires authored rainy sky");
	const environment = resolveSceneEnvironment(owner.activeRegion, {
		dayIndex: 0,
		timeOfDay: 0.5,
		dayGroupOverride,
	});
	const origin = createLandblockWorldOrigin(landblockId);
	const position = sceneVec3(new Vec3(origin.x + 96, 100, origin.z - 96));
	const rotation = createCameraRotationRadians(0, -Math.PI / 6);
	const deadline = performance.now() + 45_000;
	try {
		for (;;) {
			runtime.pollPortalTransitionLoading();
			const status = runtime.sceneActivationStatus(receipt);
			if (status.kind === "failed") throw new Error(status.diagnostic);
			if (status.kind === "ready") {
				runtime.setSceneEnvironment(environment);
				runtime.setPrimaryView({
					camera: {
						fov: CLIENT_GRAPHICS_DEFAULTS.verticalFovDegrees,
						near: CLIENT_TUNING.camera.near,
						far: CLIENT_TUNING.camera.far,
						placement: { landblockId, envCellId: null, position, rotation },
					},
					extent: runtime.resolveViewportExtent(512, 512),
				});
				runtime.setAudioListener({
					position: sceneVector3([position.x, position.y, position.z]),
					rotation,
					envCellId: null,
				});
				runtime.frame(performance.now() / 1000);
				const state = runtime.getAuthoredDynamicRuntimeDiagnostics();
				if (
					state.skyScripts.activeCount > 0 &&
					state.particles.emitterCount > 0 &&
					state.audio.playedCount > 0
				)
					return {
						dayGroup: environment.sky?.dayGroupName,
						activeSkyScripts: state.skyScripts.activeCount,
						emitters: state.particles.emitterCount,
						playedSounds: state.audio.playedCount,
						scheduledAmbientSounds: state.ambient.scheduledCount,
					};
			}
			if (performance.now() > deadline)
				throw new Error(
					`Outdoor environment did not activate: ${JSON.stringify(runtime.getAuthoredDynamicRuntimeDiagnostics())}`,
				);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => resolve()),
			);
		}
	} finally {
		runtime.setAudioListener(null);
		runtime.clearSceneInterest();
	}
}
