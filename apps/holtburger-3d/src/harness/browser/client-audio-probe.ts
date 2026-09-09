import { decodeBehaviorCommand } from "../../lib/assets/decode-behavior-hook";
import {
	BehaviorEventRouter,
	behaviorTargetId,
} from "../../lib/game/behavior/behavior-event-router";
import { WebAudioDevice } from "../../lib/assets/web-audio-device";
import { renderVector3, sceneVector3 } from "../../lib/assets/ac-frame";
import { SHARED_FRONTEND_TUNING } from "../../lib/frontend-tuning";
import type { DatAssetId } from "../../lib/game/game-types";
import { AudioSystem } from "../../lib/game/systems/audio-system";

/** Real browser decoding/playback, with generated PCM instead of an untracked archive dependency. */
export async function probeClientAudio() {
	const context = new AudioContext();
	const soundId = "0x0a000001" as DatAssetId;
	const bytes = toneWave();
	let loads = 0;
	const tuning = SHARED_FRONTEND_TUNING.audio;
	const device = new WebAudioDevice(
		context,
		{
			destroy() {},
			async loadAudio(id) {
				if (id !== soundId) throw new Error(`Unexpected probe audio ${id}`);
				loads += 1;
				return bytes.slice(0);
			},
		},
		tuning.placementSmoothingSeconds,
		tuning.loudnessCurveExponent,
	);
	const audio = new AudioSystem(
		device,
		() => 0,
		tuning.maximumSimultaneousVoices,
		() => performance.now() / 1_000,
		tuning.maximumWarmupReplaySeconds,
	);
	try {
		await context.resume();
		audio.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		const trigger = {
			soundId,
			probability: 1,
			category: "effect" as const,
			source: {
				mode: "world" as const,
				position: sceneVector3([2, 0, 0]),
				volume: 0.2,
			},
		};
		const router = new BehaviorEventRouter(
			{
				targets: { isLive: () => true },
				audio: {
					playSound: (_target, sound) => {
						const outcome = audio.trigger({
							...trigger,
							soundId: sound.soundId,
							probability: sound.probability,
							source: { ...trigger.source, volume: sound.volume },
						});
						return outcome === "played" ? "played" : "suppressed";
					},
					playSoundTableKey: () => {
						throw new Error("Unexpected sound-table hook");
					},
				},
				effects: { applySetOmega() {}, applyTransparentPart() {} },
				scale: { applyScale: () => "executed" },
				particles: {
					createEmitter: () => "unprepared",
					destroy() {},
					stop() {},
				},
				scheduler: { scheduleActivation() {} },
			},
			4,
		);
		const command = decodeBehaviorCommand(
			{ hookType: 1, hookName: "sound", payload: { kind: "sound", soundId } },
			new Uint8Array(),
			"browser audio fixture",
		);
		const target = { targetId: behaviorTargetId("audio-probe"), generation: 1 };
		const provenance = {
			producer: "animation" as const,
			assetId: "0x03000001" as DatAssetId,
			authoredOrder: 0,
			authoredPosition: 0,
		};
		if (
			router.dispatch(command, target, provenance, "initial-state") !==
			"suppressed-initial-state"
		)
			throw new Error("Animation catch-up played an historical sound.");
		// Two cold animation hooks must share decoding and each replay exactly once.
		router.dispatch(command, target, provenance, "live");
		router.dispatch(command, target, provenance, "live");
		await device.prepare(soundId);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		const diagnostics = audio.getDiagnostics();
		if (
			loads !== 1 ||
			diagnostics.warmedPlayedCount !== 2 ||
			diagnostics.warmupRefusedCount !== 0
		)
			throw new Error(
				`Browser sound warmup failed: ${JSON.stringify({ loads, diagnostics })}`,
			);
		if (device.getPreparedSourceBytes(soundId) !== bytes.byteLength)
			throw new Error("Audio decoder lost the transferred source-byte count.");
		return {
			context: context.state,
			loads,
			decodedBytes: bytes.byteLength,
			warmedPlayedCount: diagnostics.warmedPlayedCount,
		};
	} finally {
		audio.destroy();
		device.destroy();
		await context.close();
	}
}

/** 100 ms mono PCM wave; its content is only a decoder fixture, not a retail sound substitute. */
function toneWave(): ArrayBuffer {
	const sampleRate = 8_000;
	const samples = 800;
	const bytes = new ArrayBuffer(44 + samples * 2);
	const view = new DataView(bytes);
	const tag = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i += 1)
			view.setUint8(offset + i, text.charCodeAt(i));
	};
	tag(0, "RIFF");
	view.setUint32(4, bytes.byteLength - 8, true);
	tag(8, "WAVE");
	tag(12, "fmt ");
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	tag(36, "data");
	view.setUint32(40, samples * 2, true);
	for (let i = 0; i < samples; i += 1)
		view.setInt16(
			44 + i * 2,
			Math.round(Math.sin((i * Math.PI * 2 * 440) / sampleRate) * 4_000),
			true,
		);
	return bytes;
}
