import { describe, expect, it, vi } from "vitest";
import type { DatAssetId } from "../game/game-types";
import { WebAudioDevice, type AudioAssetSource } from "./web-audio-device";

const SOUND = "0x0a000207" as DatAssetId;

interface FakeParam {
	value: number;
	setTargetAtTime: ReturnType<typeof vi.fn>;
}

interface FakeSourceNode {
	start: ReturnType<typeof vi.fn>;
	stop: ReturnType<typeof vi.fn>;
	onended: (() => void) | null;
}

function fakeContext() {
	const started: FakeSourceNode[] = [];
	const stopped: unknown[] = [];
	const gains: FakeParam[] = [];
	const pans: FakeParam[] = [];
	const node = () => ({
		connect: vi.fn(function (this: unknown, next: unknown) {
			return next;
		}),
		disconnect: vi.fn(),
	});
	const param = (record: FakeParam[]): FakeParam => {
		const created: FakeParam = { setTargetAtTime: vi.fn(), value: 0 };
		record.push(created);
		return created;
	};
	const context = {
		createBufferSource: () => {
			const source = {
				...node(),
				buffer: null as AudioBuffer | null,
				onended: null as (() => void) | null,
				start: vi.fn((): void => {
					started.push(source);
				}),
				stop: vi.fn((): void => {
					stopped.push(source);
				}),
			};
			return source;
		},
		createGain: () => ({ ...node(), gain: param(gains) }),
		createStereoPanner: () => ({ ...node(), pan: param(pans) }),
		currentTime: 42,
		decodeAudioData: async () => ({}) as AudioBuffer,
		destination: {},
	} as unknown as AudioContext;
	return { context, gains, pans, started, stopped };
}

const SMOOTHING = 0.02;

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
		const device = new WebAudioDevice(context, source, SMOOTHING);

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
		const device = new WebAudioDevice(context, source, SMOOTHING);

		await Promise.all([device.prepare(SOUND), device.prepare(SOUND)]);
		await device.prepare(SOUND);

		expect(source.loads).toEqual([SOUND]);
	});

	it("tolerates stopping a voice that already ended", async () => {
		const { context } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING);
		await device.prepare(SOUND);
		const voice = device.playOneShot(SOUND, 1, 0)!;

		voice.stop();
		// Stopping twice must not throw: a finished voice is the normal case.
		expect(() => voice.stop()).not.toThrow();
	});

	it("steers a live voice through setTargetAtTime rather than stepping the params", async () => {
		const { context, gains, pans } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING);
		await device.prepare(SOUND);
		const voice = device.playOneShot(SOUND, 1, 0)!;

		voice.setPlacement(0.5, -0.25);

		// Initial values are set directly (the signal starts there); updates must glide.
		expect(gains[0]!.value).toBe(1);
		expect(gains[0]!.setTargetAtTime).toHaveBeenCalledWith(0.5, 42, SMOOTHING);
		expect(pans[0]!.setTargetAtTime).toHaveBeenCalledWith(-0.25, 42, SMOOTHING);
	});

	it("ignores placement on a voice that ended or was stopped", async () => {
		const { context, gains, started } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING);
		await device.prepare(SOUND);

		const ended = device.playOneShot(SOUND, 1, 0)!;
		started[0]!.onended?.();
		ended.setPlacement(0.5, 0);

		const halted = device.playOneShot(SOUND, 1, 0)!;
		halted.stop();
		halted.setPlacement(0.5, 0);

		for (const gain of gains) {
			expect(gain.setTargetAtTime).not.toHaveBeenCalled();
		}
	});

	it("rejects a non-positive smoothing constant", () => {
		const { context } = fakeContext();
		expect(() => new WebAudioDevice(context, fakeSource(), 0)).toThrow(
			"positive duration",
		);
	});

	it("refuses playback after destruction", async () => {
		const { context } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING);
		await device.prepare(SOUND);

		device.destroy();

		expect(device.playOneShot(SOUND, 1, 0)).toBeNull();
	});
});
