import { CLIENT_PREGAME_CAMERA_TUNING } from "../../client/client-pregame-tuning";
import { creationFaceFraming } from "../../client/client-character-creation";
import type { ObjectPreviewVisual } from "../../lib/game/runtime/object-preview-source";
import { DynamicEntitySystem } from "../../lib/game/systems/dynamic-entity-system";
import type { SceneNodeId, SceneSpatialPlacement } from "../../lib/game/scene";
import type { ClientPresentationRoot } from "../../client/client-presentation-root";
import type {
	PregameCharacterStatus,
	PregameCharacterView,
} from "../../client/client-pregame-character";
import type { RuntimeLight } from "../../lib/game/environment/runtime-lights";
import type { GamePresentationOwner } from "../../lib/game/runtime/game-presentation-owner";
import {
	LocalSceneModelHandle,
	type LocalSceneModelSource,
} from "../../lib/game/runtime/local-scene-model";
import { createLandblockWorldOrigin } from "../../lib/game/landblocks";
import { transformPoint3 } from "../../lib/game/math/matrices";
import type { Camera } from "../../lib/game/runtime/types";
import { Vec3 } from "../../lib/game/math/types";

/** Production resolver output retained for all-body scene admission, without asset-dependent unit fixtures. */
export interface CreationSceneSample {
	readonly heritage: number;
	readonly gender: number;
	readonly body: ObjectPreviewVisual;
}

/** Numeric checks of the production pregame scene, including frozen-time lighting readbacks. */
export async function probePregameSceneComposition(
	root: ClientPresentationRoot<GamePresentationOwner>,
	owner: GamePresentationOwner,
	source: LocalSceneModelSource,
	frame: () => Promise<void>,
	readPixels: () => Uint8Array,
	creationSamples: readonly CreationSceneSample[],
	appearanceEdits: readonly ObjectPreviewVisual[],
) {
	const runtime = owner.runtime;
	const placeModel = LocalSceneModelHandle.prototype.setPlacement;
	let placed: {
		readonly placement: SceneSpatialPlacement;
		readonly center: Vec3;
	} | null = null;
	LocalSceneModelHandle.prototype.setPlacement = function (placement) {
		const status = this.status();
		if (status.kind === "ready")
			placed = { placement, center: status.fit.center };
		placeModel.call(this, placement);
	};
	const currentPlaced = () => placed;

	const setView = runtime.setPrimaryView.bind(runtime);
	const setLights = runtime.setPresentationLights.bind(runtime);
	const worldFrame = runtime.frame.bind(runtime);
	const setListener = runtime.setAudioListener.bind(runtime);
	const initialSounds =
		runtime.getAuthoredDynamicRuntimeDiagnostics().audio.playedCount;
	runtime.setAudioListener = (listener) => {
		if (listener !== null)
			throw new Error("Pregame enabled a world audio listener.");
		setListener(listener);
	};
	let camera: Camera | null = null;
	let lights: readonly RuntimeLight[] = [];
	let time = 0;
	runtime.setPrimaryView = (view) => {
		camera = view.camera;
		setView(view);
	};
	runtime.setPresentationLights = (next) => {
		lights = next;
		setLights(next);
	};
	runtime.frame = (next) => {
		time = next;
		worldFrame(next);
		if (
			runtime.getAuthoredDynamicRuntimeDiagnostics().audio.playedCount !==
			initialSounds
		)
			throw new Error("Pregame played world audio.");
	};
	let status: PregameCharacterStatus = { kind: "empty" };
	const currentStatus = () => status;
	const currentCamera = () => camera;
	const currentLights = () => lights;
	const assertFacingCamera = (focus?: Vec3) => {
		const model = currentPlaced();
		const camera = currentCamera();
		if (model === null || camera === null)
			throw new Error("Missing rendered model/camera for facing check.");
		const origin = createLandblockWorldOrigin(model.placement.landblockId);
		const center = transformPoint3(
			model.placement.localTransform,
			new Vec3(0, (focus === undefined ? model.center : focus).y, 0),
		);
		const dx = camera.placement.position.x - origin.x - center.x;
		const dz = camera.placement.position.z - origin.z - center.z;
		const length = Math.hypot(dx, dz);
		const transform = model.placement.localTransform;
		if (
			Math.abs(-transform.m31 - dx / length) > 1e-8 ||
			Math.abs(-transform.m33 - dz / length) > 1e-8
		)
			throw new Error(
				"Pregame model does not face the fitted camera position.",
			);
	};

	const replace = DynamicEntitySystem.prototype.replaceOwner;
	const localRoots = new Map<SceneNodeId, () => SceneNodeId | null>();
	let sourceScaleUnchanged = false;
	DynamicEntitySystem.prototype.replaceOwner = function (owner, sources) {
		const installation = replace.call(this, owner, sources);
		if (owner.startsWith("local-model:")) {
			if (localRoots.size === 0) {
				const originals = [
					source.body,
					...source.attachments.map((item) => item.visual),
				];
				sourceScaleUnchanged = sources.every(
					(item, index) =>
						item.source.scale.x === originals[index]?.scale &&
						item.source.scale.y === originals[index]?.scale &&
						item.source.scale.z === originals[index]?.scale,
				);
			}
			for (const node of installation.nodeIds)
				localRoots.set(node, () => this.modelRootOf(node));
		}
		return installation;
	};
	const allLocalRootsRetired = () =>
		[...localRoots.values()].every((read) => read() === null);
	const surface = root.pregameCharacters.open(
		(next) => {
			status = next;
		},
		() => {},
	);
	const view: PregameCharacterView = {
		rectangle: { left: 0, top: 0, width: 512, height: 512 },
		headingRadians: 0,
		framing: { kind: "body" },
	};
	const settle = async (kind: PregameCharacterStatus["kind"]) => {
		const deadline = performance.now() + 30_000;
		for (;;) {
			await frame();
			const state = currentStatus();
			if (
				state.kind === kind &&
				(state.kind !== "ready" || state.replacement.kind === "settled")
			)
				return;
			if (state.kind === "ready" && state.replacement.kind === "failed")
				throw new Error(state.replacement.message);
			if (state.kind === "failed") throw new Error(state.message);
			if (performance.now() >= deadline)
				throw new Error(
					`Pregame character did not reach ${kind}: ${JSON.stringify(state)}`,
				);
		}
	};
	const assertStableTurn = async (turnView: PregameCharacterView) => {
		const baseline = currentCamera();
		if (baseline === null)
			throw new Error("Missing camera before rotation sweep.");
		for (let step = 1; step <= 12; step++) {
			surface.setView({ ...turnView, headingRadians: (step * Math.PI) / 6 });
			await settle("ready");
			const turned = currentCamera();
			if (
				turned === null ||
				JSON.stringify(turned.placement.position) !==
					JSON.stringify(baseline.placement.position)
			)
				throw new Error("Pregame camera moved while turning the character.");
		}
		surface.setView(turnView);
		await settle("ready");
	};
	try {
		surface.setView(view);
		surface.setSource({ subjectId: "scene-composition-probe", visual: source });
		await settle("ready");
		assertFacingCamera();
		await assertStableTurn(view);
		surface.setView({
			...view,
			rectangle: { left: 128, top: 0, width: 368, height: 512 },
		});
		await settle("ready");
		assertFacingCamera();
		surface.setView(view);
		await settle("ready");
		const bodyCamera = currentCamera();
		if (bodyCamera === null)
			throw new Error("Pregame scene did not install its camera.");
		const fill = currentLights();
		if (fill.length !== 1)
			throw new Error(
				"Pregame scene did not supply exactly one ordinary fill light.",
			);
		// Re-render at one clock instant so animation/weather cannot explain the pixel difference.
		runtime.render(time);
		const enabled = readPixels();
		runtime.setPresentationLights([]);
		runtime.render(time);
		const disabled = readPixels();
		runtime.setPresentationLights(fill);
		runtime.render(time);
		const restored = readPixels();
		let lightChangedPixels = 0,
			restorationDifferences = 0;
		for (let index = 0; index < enabled.length; index += 4) {
			if (
				enabled[index] !== disabled[index] ||
				enabled[index + 1] !== disabled[index + 1] ||
				enabled[index + 2] !== disabled[index + 2]
			)
				lightChangedPixels++;
			if (
				enabled[index] !== restored[index] ||
				enabled[index + 1] !== restored[index + 1] ||
				enabled[index + 2] !== restored[index + 2]
			)
				restorationDifferences++;
		}
		if (lightChangedPixels === 0 || restorationDifferences !== 0)
			throw new Error(
				`Fill-light readback was not a reproducible contribution: ${JSON.stringify({ lightChangedPixels, restorationDifferences, camera: bodyCamera, containingCells: runtime.queryWorldPointResidencyCandidates(bodyCamera.placement.position)?.envCells.filter((cell) => cell.containsPoint), fill, dynamics: runtime.getAuthoredDynamicRuntimeDiagnostics().dynamics })}`,
			);
		const originalRootCount = localRoots.size;
		for (const body of appearanceEdits) {
			surface.setSource({
				subjectId: "scene-composition-probe",
				visual: { ...source, body },
			});
			await settle("ready");
			if (localRoots.size !== originalRootCount)
				throw new Error(
					"Compatible production appearance edit replaced the body/equipment scene roots.",
				);
		}
		surface.setSource({ subjectId: "scene-composition-probe", visual: source });
		await settle("ready");

		const faceView: PregameCharacterView = {
			...view,
			framing: {
				kind: "face",
				center: new Vec3(0, 1.65 * source.body.scale, 0),
				height: 0.5 * source.body.scale,
			},
		};
		surface.setView(faceView);
		await settle("ready");
		const startedMs = time * 1000;
		const focusPositions = new Set<string>();
		const firstFocusCamera = currentCamera();
		if (firstFocusCamera === null)
			throw new Error("Missing focus start camera");
		focusPositions.add(JSON.stringify(firstFocusCamera.placement.position));
		while (
			time * 1000 - startedMs <
			CLIENT_PREGAME_CAMERA_TUNING.transitionMs
		) {
			await frame();
			const camera = currentCamera();
			if (camera === null) throw new Error("Missing focus animation camera");
			focusPositions.add(JSON.stringify(camera.placement.position));
		}
		if (
			!window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
			focusPositions.size < 3
		)
			throw new Error(
				`Focus transition did not traverse an intermediate camera pose: ${focusPositions.size}`,
			);
		assertFacingCamera(new Vec3(0, 1.65 * source.body.scale, 0));
		await assertStableTurn(faceView);
		const faceCamera = currentCamera();
		if (
			faceCamera === null ||
			faceCamera.near !== bodyCamera.near ||
			faceCamera.far !== bodyCamera.far ||
			JSON.stringify(faceCamera.placement.position) ===
				JSON.stringify(bodyCamera.placement.position)
		)
			throw new Error(
				"Face focus did not move the world camera while preserving its clipping planes.",
			);
		surface.setView({ ...view, rectangle: { ...view.rectangle, width: 2 } });
		await settle("limited");
		if (currentLights().length !== 0)
			throw new Error("Limited framing retained the character fill light.");
		surface.setView(view);
		await settle("ready");
		let sceneCreationBodies = 0;
		for (const sample of creationSamples) {
			surface.setView(view);
			surface.setSource({
				subjectId: `creation:${sample.heritage}/${sample.gender}`,
				visual: { body: sample.body, attachments: [] },
			});
			await settle("ready");
			surface.setView({
				...view,
				framing: creationFaceFraming(sample.heritage, sample.body.scale),
			});
			await settle("ready");
			sceneCreationBodies++;
		}

		await root.setMode("idle");
		if (currentLights().length !== 0 || !allLocalRootsRetired())
			throw new Error("Pregame handoff retained local models or fill lights.");
		await root.setMode("pregame");
		await settle("ready");
		surface.setSource(null);
		await settle("empty");
		surface.destroy();
		if (currentLights().length !== 0 || !allLocalRootsRetired())
			throw new Error("Surface withdrawal retained local scene resources.");
		if (!sourceScaleUnchanged)
			throw new Error("Pregame composition changed source model scale.");
		return {
			sourceScaleUnchanged,
			cameraFacingVerified: true,
			rotationStableCameraVerified: true,
			pregameWorldAudioSilent: true,
			sceneCreationBodies,
			compatibleSceneAppearanceEdits: appearanceEdits.length,
			lightChangedPixels,
			restorationDifferences,
			faceCameraMoved: true,
			focusTransitionPoses: focusPositions.size,
			limitationsRecovered: true,
			handoffClearedModelsAndLight: true,
			desiredSourceSurvivedDriverReplacement: true,
		};
	} finally {
		surface.destroy();
		DynamicEntitySystem.prototype.replaceOwner = replace;
		LocalSceneModelHandle.prototype.setPlacement = placeModel;
		runtime.setPrimaryView = setView;
		runtime.setPresentationLights = setLights;
		runtime.frame = worldFrame;
		runtime.setAudioListener = setListener;
	}
}
