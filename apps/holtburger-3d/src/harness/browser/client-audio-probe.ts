import {
	ClientTitleMusic,
	titleMusicUrl,
} from "../../client/client-title-music";
import { CLIENT_AUDIO_DEFAULTS } from "../../client/client-settings-defaults";
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
		(cause) => {
			throw new Error("Audio probe preparation failed", { cause });
		},
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
				effects: {
					applySetOmega() {},
					applyTranslucency() {},
					applyTextureVelocity() {},
				},
				objectState: { applyObjectState: () => "executed" },
				particles: {
					createEmitter: () => "unprepared",
					destroy() {},
					stop() {},
				},
				scheduler: {
					scheduleActivation() {
						return false;
					},
				},
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
			outputMix: await probeOutputMix(),
			titleMusic: await probeTitleMusic(),
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

/** Render actual browser output to prove master gain follows the voice contour and reaches silence. */
async function probeOutputMix() {
	const tuning = SHARED_FRONTEND_TUNING.audio;
	async function renderPeak(volume: number, live: boolean): Promise<number> {
		const sampleRate = 48_000;
		const context = new OfflineAudioContext(2, sampleRate / 10, sampleRate);
		const soundId = "0x0a000001" as DatAssetId;
		const device = new WebAudioDevice(
			context,
			{ destroy() {}, loadAudio: async () => toneWave() },
			tuning.placementSmoothingSeconds,
			tuning.loudnessCurveExponent,
		);
		try {
			if (!live) device.setOutputVolume(volume);
			await device.prepare(soundId);
			if (!device.playOneShot(soundId, 0.2, 0))
				throw new Error("Prepared offline tone refused");
			if (live) device.setOutputVolume(volume);
			const buffer = await context.startRendering();
			// Measure after the live ramp, excluding the resampler's end boundary.
			const start = Math.ceil(tuning.placementSmoothingSeconds * sampleRate);
			const end = Math.floor(buffer.length * 0.9);
			if (start >= end)
				throw new Error(
					"Output probe tone is shorter than the configured smoothing ramp",
				);
			let peak = 0;
			for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
				const samples = buffer.getChannelData(channel);
				for (let i = start; i < end; i += 1)
					peak = Math.max(peak, Math.abs(samples[i]));
			}
			return peak;
		} finally {
			device.destroy();
		}
	}
	const full = await renderPeak(1, false);
	const half = await renderPeak(0.5, false);
	const muted = await renderPeak(0, false);
	const liveHalf = await renderPeak(0.5, true);
	const liveMuted = await renderPeak(0, true);
	if (
		!(full > 0) ||
		Math.abs(half / full - 0.5) > 0.001 ||
		Math.abs(liveHalf / full - 0.5) > 0.001 ||
		muted !== 0 ||
		liveMuted !== 0
	) {
		throw new Error(
			`Browser output mix failed: ${JSON.stringify({ full, half, muted, liveHalf, liveMuted })}`,
		);
	}
	return {
		halfRatio: half / full,
		liveHalfRatio: liveHalf / full,
		muted,
		liveMuted,
	};
}

/** Exercise the production media owner with the optional bundled track on the real browser decoder. */
async function probeTitleMusic() {
	if (titleMusicUrl === undefined) return { available: false };
	const audio = new Audio();
	const failures: unknown[] = [];
	const music = new ClientTitleMusic(
		titleMusicUrl,
		(error) => failures.push(error),
		() => audio,
	);
	try {
		music.setSettings({
			...CLIENT_AUDIO_DEFAULTS,
			masterVolume: 0.4,
			musicVolume: 0.3,
		});
		const waitForPlaying = () =>
			new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(
					() => reject(new Error("Title music did not start")),
					5000,
				);
				audio.addEventListener(
					"playing",
					() => {
						clearTimeout(timeout);
						resolve();
					},
					{ once: true },
				);
				audio.addEventListener(
					"error",
					() => {
						clearTimeout(timeout);
						reject(new Error("Title music decode failed"));
					},
					{ once: true },
				);
			});
		const playing = waitForPlaying();
		music.setActive(true);
		await playing;
		await new Promise<void>((resolve) => setTimeout(resolve, 150));
		const advanced = audio.currentTime > 0;
		const volume = audio.volume;
		music.setForeground(false);
		const pausedPosition = audio.currentTime;
		if (!audio.paused) throw new Error("Background title music did not pause.");
		const backgroundPlaying = waitForPlaying();
		music.setSettings({
			...CLIENT_AUDIO_DEFAULTS,
			musicVolume: volume,
			playInBackground: true,
		});
		await backgroundPlaying;
		if (audio.paused || audio.currentTime < pausedPosition)
			throw new Error(
				"Enabled background title music did not resume in place.",
			);
		music.setSettings({ ...CLIENT_AUDIO_DEFAULTS, musicVolume: volume });
		if (!audio.paused)
			throw new Error(
				"Disabling background playback did not pause title music.",
			);
		music.setForeground(true);
		music.setSettings({
			...CLIENT_AUDIO_DEFAULTS,
			masterVolume: 0,
			musicVolume: 0.3,
			muted: true,
		});
		const muted = audio.muted;
		const positionBeforeUnmute = audio.currentTime;
		music.setSettings({
			...CLIENT_AUDIO_DEFAULTS,
			musicVolume: volume,
			muted: false,
		});
		if (
			audio.muted ||
			audio.volume !== volume ||
			audio.currentTime < positionBeforeUnmute
		)
			throw new Error(
				"Unmuting title music changed its saved mix or playback position.",
			);
		music.setActive(false);
		const stopped = audio.paused && audio.currentTime === 0;
		if (
			!advanced ||
			!stopped ||
			!muted ||
			Math.abs(volume - 0.3) > 0.00001 ||
			audio.volume !== volume ||
			failures.length
		)
			throw new Error("Title music lifecycle or mix failed");
		return {
			available: true,
			backgroundPlayback: true,
			advanced,
			stopped,
			muted,
			volume,
			loop: audio.loop,
		};
	} finally {
		music.destroy();
	}
}
