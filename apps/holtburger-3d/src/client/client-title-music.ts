import type { ClientAudioSettings } from "./client-settings-contract";

// A glob permits source distributions to omit the optional track without breaking the build.
const tracks = import.meta.glob<string>("../assets/audio/title-music.opus", {
	eager: true,
	query: "?url",
	import: "default",
});
export const titleMusicUrl = tracks["../assets/audio/title-music.opus"];

/** Browser media operations used by title music, independent of the world audio device. */
type MusicAudio = Pick<
	HTMLAudioElement,
	| "loop"
	| "preload"
	| "volume"
	| "muted"
	| "src"
	| "currentTime"
	| "error"
	| "addEventListener"
	| "removeEventListener"
	| "play"
	| "pause"
	| "removeAttribute"
	| "load"
>;

/** App-owned, non-spatial music; an unavailable track never participates in session readiness. */
export class ClientTitleMusic {
	readonly #audio: MusicAudio | null;
	readonly #report: (error: unknown) => void;
	#active = false;
	/** Window attention pauses playback independently of whether the selection page owns the track. */
	#foreground = true;
	/** Last requested playback state keeps repeated focus/visibility events idempotent. */
	#playRequested = false;
	#playRevision = 0;
	#failed = false;
	#destroyed = false;

	constructor(
		url: string | undefined,
		report: (error: unknown) => void,
		createAudio: () => MusicAudio = () => new Audio(),
	) {
		this.#report = report;
		if (url === undefined) {
			this.#audio = null;
			return;
		}
		this.#audio = createAudio();
		this.#audio.loop = true;
		this.#audio.preload = "none";
		// Install the saved mix before the first play request, even on a fast local load.
		this.#audio.volume = 0;
		this.#audio.addEventListener("error", this.#onError);
		this.#audio.src = url;
	}

	setSettings(settings: ClientAudioSettings): void {
		if (this.#audio === null || this.#destroyed) return;
		this.#audio.volume = settings.masterVolume * settings.musicVolume;
		this.#audio.muted = settings.muted;
	}

	setActive(active: boolean): void {
		if (
			this.#destroyed ||
			this.#failed ||
			this.#audio === null ||
			active === this.#active
		)
			return;
		this.#active = active;
		this.#updatePlayback();
		// Leaving selection resets even when background suspension already paused the track.
		if (!active) this.#audio.currentTime = 0;
	}

	/** Background suspension preserves position and never changes the saved audio mix. */
	setForeground(foreground: boolean): void {
		if (this.#destroyed || this.#failed || foreground === this.#foreground)
			return;
		this.#foreground = foreground;
		this.#updatePlayback();
	}

	#updatePlayback(): void {
		const audio = this.#audio;
		if (audio === null) return;
		const shouldPlay = this.#active && this.#foreground;
		if (shouldPlay === this.#playRequested) return;
		this.#playRequested = shouldPlay;
		const revision = ++this.#playRevision;
		if (!shouldPlay) {
			audio.pause();
			return;
		}
		try {
			void audio.play().catch((error: unknown) => {
				// pause() may reject an earlier pending play; only the current request owns failure.
				if (revision === this.#playRevision && !this.#destroyed)
					this.#fail(error);
			});
		} catch (error) {
			this.#fail(error);
		}
	}

	readonly #onError = (): void => {
		this.#fail(this.#audio?.error ?? new Error("Title music failed to load."));
	};

	#fail(error: unknown): void {
		if (this.#failed || this.#destroyed) return;
		this.#failed = true;
		this.#audio?.pause();
		this.#report(error);
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		if (this.#audio === null) return;
		this.#audio.removeEventListener("error", this.#onError);
		this.#audio.pause();
		this.#audio.removeAttribute("src");
		this.#audio.load();
	}
}

/** Browser focus and visibility jointly own suspension; page admission still owns stop/reset. */
export function bindTitleMusicForeground(
	music: ClientTitleMusic,
	window: Window,
): () => void {
	const document = window.document;
	const lifetime = new AbortController();
	const options = { signal: lifetime.signal };
	const update = () =>
		music.setForeground(document.hasFocus() && !document.hidden);
	window.addEventListener("focus", update, options);
	window.addEventListener("blur", update, options);
	document.addEventListener("visibilitychange", update, options);
	update();
	return () => lifetime.abort();
}
