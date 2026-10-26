import type { CharacterCreationPreview } from "../../client/client-character-creation-contract";
import type {
	ObjectPreviewSource,
	ObjectPreviewVisual,
} from "../../lib/game/runtime/object-preview-source";
import type { PresentationAssetService } from "../../lib/game/runtime/presentation-asset-service";
import { acquireObjectPreviewAssets } from "../../lib/game/preview/object-preview-composition";
import { ObjectPreviewPresentation } from "../../lib/game/preview/object-preview-presentation";
import { AnimationSequence } from "../../lib/game/animation/animation-sequence";
import { resolveObjectPreviewViewport } from "../../lib/game/preview/object-preview-viewport";
import {
	composeObjectPartFrame,
	composeObjectPartTransform,
} from "../../lib/game/resolution/object-part-transform";
import { resolvePlacementPose } from "../../lib/game/resolution/presentation";
import { mat4ToFloat32Array, multiplyMat4 } from "../../lib/game/math/matrices";
import { resolveObjectPreviewCompositionView } from "../../lib/game/renderer/object-preview-camera";
import { Mat4 } from "../../lib/game/math/types";

// Read-only catalog census: Short Sword WCID 352 and Round Shield WCID 93. Their source facts
// were classified through world::classify_wielded_item; shield placement 6 resolves to fallback 0.
const SAMPLES = [
	{
		wcid: 352,
		setupDid: 0x02000148,
		parentLocation: "right-hand",
		placement: 1,
	},
	{ wcid: 93, setupDid: 0x02000162, parentLocation: "shield", placement: 6 },
] as const;

/** Known-content composition used to exercise the same render path as later captured equipment. */
export function pregameEquipmentComposition(
	preview: CharacterCreationPreview,
	body: ObjectPreviewVisual,
): ObjectPreviewSource {
	const appearance = {
		paletteDid: null,
		subPalettes: [],
		textureChanges: [],
		partChanges: [],
	};
	return {
		body,
		attachments: SAMPLES.map((sample) => ({
			parentLocation: sample.parentLocation,
			placement: sample.placement,
			visual: {
				setupDid: sample.setupDid,
				appearance,
				scale: 1,
				translucency: 0,
				pose: { kind: "setup-pose" },
			},
		})),
		background:
			preview.backgroundSetupDid === null
				? null
				: {
						setupDid: preview.backgroundSetupDid,
						appearance,
						scale: 1,
						translucency: 0,
						pose: { kind: "setup-pose" },
					},
	};
}

/** Machine evidence of actual compiled pose indices, effective placement and background isolation. */
export async function probePregameEquipmentFrames(
	assets: PresentationAssetService,
	source: ObjectPreviewSource,
): Promise<{
	readonly attachmentPlacements: readonly {
		readonly wcid: number;
		readonly requested: number;
		readonly resolved: number;
		readonly partFramesChecked: number;
	}[];
	readonly subjectRotationPreservedBackdrop: boolean;
	readonly inspectionOrbitStable: boolean;
}> {
	const lease = await acquireObjectPreviewAssets(assets, source);
	const playback = new ObjectPreviewPresentation(lease.assets, null);
	try {
		let orbitRadius: number | null = null;
		let orbitRoot: Mat4 | null = null;
		for (let step = 0; step <= 72; step++) {
			const camera = resolveObjectPreviewCompositionView(
				lease.assets.fit,
				null,
				resolveObjectPreviewViewport({
					extent: { width: 320, height: 480 },
					minimumFrameIntervalSeconds: 1 / 30,
					rotation: { kind: "orbit", yawRadians: (step * Math.PI) / 36 },
					framing: { kind: "body" },
				}),
			);
			const radius = Math.hypot(
				camera.cameraPosition.x,
				camera.cameraPosition.y,
				camera.cameraPosition.z,
			);
			if (
				orbitRadius !== null &&
				(Math.abs(radius - orbitRadius) > 1e-8 ||
					(orbitRoot !== null && !sameMatrix(camera.objectRoot, orbitRoot)))
			)
				throw new Error("Inspection orbit changed its radius or pivot.");
			orbitRadius = radius;
			orbitRoot = camera.objectRoot;
		}
		const body = lease.assets.body.visual;
		const sequence = new AnimationSequence(
			body.clips,
			body.firstCyclicClip,
			body.setupPose,
		);
		const attachmentPlacements = [];
		let clock = 0;
		for (const [index, sample] of SAMPLES.entries()) {
			const attachment = lease.assets.attachments[index];
			if (attachment === undefined)
				throw new Error("Equipment probe omitted an expected attachment.");
			const child = attachment.model.visual;
			const point = body.source.presentation.holdingLocations.get(
				sample.parentLocation,
			);
			if (point === undefined)
				throw new Error(`Creation body lacks ${sample.parentLocation}.`);
			const placement = resolvePlacementPose(
				child.source.presentation,
				sample.placement,
			);
			let partFramesChecked = 0;
			for (const elapsed of [0, 0.1, 0.1]) {
				clock += elapsed;
				sequence.advance(elapsed, () => undefined);
				const actual = playback.advance(clock, Mat4.identity());
				const part = sequence.samplePose()[point.partIndex];
				if (part === undefined)
					throw new Error("Holding location names an absent animated part.");
				const holding = multiplyMat4(
					composeObjectPartFrame(part, body.scale, Mat4.identity()),
					point.offsetTransform,
				);
				const authoredRoot = sequence.sampleAuthoredRoot();
				const root =
					authoredRoot === null ? holding : multiplyMat4(authoredRoot, holding);
				for (const childPart of child.template.parts) {
					const pose = placement.partTransforms[childPart.partIndex];
					if (pose === undefined)
						throw new Error("Equipment placement omits a setup part.");
					const expected = multiplyMat4(
						root,
						composeObjectPartTransform(
							pose,
							child.scale,
							childPart.defaultScale,
						),
					);
					const current =
						actual.partToPreview[
							attachment.model.partOffset + childPart.partIndex
						];
					if (current === undefined || !sameMatrix(current, expected))
						throw new Error(
							`Compiled preview placement differs from retail part composition for WCID ${sample.wcid}.`,
						);
					partFramesChecked++;
				}
			}
			attachmentPlacements.push({
				wcid: sample.wcid,
				requested: sample.placement,
				resolved: placement.placementId,
				partFramesChecked,
			});
		}
		const background = lease.assets.background;
		const backgroundPart = background?.visual.template.parts[0];
		const bodyPart = body.template.parts[0];
		if (
			background === null ||
			backgroundPart === undefined ||
			bodyPart === undefined
		)
			throw new Error("Heading probe needs subject and backdrop geometry.");
		const before = playback.advance(clock, Mat4.identity());
		const backdrop =
			before.partToPreview[
				background.partOffset + backgroundPart.partIndex
			]?.clone();
		const subject = before.partToPreview[bodyPart.partIndex]?.clone();
		const turned = resolveObjectPreviewViewport({
			extent: { width: 512, height: 512 },
			minimumFrameIntervalSeconds: 1 / 30,
			rotation: {
				kind: "subject",
				headingRadians: Math.PI / 2,
				cameraYawRadians: 0,
			},
			framing: { kind: "body" },
		});
		const after = playback.advance(clock, turned.subjectTransform);
		const currentBackdrop =
			after.partToPreview[background.partOffset + backgroundPart.partIndex];
		const currentSubject = after.partToPreview[bodyPart.partIndex];
		if (
			backdrop === undefined ||
			subject === undefined ||
			currentBackdrop === undefined ||
			currentSubject === undefined ||
			!sameMatrix(backdrop, currentBackdrop) ||
			sameMatrix(subject, currentSubject)
		)
			throw new Error(
				"Subject heading altered its independent background or failed to turn the subject.",
			);
		// A visual-only replacement must keep the body at its current animation frame,
		// including after the old runtime retires and the replacement clock starts at zero.
		const current = playback.advance(clock, Mat4.identity());
		const expectedPose = current.partToPreview
			.slice(0, body.setupPose.length)
			.map((frame) => frame.clone());
		const replacement = new ObjectPreviewPresentation(lease.assets, playback);
		playback.dispose();
		try {
			const resumed = replacement.advance(0, Mat4.identity());
			for (const [index, expected] of expectedPose.entries()) {
				const actual = resumed.partToPreview[index];
				if (actual === undefined || !sameMatrix(expected, actual))
					throw new Error(
						"Appearance replacement restarted the body's animation pose.",
					);
			}
		} finally {
			replacement.dispose();
		}
		return {
			attachmentPlacements,
			subjectRotationPreservedBackdrop: true,
			inspectionOrbitStable: true,
		};
	} finally {
		playback.dispose();
		lease.release();
	}
}

function sameMatrix(left: Mat4, right: Mat4): boolean {
	const expected = mat4ToFloat32Array(left);
	const actual = mat4ToFloat32Array(right);
	return expected.every((value, index) => value === actual[index]);
}
