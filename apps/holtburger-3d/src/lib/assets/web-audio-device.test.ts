import { describe, expect, it, vi } from "vitest";
import type { DatAssetId } from "../game/game-types";
import { WebAudioDevice, type AudioAssetSource } from "./web-audio-device";

const SOUND = "0x0a000207" as DatAssetId;

function fakeContext() {
	const started: unknown[] = [];
	const stopped: unknown[] = [];
	const node = () => ({ connect: vi.fn(function (this: unknown, next: unknown) { return next; }), disconnect: vi.fn() });
	const context = {
		createBufferSource: () => {
			const source = {
				...node(),
				buffer: null as AudioBuffer | null,
				start: vi.fn(() => started.push(source)),
				stop: vi.fn(() => stopped.push(source)),
			};
			return source;
		},
		createGain: () => ({ ...node(), gain: { value: 0 } }),
		createStereoPanner: () => ({ ...node(), pan: { value: 0 } }),
		decodeAudioData: async () => ({}) as AudioBuffer,
		destination: {},
	} as unknown as AudioContext;
	return { context, started, stopped };
}

function fakeSource(): AudioAssetSource & { loads: DatAssetId[] } {
	const loads: DatAssetId[] = [];
	return {
		destroy: () => {},
		loads,
		loadAudio: async (soundId) => {
			loads.push(soundId);
			return new ArrayBuffer(8);
		},
	};
}

describe("WebAudioDevice", () => {
	it("skips an undecoded sound and starts its decode for later", async () => {
		const { context, started } = fakeContext();
		const source = fakeSource();
		const device = new WebAudioDevice(context, source);

		// Playing an ambient one-shot late is worse than not playing it, so the first call skips.
		expect(device.playOneShot(SOUND, 1, 0)).toBeNull();
		expect(started).toHaveLength(0);

		await device.prepare(SOUND);
		expect(device.playOneShot(SOUND, 1, 0)).not.toBeNull();
		expect(started).toHaveLength(1);
	});

	it("decodes each sound exactly once across concurrent requests", async () => {
		const { context } = fakeContext();
		const source = fakeSource();
		const device = new WebAudioDevice(context, source);

		await Promise.all([device.prepare(SOUND), device.prepare(SOUND)]);
		await device.prepare(SOUND);

		expect(source.loads).toEqual([SOUND]);
	});

	it("tolerates stopping a voice that already ended", async () => {
		const { context } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource());
		await device.prepare(SOUND);
		const voice = device.playOneShot(SOUND, 1, 0)!;

		voice.stop();
		// Stopping twice must not throw: a finished voice is the normal case.
		expect(() => voice.stop()).not.toThrow();
	});

	it("refuses playback after destruction", async () => {
		const { context } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource());
		await device.prepare(SOUND);

		device.destroy();

		expect(device.playOneShot(SOUND, 1, 0)).toBeNull();
	});
});
