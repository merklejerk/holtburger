import type { ClientApiAudioCue } from "../session/host-contract";
import type { ClientAudioSettings } from "../settings/settings-contract";

/** Minimum interval between played Live API attention cues to prevent audio spam. */
export const API_CUE_MIN_INTERVAL_MS = 500;

/** Peak gain scalar applied on top of `masterVolume * effectVolume` for non-diegetic chimes. */
const BASE_CUE_GAIN = 0.22;
const ATTACK_SECONDS = 0.008;
const MIN_RAMP_GAIN = 0.0001;

interface CueNote {
	readonly frequencyHz: number;
	readonly delayMs: number;
	readonly durationMs: number;
	readonly type: OscillatorType;
}

const CUE_RECIPES: Readonly<Record<ClientApiAudioCue, readonly CueNote[]>> = {
	info: [{ frequencyHz: 660, delayMs: 0, durationMs: 160, type: "sine" }],
	success: [
		{ frequencyHz: 523.25, delayMs: 0, durationMs: 100, type: "sine" },
		{ frequencyHz: 783.99, delayMs: 90, durationMs: 150, type: "sine" },
	],
	warn: [
		{ frequencyHz: 440, delayMs: 0, durationMs: 120, type: "triangle" },
		{ frequencyHz: 392, delayMs: 110, durationMs: 160, type: "triangle" },
	],
	error: [
		{ frequencyHz: 329.63, delayMs: 0, durationMs: 140, type: "triangle" },
		{ frequencyHz: 246.94, delayMs: 130, durationMs: 200, type: "triangle" },
	],
	alert: [
		{ frequencyHz: 880, delayMs: 0, durationMs: 110, type: "sine" },
		{ frequencyHz: 1046.5, delayMs: 110, durationMs: 180, type: "sine" },
	],
};

export type ApiCuePlayOutcome =
	"played" | "muted" | "background-suppressed" | "rate-limited" | "unavailable";

interface MinimalAudioParam {
	setValueAtTime(value: number, startTime: number): unknown;
	exponentialRampToValueAtTime(value: number, endTime: number): unknown;
}

interface MinimalGainNode {
	readonly gain: MinimalAudioParam;
	connect(destination: unknown): unknown;
}

interface MinimalOscillatorNode {
	type: OscillatorType;
	readonly frequency: MinimalAudioParam;
	connect(destination: unknown): unknown;
	start(when?: number): void;
	stop(when?: number): void;
}

export interface ApiCueAudioContext {
	readonly currentTime: number;
	readonly state: AudioContextState;
	readonly destination: unknown;
	resume(): Promise<void>;
	close(): Promise<void>;
	createOscillator(): MinimalOscillatorNode;
	createGain(): MinimalGainNode;
}

export interface ClientApiCuePlayerOptions {
	readonly initialSettings: ClientAudioSettings;
	readonly initialForeground?: boolean;
	readonly now?: () => number;
	readonly minIntervalMs?: number;
	readonly audioContextFactory?: () => ApiCueAudioContext | null;
}

function defaultAudioContextFactory(): ApiCueAudioContext | null {
	if (typeof AudioContext === "undefined") return null;
	return new AudioContext();
}

/**
 * Synthesizes lightweight non-diegetic UI attention chimes for Live API `hud-play-cue` commands.
 * Respects global audio settings, foreground/background policy, session-local API mute, and a
 * built-in cooldown without depending on DAT audio assets or an active 3D viewport.
 */
export class ClientApiCuePlayer {
	readonly #now: () => number;
	readonly #minIntervalMs: number;
	readonly #audioContextFactory: () => ApiCueAudioContext | null;
	#settings: ClientAudioSettings;
	#foreground: boolean;
	#apiMuted = false;
	#lastPlayedAtMs: number | null = null;
	#context: ApiCueAudioContext | null = null;
	#destroyed = false;

	constructor(options: ClientApiCuePlayerOptions) {
		this.#settings = options.initialSettings;
		this.#foreground = options.initialForeground ?? true;
		this.#now = options.now ?? (() => performance.now());
		this.#minIntervalMs = options.minIntervalMs ?? API_CUE_MIN_INTERVAL_MS;
		this.#audioContextFactory =
			options.audioContextFactory ?? defaultAudioContextFactory;
	}

	setApiMuted(muted: boolean): void {
		this.#apiMuted = muted;
	}

	setAudioSettings(settings: ClientAudioSettings): void {
		this.#settings = settings;
	}

	setForeground(foreground: boolean): void {
		this.#foreground = foreground;
	}

	play(cue: ClientApiAudioCue): ApiCuePlayOutcome {
		if (this.#destroyed) return "unavailable";
		if (this.#apiMuted || this.#settings.muted) return "muted";
		const effectiveVolume =
			this.#settings.masterVolume * this.#settings.effectVolume;
		if (!Number.isFinite(effectiveVolume) || effectiveVolume <= 0)
			return "muted";
		if (!this.#foreground && !this.#settings.playInBackground) {
			return "background-suppressed";
		}
		const nowMs = this.#now();
		if (
			this.#lastPlayedAtMs !== null &&
			nowMs - this.#lastPlayedAtMs < this.#minIntervalMs
		) {
			return "rate-limited";
		}
		const ctx = this.#ensureContext();
		if (ctx === null) return "unavailable";
		if (ctx.state === "suspended") {
			void ctx.resume().catch(() => undefined);
		}

		const peakGain = Math.max(
			MIN_RAMP_GAIN * 2,
			Math.min(1, effectiveVolume * BASE_CUE_GAIN),
		);
		this.#scheduleNotes(ctx, CUE_RECIPES[cue], peakGain);
		this.#lastPlayedAtMs = nowMs;
		return "played";
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const ctx = this.#context;
		this.#context = null;
		if (ctx !== null) {
			void ctx.close().catch(() => undefined);
		}
	}

	#ensureContext(): ApiCueAudioContext | null {
		if (this.#context !== null) return this.#context;
		try {
			this.#context = this.#audioContextFactory();
		} catch {
			this.#context = null;
		}
		return this.#context;
	}

	#scheduleNotes(
		ctx: ApiCueAudioContext,
		notes: readonly CueNote[],
		peakGain: number,
	): void {
		const origin = ctx.currentTime;
		for (const note of notes) {
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			const start = origin + note.delayMs / 1_000;
			const duration = note.durationMs / 1_000;
			const attackEnd = start + Math.min(ATTACK_SECONDS, duration * 0.25);
			const end = start + duration;

			osc.type = note.type;
			osc.frequency.setValueAtTime(note.frequencyHz, start);

			gain.gain.setValueAtTime(MIN_RAMP_GAIN, start);
			gain.gain.exponentialRampToValueAtTime(peakGain, attackEnd);
			gain.gain.exponentialRampToValueAtTime(MIN_RAMP_GAIN, end);

			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(start);
			osc.stop(end + 0.01);
		}
	}
}
