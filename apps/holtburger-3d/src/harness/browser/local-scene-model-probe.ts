import { createTranslationMat4 } from "../../lib/game/math/matrices";
import type { ClientPregameLocation } from "../../client/client-pregame-tuning";
import { renderVector } from "../../lib/assets/ac-frame";
import { scopeFor } from "../../lib/game/scene/scope";
import type { Mat4 } from "../../lib/game/math/types";
import type { SceneNodeId, SceneSpatialPlacement } from "../../lib/game/scene";
import { DynamicEntitySystem } from "../../lib/game/systems/dynamic-entity-system";
import type { GamePresentationRuntime } from "../../lib/game/runtime/game-presentation-runtime";
import type { LocalSceneModelSource } from "../../lib/game/runtime/local-scene-model";

/** Observe production scene calls in the harness rather than adding diagnostic APIs to local handles. */
export async function probeLocalSceneModel(
	runtime: GamePresentationRuntime,
	source: LocalSceneModelSource,
	location: ClientPregameLocation,
	frame: () => Promise<void>,
) {
	const [x, y, z] = location.character.position;
	const placement: SceneSpatialPlacement = {
		landblockId: location.landblockId,
		envCellId: location.character.envCellId,
		localTransform: createTranslationMat4(renderVector(x, y, z)),
		spatialMembership: {
			scopes: [scopeFor(location.landblockId, location.character.envCellId)],
		},
	};
	const original = DynamicEntitySystem.prototype.getVisiblePresentation;
	const observed = new Map<
		string,
		{ nodeId: SceneNodeId; transform: Mat4; partTransforms: readonly Mat4[] }
	>();
	DynamicEntitySystem.prototype.getVisiblePresentation = function (nodeId) {
		const presentation = original.call(this, nodeId);
		if (
			presentation !== null &&
			presentation.identity.startsWith("local-model:")
		) {
			if (
				presentation.landblockId !== placement.landblockId ||
				!presentation.renderScopes.some(
					(scope) =>
						scope.kind === "env-cell" &&
						scope.envCellId === placement.envCellId,
				)
			)
				throw new Error("Local model lost its scene membership.");
			const part = presentation.visual.parts[0];
			if (part === undefined)
				throw new Error("Local model has no rendered parts.");
			observed.set(presentation.identity, {
				nodeId,
				transform: part.frameInstance.sourceToLandblock.clone(),
				partTransforms: presentation.visual.parts.map((rendered) =>
					rendered.localToVisualRoot.clone(),
				),
			});
		}
		return presentation;
	};
	const baseline = runtime.getAuthoredDynamicRuntimeDiagnostics();
	const handle = runtime.createLocalSceneModel(placement);
	const installed = async (input: LocalSceneModelSource) => {
		const result = await handle.replace("probe-subject", input);
		if (result.kind !== "installed")
			throw new Error(
				`Local model admission failed: ${JSON.stringify(result)}`,
			);
	};
	const framingSupport = () => {
		const status = handle.status();
		if (status.kind !== "ready")
			throw new Error("Local model has no prepared framing support.");
		return JSON.stringify({
			center: status.fit.center,
			supportPoints: Array.from(status.fit.supportPoints),
		});
	};
	try {
		await installed(source);
		const equippedSupport = framingSupport();
		handle.setVisible(true);
		const modelCount = 1 + source.attachments.length;
		for (let index = 0; index < 120 && observed.size !== modelCount; index++)
			await frame();
		if (observed.size !== modelCount)
			throw new Error(
				`World renderer observed ${observed.size}/${modelCount} local models.`,
			);
		const before = new Map(observed);
		const body = [...before.entries()].find(([identity]) =>
			identity.endsWith("/body"),
		);
		if (body === undefined)
			throw new Error("World renderer did not observe the local body.");
		let animated = false;
		for (let index = 0; index < 120 && !animated; index++) {
			await frame();
			animated = [...observed].some(
				([identity, model]) =>
					JSON.stringify(before.get(identity)?.partTransforms) !==
					JSON.stringify(model.partTransforms),
			);
		}
		if (source.body.pose.kind === "default-idle" && !animated)
			throw new Error(
				`Scene idle did not advance rendered rigid parts: ${JSON.stringify({ pose: source.body.pose, runtime: runtime.getAuthoredDynamicRuntimeDiagnostics().animation })}`,
			);
		await installed({
			...source,
			body: {
				...source.body,
				appearance: {
					...source.body.appearance,
					subPalettes: [...source.body.appearance.subPalettes],
				},
			},
		});
		await frame();
		if (
			[...observed].some(
				([identity, model]) => before.get(identity)?.nodeId !== model.nodeId,
			)
		)
			throw new Error(
				"Compatible appearance edit replaced the local scene nodes.",
			);
		// Invalid explicit playback fails locally before publication, without inventing missing DATs.
		const failure = await handle.replace("probe-subject", {
			...source,
			body: {
				...source.body,
				pose: { kind: "default-idle", clips: [], firstCyclicClip: 0 },
			},
		});
		if (failure.kind !== "failed" || handle.status().kind !== "ready")
			throw new Error(
				"Failed scene replacement discarded its last-good model.",
			);
		observed.clear();
		handle.setVisible(false);
		await frame();
		if (observed.size !== 0)
			throw new Error("Suspended local model remained drawable.");
		handle.setVisible(true);
		await frame();
		if (observed.size !== modelCount)
			throw new Error("Local model did not resume drawing.");
		if (source.attachments.length === 0)
			throw new Error("Equipment framing probe requires held equipment.");
		await installed({
			...source,
			attachments: source.attachments.map((attachment) => ({
				...attachment,
				visual: { ...attachment.visual, scale: attachment.visual.scale * 10 },
			})),
		});
		if (framingSupport() !== equippedSupport)
			throw new Error("Equipment size changed the character framing support.");
		await installed({ ...source, attachments: [] });
		if (framingSupport() !== equippedSupport)
			throw new Error(
				"Removing equipment changed the character framing support.",
			);
		await handle.destroy();
		await frame();
		const retired = runtime.getAuthoredDynamicRuntimeDiagnostics();
		if (
			retired.dynamics.entityCount !== baseline.dynamics.entityCount ||
			retired.animation.activePlaybackCount !==
				baseline.animation.activePlaybackCount
		)
			throw new Error(
				"Local model retirement retained scene or animation resources.",
			);
		return {
			modelCount,
			equipmentIndependentFraming: true,
			animated,
			compatibleAppearanceRetainedNodes: true,
			failedReplacementRetainedVisual: true,
			suspensionResumed: true,
			retired: true,
			frames: [...before].map(([identity, model]) => ({
				identity,
				nodeId: model.nodeId,
				transform: model.transform,
			})),
		};
	} finally {
		DynamicEntitySystem.prototype.getVisiblePresentation = original;
		await handle.destroy();
	}
}
