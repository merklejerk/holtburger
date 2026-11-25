import { describe, expect, it, vi } from "vitest";
import {
	API_CUE_MIN_INTERVAL_MS,
	ClientApiCuePlayer,
	type ApiCueAudioContext,
} from "./api-cue-player";
import { CLIENT_AUDIO_DEFAULTS } from "../settings/settings-defaults";

function createFakeAudioContext(state: AudioContextState = "running") {
	const oscillators: Array<{
		type: OscillatorType;
		start: ReturnType<typeof vi.fn>;
		stop: ReturnType<typeof vi.fn>;
		frequencies: number[];
	}> = [];
	const resume = vi.fn(async () => undefined);
	const close = vi.fn(async () => undefined);
	const ctx: ApiCueAudioContext = {
		currentTime: 10,
		state,
		destination: {},
		resume,
		close,
		createOscillator: () => {
			const frequencies: number[] = [];
			const start = vi.fn();
			const stop = vi.fn();
			const record = {
				type: "sine" as OscillatorType,
				start,
				stop,
				frequencies,
			};
			oscillators.push(record);
			return {
				get type() {
					return record.type;
				},
				set type(value: OscillatorType) {
					record.type = value;
				},
				frequency: {
					setValueAtTime: (freq: number) => {
						frequencies.push(freq);
					},
					exponentialRampToValueAtTime: vi.fn(),
				},
				connect: vi.fn(),
				start,
				stop,
			};
		},
		createGain: () => ({
			gain: {
				setValueAtTime: vi.fn(),
				exponentialRampToValueAtTime: vi.fn(),
			},
			connect: vi.fn(),
		}),
	};
	return { ctx, oscillators, resume, close };
}

describe("ClientApiCuePlayer", () => {
	const baseSettings = {
		...CLIENT_AUDIO_DEFAULTS,
		muted: false,
		masterVolume: 0.8,
		effectVolume: 0.7,
		playInBackground: false,
	};

	it("synthesizes distinct cues, enforces cooldown, and cleans up AudioContext on destroy", () => {
		let clock = 1_000;
		const fake = createFakeAudioContext("suspended");
		const factory = vi.fn(() => fake.ctx);
		const player = new ClientApiCuePlayer({
			initialSettings: baseSettings,
			now: () => clock,
			audioContextFactory: factory,
		});

		expect(player.play("info")).toBe("played");
		expect(factory).toHaveBeenCalledTimes(1);
		expect(fake.resume).toHaveBeenCalledTimes(1);
		expect(fake.oscillators).toHaveLength(1);

		// Within cooldown window -> rate-limited without allocating oscillators.
		clock += API_CUE_MIN_INTERVAL_MS - 1;
		expect(player.play("alert")).toBe("rate-limited");
		expect(fake.oscillators).toHaveLength(1);

		// At cooldown boundary -> two-note alert cue schedules cleanly, followed by error cue.
		clock += 1;
		expect(player.play("alert")).toBe("played");
		expect(fake.oscillators).toHaveLength(3);

		clock += API_CUE_MIN_INTERVAL_MS;
		expect(player.play("error")).toBe("played");
		expect(fake.oscillators).toHaveLength(5);

		player.destroy();
		expect(fake.close).toHaveBeenCalledTimes(1);
		expect(player.play("success")).toBe("unavailable");
	});

	it("respects session API mute, global audio mute, volume, and background policy", () => {
		let clock = 5_000;
		const fake = createFakeAudioContext();
		const player = new ClientApiCuePlayer({
			initialSettings: baseSettings,
			initialForeground: false,
			now: () => clock,
			audioContextFactory: () => fake.ctx,
		});

		// Background suppressed while playInBackground is false.
		expect(player.play("warn")).toBe("background-suppressed");

		// Enabling playInBackground allows playback while unfocused.
		player.setAudioSettings({ ...baseSettings, playInBackground: true });
		expect(player.play("warn")).toBe("played");
		clock += API_CUE_MIN_INTERVAL_MS;

		// Session-local API mute silences cues without touching global settings.
		player.setApiMuted(true);
		expect(player.play("success")).toBe("muted");
		player.setApiMuted(false);

		// Global audio mute or zero effect volume suppresses playback.
		player.setAudioSettings({ ...baseSettings, muted: true });
		expect(player.play("info")).toBe("muted");
		player.setAudioSettings({ ...baseSettings, effectVolume: 0 });
		expect(player.play("info")).toBe("muted");
	});
});
