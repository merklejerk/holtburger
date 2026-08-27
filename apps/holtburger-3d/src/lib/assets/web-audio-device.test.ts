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
	/** Gain params in creation order: master, left channel, right channel — per voice. */
	const gains: FakeParam[] = [];
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
		createChannelMerger: () => node(),
		createGain: () => ({ ...node(), gain: param(gains) }),
		currentTime: 42,
		decodeAudioData: async () => ({}) as AudioBuffer,
		destination: {},
	} as unknown as AudioContext;
	return { context, gains, started, stopped };
}

/** Per-voice view over the flat creation-ordered gain params. */
function voiceGains(gains: FakeParam[], voiceIndex: number) {
	return {
		left: gains[voiceIndex * 3 + 1]!,
		master: gains[voiceIndex * 3]!,
		right: gains[voiceIndex * 3 + 2]!,
	};
}

/** Retail's far-channel shadow at full pan: 15 dB down. */
const FULL_PAN_SHADOW = 10 ** (-15 / 20);

const SMOOTHING = 0.02;
/** Identity contour: tests reason in retail-linear gain unless shaping is the subject. */
const LINEAR = 1;

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
		const device = new WebAudioDevice(context, source, SMOOTHING, LINEAR);

		// Playing an ambient one-shot late is worse than not playing it, so the first call skips.
		expect(device.playOneShot(SOUND, 1, 0)).toBeNull();
		expect(started).toHaveLength(0);

		await device.prepare(SOUND);
		expect(device.getPreparedSourceBytes?.(SOUND)).toBe(8);
		expect(device.playOneShot(SOUND, 1, 0)).not.toBeNull();
		expect(started).toHaveLength(1);
	});

	it("decodes each sound exactly once across concurrent requests", async () => {
		const { context } = fakeContext();
		const source = fakeSource();
		const device = new WebAudioDevice(context, source, SMOOTHING, LINEAR);

		await Promise.all([device.prepare(SOUND), device.prepare(SOUND)]);
		await device.prepare(SOUND);

		expect(source.loads).toEqual([SOUND]);
	});

	it("tolerates stopping a voice that already ended", async () => {
		const { context } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING, LINEAR);
		await device.prepare(SOUND);
		const voice = device.playOneShot(SOUND, 1, 0)!;

		voice.stop();
		// Stopping twice must not throw: a finished voice is the normal case.
		expect(() => voice.stop()).not.toThrow();
	});

	it("steers a live voice through setTargetAtTime rather than stepping the params", async () => {
		const { context, gains } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING, LINEAR);
		await device.prepare(SOUND);
		const voice = device.playOneShot(SOUND, 1, 0)!;

		voice.setPlacement(0.5, -0.25);

		const { left, master, right } = voiceGains(gains, 0);
		// Initial values are set directly (the signal starts there); updates must glide.
		expect(master.value).toBe(1);
		expect(master.setTargetAtTime).toHaveBeenCalledWith(0.5, 42, SMOOTHING);
		// Pan -0.25 puts the source to the left: left ear untouched, right ear shadowed.
		expect(left.setTargetAtTime).toHaveBeenCalledWith(1, 42, SMOOTHING);
		expect(right.setTargetAtTime).toHaveBeenCalledWith(
			10 ** ((-15 * 0.25) / 20),
			42,
			SMOOTHING,
		);
	});

	it("plays a centred sound at full gain in both channels, as retail does", async () => {
		// RETAIL QUIRK: DirectSound pan attenuates the far channel only; centred means no
		// attenuation anywhere, not the -3 dB per ear an equal-power panner would apply.
		const { context, gains } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING, LINEAR);
		await device.prepare(SOUND);
		device.playOneShot(SOUND, 0.8, 0)!;

		const { left, master, right } = voiceGains(gains, 0);
		expect(master.value).toBeCloseTo(0.8);
		expect(left.value).toBe(1);
		expect(right.value).toBe(1);
	});

	it("keeps the far ear at a 15 dB shadow at full pan instead of silencing it", async () => {
		const { context, gains } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING, LINEAR);
		await device.prepare(SOUND);
		device.playOneShot(SOUND, 1, 1)!;

		const { left, right } = voiceGains(gains, 0);
		// Full right pan: right ear untouched, left ear shadowed but never silent.
		expect(right.value).toBe(1);
		expect(left.value).toBeCloseTo(FULL_PAN_SHADOW);
		expect(left.value).toBeGreaterThan(0.17);
	});

	it("ignores placement on a voice that ended or was stopped", async () => {
		const { context, gains, started } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING, LINEAR);
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
		expect(() => new WebAudioDevice(context, fakeSource(), 0, LINEAR)).toThrow(
			"positive duration",
		);
	});

	it("rejects a non-positive loudness curve exponent", () => {
		const { context } = fakeContext();
		expect(
			() => new WebAudioDevice(context, fakeSource(), SMOOTHING, 0),
		).toThrow("must be positive");
	});

	it("shapes gain through the loudness contour, at start and when steered", async () => {
		// RETAIL DIVERGENCE (see frontend-tuning): exponent < 1 lifts quiet gains toward the mids
		// with fixed points at 0 and 1; the channel shadow stays dB-exact retail pan law.
		const { context, gains } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING, 0.5);
		await device.prepare(SOUND);
		const voice = device.playOneShot(SOUND, 0.04, 1)!;

		const { left, master, right } = voiceGains(gains, 0);
		expect(master.value).toBeCloseTo(0.2);
		expect(right.value).toBe(1);
		expect(left.value).toBeCloseTo(FULL_PAN_SHADOW);

		voice.setPlacement(0.25, 1);
		expect(master.setTargetAtTime).toHaveBeenCalledWith(0.5, 42, SMOOTHING);
	});

	it("refuses playback after destruction", async () => {
		const { context } = fakeContext();
		const device = new WebAudioDevice(context, fakeSource(), SMOOTHING, LINEAR);
		await device.prepare(SOUND);

		device.destroy();

		expect(device.playOneShot(SOUND, 1, 0)).toBeNull();
		expect(device.getPreparedSourceBytes?.(SOUND)).toBeNull();
	});
});
