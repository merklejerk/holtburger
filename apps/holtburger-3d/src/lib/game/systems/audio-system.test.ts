import { renderVector3, sceneVector3 } from "../../assets/ac-frame";
import { describe, expect, it, vi } from "vitest";
import type { DatAssetId } from "../game-types";
import {
	AudioSystem,
	type AudioDevice,
	type AudioTrigger,
	type AudioVoice,
} from "./audio-system";
import type { SceneVector3 } from "../../assets/ac-frame";

const SOUND = "0x0a000207" as DatAssetId;

/** A voice whose completion the test drives, recording its stops and every re-placement. */
interface FakeVoice extends AudioVoice {
	finished: boolean;
	stopCalls: number;
	placements: Array<{ gain: number; pan: number }>;
}

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
	const stops: FakeVoice[] = [];
	const played: Array<{ gain: number; pan: number; soundId: DatAssetId }> = [];
	const cold = options.coldSounds ?? new Set<DatAssetId>();
	const prepared: DatAssetId[] = [];
	const device: AudioDevice = {
		playOneShot: (soundId, gain, pan) => {
			if (cold.has(soundId)) return null;
			played.push({ gain, pan, soundId });
			const voice: FakeVoice = {
				finished: false,
				placements: [],
				setPlacement: (nextGain, nextPan) => {
					voice.placements.push({ gain: nextGain, pan: nextPan });
				},
				stop: () => {
					voice.stopCalls += 1;
				},
				stopCalls: 0,
			};
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

function trigger(
	overrides: {
		position?: SceneVector3;
		volume?: number;
		probability?: number;
		category?: AudioTrigger["category"];
	} = {},
): AudioTrigger {
	return {
		category: overrides.category ?? "effect",
		probability: overrides.probability ?? 1,
		soundId: SOUND,
		source: {
			mode: "world",
			position: overrides.position ?? sceneVector3([0, 0, 0]),
			volume: overrides.volume ?? 1,
		},
	};
}

/** A head-locked trigger whose gain is supplied live, as ambient beds are. */
function bedTrigger(volume: () => number): AudioTrigger {
	return {
		category: "ambient",
		probability: 1,
		soundId: SOUND,
		source: { mode: "listener", volume },
	};
}

describe("AudioSystem", () => {
	/**
	 * RETAIL DIVERGENCE, asserted rather than only commented: retail multiplies ambient gain by
	 * `ambient_sound_volume` twice (acclient.c:366824 and 366440), so a half setting would land at a
	 * quarter. We apply it once, and the two categories scale independently.
	 */
	it("scales ambient gain linearly, and independently of the effect volume", () => {
		const { played, system } = build();
		system.setSettings({ ambientVolume: 0.5, effectVolume: 1 });

		system.trigger(trigger({ category: "ambient" }));
		system.trigger(trigger({ category: "effect" }));

		expect(played[0]!.gain).toBeCloseTo(0.5);
		expect(played[1]!.gain).toBeCloseTo(1);
	});

	it("rejects an out-of-range volume in either category", () => {
		const { system } = build();
		expect(() =>
			system.setSettings({ ambientVolume: 2, effectVolume: 1 }),
		).toThrow("Ambient volume");
		expect(() =>
			system.setSettings({ ambientVolume: 1, effectVolume: -1 }),
		).toThrow("Effect volume");
	});

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
			{
				playOneShot: () => ({
					finished: false,
					setPlacement: () => {},
					stop: () => {},
				}),
				prepare: async () => {},
			},
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

	it("re-places a live voice as the listener recedes, with strictly lower gain", () => {
		const { stops, system } = build();
		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.trigger(trigger({ position: sceneVector3([10, 0, 0]) }));

		system.setListener({
			position: sceneVector3([-10, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.advance();

		const voice = stops[0]!;
		expect(voice.placements).toHaveLength(1);
		// 20 m away instead of 10: 25/400 against the trigger-time 25/100.
		expect(voice.placements[0]!.gain).toBeCloseTo(25 / 400);
		expect(voice.placements[0]!.gain).toBeLessThan(0.25);
	});

	it("flips pan when the listener crosses to the source's other side", () => {
		const { stops, system } = build();
		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.trigger(trigger({ position: sceneVector3([10, 0, 0]) }));

		system.setListener({
			position: sceneVector3([20, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.advance();

		expect(stops[0]!.placements[0]!.pan).toBeCloseTo(-1);
	});

	it("silences a voice past the audible floor instead of stopping it, and brings it back", () => {
		const { stops, system } = build();
		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.trigger(trigger({ position: sceneVector3([10, 0, 0]) }));

		// A free-flying camera leaves and re-enters earshot routinely; stopping here would make the
		// return trip silently lossy.
		system.setListener({
			position: sceneVector3([500, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.advance();
		const voice = stops[0]!;
		expect(voice.stopCalls).toBe(0);
		expect(voice.placements.at(-1)).toEqual({ gain: 0, pan: 0 });

		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.advance();
		expect(voice.placements.at(-1)!.gain).toBeCloseTo(0.25);
	});

	it("sweeps finished voices on advance without re-placing them", () => {
		const { stops, system } = build();
		system.trigger(trigger());
		stops[0]!.finished = true;

		system.advance();

		expect(stops[0]!.placements).toHaveLength(0);
		expect(system.getDiagnostics().activeVoiceCount).toBe(0);
	});

	it("keeps a listener-locked voice centred at its supplied gain across movement", () => {
		const { stops, system } = build();
		let bed = 0.8;
		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		expect(system.trigger(bedTrigger(() => bed))).toBe("played");

		system.setListener({
			position: sceneVector3([300, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.advance();

		// Head-locked: distance to the listener is always zero, so gain follows the supplier and
		// pan stays centred no matter where the camera goes.
		expect(stops[0]!.placements.at(-1)).toEqual({ gain: 0.8, pan: 0 });

		bed = 0.2;
		system.advance();
		expect(stops[0]!.placements.at(-1)).toEqual({ gain: 0.2, pan: 0 });
	});

	it("fades a listener-locked voice whose supplier has gone quiet, without stopping it", () => {
		const { stops, system } = build();
		let bed = 0.8;
		system.trigger(bedTrigger(() => bed));

		bed = 0;
		system.advance();

		// A supplier reading zero is a retired or region-cleared bed; the voice glides out.
		expect(stops[0]!.stopCalls).toBe(0);
		expect(stops[0]!.placements.at(-1)).toEqual({ gain: 0, pan: 0 });
	});

	it("does not start a listener-locked voice whose supplier is already silent", () => {
		const { played, system } = build();

		expect(system.trigger(bedTrigger(() => 0))).toBe("inaudible");
		expect(played).toHaveLength(0);
	});

	it("applies a live settings change to a playing voice on the next advance", () => {
		const { stops, system } = build();
		system.trigger(trigger());

		system.setSettings({ ambientVolume: 1, effectVolume: 0.5 });
		system.advance();

		expect(stops[0]!.placements[0]!.gain).toBeCloseTo(0.5);
	});

	it("steals the quietest voice, not the oldest, when the budget is full", () => {
		const { stops, system } = build({ voiceLimit: 2 });
		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		// Oldest but loud (on top of the listener); newer but faint (80 m out).
		system.trigger(trigger({ position: sceneVector3([0, 0, 0]) }));
		system.trigger(trigger({ position: sceneVector3([80, 0, 0]) }));

		system.trigger(trigger({ position: sceneVector3([0, 0, 0]) }));

		expect(stops[0]!.stopCalls).toBe(0);
		expect(stops[1]!.stopCalls).toBe(1);
	});

	it("prefers a voice silenced below the floor as the steal victim, whatever its age", () => {
		const { stops, system } = build({ voiceLimit: 2 });
		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.trigger(trigger({ position: sceneVector3([10, 0, 0]) }));
		system.trigger(trigger({ position: sceneVector3([0, 0, 0]) }));
		// The listener flies away from the first voice's source only.
		system.setListener({
			position: sceneVector3([-500, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		system.trigger(trigger({ position: sceneVector3([-500, 0, 0]) }));

		// Both retained voices are far away now, but the first is farther; it reads gain 0 and is
		// the least audible cut available.
		expect(stops[0]!.stopCalls).toBe(1);
		expect(stops[1]!.stopCalls).toBe(0);
	});

	it("steals the oldest voice when the budget is full", () => {
		const { stops, system } = build({ voiceLimit: 2 });

		system.trigger(trigger());
		system.trigger(trigger());
		system.trigger(trigger());

		expect(stops[0]!.stopCalls).toBe(1);
		expect(stops[1]!.stopCalls).toBe(0);
		expect(system.getDiagnostics()).toMatchObject({
			activeVoiceCount: 2,
			playedCount: 3,
			stolenCount: 1,
		});
	});

	it("retires a voice that ended on its own instead of stealing from it", () => {
		const { stops, system } = build({ voiceLimit: 1 });
		system.trigger(trigger());

		// The voice ends naturally between triggers, which is the common case: without noticing,
		// the budget stays full forever and every later sound reports a steal.
		stops[0]!.finished = true;
		system.trigger(trigger());

		expect(stops[0]!.stopCalls).toBe(0);
		expect(system.getDiagnostics().stolenCount).toBe(0);
		expect(system.getDiagnostics().activeVoiceCount).toBe(1);
	});

	it("still steals the oldest when every voice is genuinely playing", () => {
		const { stops, system } = build({ voiceLimit: 1 });
		system.trigger(trigger());

		system.trigger(trigger());

		expect(stops[0]!.stopCalls).toBe(1);
		expect(system.getDiagnostics().stolenCount).toBe(1);
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

	it("places a warmed replay from the listener at replay time, not trigger time", async () => {
		const { played, system } = build({ coldSounds: new Set([SOUND]) });
		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});

		system.trigger(trigger({ position: sceneVector3([10, 0, 0]) }));
		// The listener moves while the buffer decodes; the late start must not snap to where the
		// listener used to be.
		system.setListener({
			position: sceneVector3([20, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(played).toHaveLength(1);
		expect(played[0]!.pan).toBeCloseTo(-1);
	});

	it("does not start a warmed sound the listener has left earshot of", async () => {
		const { played, system } = build({ coldSounds: new Set([SOUND]) });
		system.setListener({
			position: sceneVector3([0, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});

		system.trigger(trigger({ position: sceneVector3([10, 0, 0]) }));
		system.setListener({
			position: sceneVector3([500, 0, 0]),
			right: renderVector3([1, 0, 0]),
		});
		await Promise.resolve();
		await Promise.resolve();

		expect(played).toHaveLength(0);
		expect(system.getDiagnostics()).toMatchObject({
			inaudibleCount: 1,
			playedCount: 0,
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
		// The bound is temporal: a sound this late belongs to a moment that has passed, however
		// correctly it would now be placed.
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

		expect(stops[0]!.stopCalls).toBe(1);
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
