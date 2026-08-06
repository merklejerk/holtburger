import { describe, expect, it, vi } from "vitest";
import type { DatAssetId } from "../game-types";
import {
	AudioSystem,
	type AudioDevice,
	type AudioTrigger,
	type AudioVoice,
} from "./audio-system";

const SOUND = "0x0a000207" as DatAssetId;

function build(options: { roll?: number; voiceLimit?: number } = {}) {
	const stops: AudioVoice[] = [];
	const played: Array<{ gain: number; pan: number; soundId: DatAssetId }> = [];
	const device: AudioDevice = {
		playOneShot: (soundId, gain, pan) => {
			played.push({ gain, pan, soundId });
			const voice = { stop: vi.fn() };
			stops.push(voice);
			return voice;
		},
	};
	const system = new AudioSystem(
		device,
		() => options.roll ?? 0,
		options.voiceLimit ?? 8,
	);
	return { played, stops, system };
}

function trigger(overrides: Partial<AudioTrigger> = {}): AudioTrigger {
	return {
		position: [0, 0, 0],
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
			{ playOneShot: () => ({ stop: () => {} }) },
			roll,
			8,
		);

		expect(system.trigger(trigger({ probability: 1 }))).toBe("played");
		expect(roll).not.toHaveBeenCalled();
	});

	it("refuses a sound below retail's audible floor instead of playing it silently", () => {
		const { played, system } = build();

		expect(system.trigger(trigger({ position: [500, 0, 0] }))).toBe(
			"inaudible",
		);
		expect(played).toHaveLength(0);
	});

	it("attenuates and pans from the listener's placement", () => {
		const { played, system } = build();
		system.setListener({ position: [0, 0, 0], right: [1, 0, 0] });

		system.trigger(trigger({ position: [10, 0, 0] }));

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
		const system = new AudioSystem({ playOneShot: () => null }, () => 0, 8);

		expect(system.trigger(trigger())).toBe("device-refused");
		expect(system.getDiagnostics().playedCount).toBe(0);
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
			() => new AudioSystem({ playOneShot: () => null }, () => 0, 0),
		).toThrow("positive integer");
	});
});
