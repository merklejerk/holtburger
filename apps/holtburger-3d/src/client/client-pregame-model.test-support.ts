import { vi } from "vitest";
import { Vec3 } from "../lib/game/math/types";
import type { ModelFit } from "../lib/game/geometry/model-fit";
import {
	LocalSceneModelHandle,
	type LocalSceneModelPort,
} from "../lib/game/runtime/local-scene-model";
import type {
	PregameCharacterSource,
	PregameCharacterView,
} from "./client-pregame-character";

/** Explicit synthetic source; the real setup repository is outside this frontend-owner fixture. */
export const PREGAME_TEST_SOURCE: PregameCharacterSource = {
	subjectId: "character-a",
	visual: {
		body: {
			setupDid: 0x02000001,
			appearance: {
				paletteDid: null,
				subPalettes: [],
				textureChanges: [],
				partChanges: [],
			},
			scale: 1,
			translucency: 0,
			pose: { kind: "setup-pose" },
		},
		attachments: [],
	},
};

/** Test-owned layout, independent of tunable production UI defaults. */
export const PREGAME_TEST_VIEW: PregameCharacterView = {
	rectangle: { left: 340, top: 246, width: 590, height: 510 },
	headingRadians: 0.4,
	framing: { kind: "body" },
};

/** In-memory scene boundary; source races and statuses still use the production local handle. */
export function pregameModelFixture() {
	const fit: ModelFit = {
		center: new Vec3(0, 1, 0),
		supportPoints: Float32Array.of(
			-0.5,
			0,
			-0.3,
			0.5,
			0,
			0.3,
			-0.5,
			2,
			-0.3,
			0.5,
			2,
			0.3,
		),
	};
	const commit = vi.fn();
	const release = vi.fn();
	const port = {
		prepare: vi.fn<LocalSceneModelPort["prepare"]>(async () => ({
			fit,
			commit,
			release,
		})),
		setPlacement: vi.fn<LocalSceneModelPort["setPlacement"]>(),
		setVisible: vi.fn<LocalSceneModelPort["setVisible"]>(),
		withdraw: vi.fn(),
	};
	const create = vi.fn(
		(placement: Parameters<LocalSceneModelPort["setPlacement"]>[0]) =>
			new LocalSceneModelHandle(port, placement, () => {}),
	);
	return { create, port, fit, commit, release };
}
