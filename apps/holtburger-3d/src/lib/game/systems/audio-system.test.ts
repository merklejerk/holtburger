import { renderVector3, sceneVector3 } from "../../assets/ac-frame";
import { describe, expect, it, vi } from "vitest";
import type { DatAssetId } from "../game-types";
import {
	AudioSystem,
	type AudioDevice,
	type AudioTrigger,
	type AudioVoice,
} from "./audio-system";

const SOUND = "0x0a000207" as DatAssetId;

function build(
	options: {
		roll?: number;
		voiceLimit?: number;
		/** Sounds the device starts cold, refusing until warmed. */
		coldSounds?: Set<DatAssetId>;
		clock?: () => number;
		maximumWarmupReplaySeconds?: number;
	} = {},
) {
	const stops: AudioVoice[] = [];
	const played: Array<{ gain: number; pan: number; soundId: DatAssetId }> = [];
	const cold = options.coldSounds ?? new Set<DatAssetId>();
	const prepared: DatAssetId[] = [];
	const device: AudioDevice = {
		playOneShot: (soundId, gain, pan) => {
			if (cold.has(soundId)) return null;
			played.push({ gain, pan, soundId });
			const voice = { stop: vi.fn() };
			stops.push(voice);
			return voice;
		},
		prepare: async (soundId) => {
			prepared.push(soundId);
			cold.delete(soundId);
		},
	};
	const system = new AudioSystem(
		device,
		() => options.roll ?? 0,
		options.voiceLimit ?? 8,
		options.clock ?? (() => 0),
		options.maximumWarmupReplaySeconds ?? 0.25,
	);
	return { played, prepared, stops, system };
}

function trigger(overrides: Partial<AudioTrigger> = {}): AudioTrigger {
	return {
		position: sceneVector3([0, 0, 0]),
		probability: 1,
		soundId: SOUND,
		volume: 1,
		...overrides,
	};
}

describe("AudioSystem", () => {
	it("plays a certain sound at its authored volume when the listener is on top of it", () => {
		const { played, system } = build();

		expect(system.trigger(trigger({ volume: 0.3 }))).toBe("played");
		expect(played).toEqual([{ gain: 0.3, pan: 0, soundId: SOUND }]);
	});

	it("rolls probability before doing any spatial work", () => {
		// A roll of 0.9 against a 0.5 chance loses.
		const { played, system } = build({ roll: 0.9 });

		expect(system.trigger(trigger({ probability: 0.5 }))).toBe(
			"lost-probability-roll",
		);
		expect(played).toHaveLength(0);
	});

	it("does not roll at all for a certain sound", () => {
		// Every representative record authors probability 1.0, so this is the common path.
		const roll = vi.fn(() => 0.99);
		const system = new AudioSystem(
			{ playOneShot: () => ({ stop: () => {} }), prepare: async () => {} },
			roll,
			8,
			() => 0,
			0.25,
		);

		expect(system.trigger(trigger({ probability: 1 }))).toBe("played");
		expect(roll).not.toHaveBeenCalled();
	});

	it("refuses a sound below retail's audible floor instead of playing it silently", () => {
		const { played, system } = build();

		expect(
			system.trigger(trigger({ position: sceneVector3([500, 0, 0]) })),
		).toBe("inaudible");
		expect(played).toHaveLength(0);
	});

	it("spatializes purely from relative geometry, so a shared translation changes nothing", () => {
		// Scene space exists so the listener survives the render anchor moving. Translating both
		// listener and source by a landblock is exactly what an anchor change looks like, and it
		// must be inaudible — under anchored positions it silently displaced the source instead.
		const near = build();
		near.system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		near.system.trigger(trigger({ position: sceneVector3([10, 0, 0]) }));

		const shifted = build();
		shifted.system.setListener({
			position: sceneVector3([192, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		shifted.system.trigger(trigger({ position: sceneVector3([202, 0, 0]) }));

		expect(shifted.played[0]!.gain).toBeCloseTo(near.played[0]!.gain);
		expect(shifted.played[0]!.pan).toBeCloseTo(near.played[0]!.pan);
	});

	it("attenuates and pans from the listener's placement", () => {
		const { played, system } = build();
		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});

		system.trigger(trigger({ position: sceneVector3([10, 0, 0]) }));

		expect(played[0]!.gain).toBeCloseTo(0.25);
		expect(played[0]!.pan).toBeCloseTo(1);
	});

	it("steals the oldest voice when the budget is full", () => {
		const { stops, system } = build({ voiceLimit: 2 });

		system.trigger(trigger());
		system.trigger(trigger());
		system.trigger(trigger());

		expect(stops[0]!.stop).toHaveBeenCalledTimes(1);
		expect(stops[1]!.stop).not.toHaveBeenCalled();
		expect(system.getDiagnostics()).toMatchObject({
			activeVoiceCount: 2,
			playedCount: 3,
			stolenCount: 1,
		});
	});

	it("frees budget when a finished voice is released, without stopping it", () => {
		const { stops, system } = build({ voiceLimit: 1 });
		system.trigger(trigger());

		system.release(stops[0]!);
		system.trigger(trigger());

		// Releasing a finished voice must not stop it; it already ended on its own.
		expect(stops[0]!.stop).not.toHaveBeenCalled();
		expect(system.getDiagnostics().stolenCount).toBe(0);
	});

	it("reports a device refusal rather than counting it as played", () => {
		const { system } = build({ coldSounds: new Set([SOUND]) });

		expect(system.trigger(trigger())).toBe("device-refused");
		expect(system.getDiagnostics().playedCount).toBe(0);
	});

	it("warms a refused sound and replays it while the moment still stands", async () => {
		const { played, prepared, system } = build({
			coldSounds: new Set([SOUND]),
		});

		expect(system.trigger(trigger())).toBe("device-refused");
		expect(prepared).toEqual([SOUND]);
		await Promise.resolve();
		await Promise.resolve();

		expect(played).toHaveLength(1);
		expect(system.getDiagnostics()).toMatchObject({
			deviceRefusedCount: 1,
			playedCount: 1,
			warmedPlayedCount: 1,
			warmupExpiredCount: 0,
		});
	});

	it("drops a warmed sound whose moment has passed instead of playing it late", async () => {
		let now = 0;
		const { played, system } = build({
			clock: () => now,
			coldSounds: new Set([SOUND]),
			maximumWarmupReplaySeconds: 0.25,
		});

		system.trigger(trigger());
		// Retail fixes gain and pan at trigger time, so a very late replay would place the sound
		// where the listener no longer is.
		now = 5;
		await Promise.resolve();
		await Promise.resolve();

		expect(played).toHaveLength(0);
		expect(system.getDiagnostics()).toMatchObject({
			playedCount: 0,
			warmupExpiredCount: 1,
		});
	});

	it("stops every voice only on shutdown", () => {
		const { stops, system } = build();
		system.trigger(trigger());

		system.destroy();

		expect(stops[0]!.stop).toHaveBeenCalledTimes(1);
		expect(system.getDiagnostics().activeVoiceCount).toBe(0);
	});

	it("rejects a non-positive voice limit", () => {
		expect(
			() =>
				new AudioSystem(
					{ playOneShot: () => null, prepare: async () => {} },
					() => 0,
					0,
					() => 0,
					0.25,
				),
		).toThrow("positive integer");
	});
});
