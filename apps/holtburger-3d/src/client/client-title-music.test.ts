import { describe, expect, it, vi } from "vitest";
import { ClientTitleMusic } from "./client-title-music";
import { CLIENT_AUDIO_DEFAULTS } from "./client-settings-defaults";

class TestAudio extends EventTarget {
	loop = false;
	preload: HTMLMediaElement["preload"] = "";
	volume = 1;
	muted = false;
	src = "";
	currentTime = 0;
	error: MediaError | null = null;
	play = vi.fn(() => Promise.resolve());
	pause = vi.fn();
	removeAttribute = vi.fn();
	load = vi.fn();
}

function fixture() {
	const audio = new TestAudio();
	const report = vi.fn();
	const music = new ClientTitleMusic("track.opus", report, () => audio);
	return { audio, report, music };
}

describe("optional title music", () => {
	it("keeps title volume independent of in-game master while honoring global mute", () => {
		const { audio, music } = fixture();
		for (const masterVolume of [0, 0.4, 1]) {
			music.setSettings({
				...CLIENT_AUDIO_DEFAULTS,
				masterVolume,
				musicVolume: 0.3,
			});
			expect(audio.volume).toBe(0.3);
			expect(audio.muted).toBe(false);
		}
		music.setSettings({
			...CLIENT_AUDIO_DEFAULTS,
			musicVolume: 0.6,
			muted: true,
		});
		expect(audio.volume).toBe(0.6);
		expect(audio.muted).toBe(true);
		music.setSettings({
			...CLIENT_AUDIO_DEFAULTS,
			musicVolume: 0.6,
			muted: false,
		});
		expect(audio.muted).toBe(false);
		expect(audio.volume).toBe(0.6);
	});

	it("applies the background preference immediately without resetting music position", () => {
		const { audio, music } = fixture();
		music.setSettings(CLIENT_AUDIO_DEFAULTS);
		music.setActive(true);
		audio.currentTime = 17;
		music.setForeground(false);
		expect(audio.pause).toHaveBeenCalledOnce();
		music.setSettings({ ...CLIENT_AUDIO_DEFAULTS, playInBackground: true });
		expect(audio.play).toHaveBeenCalledTimes(2);
		expect(audio.currentTime).toBe(17);
		music.setSettings(CLIENT_AUDIO_DEFAULTS);
		expect(audio.pause).toHaveBeenCalledTimes(2);
		music.setForeground(true);
		expect(audio.play).toHaveBeenCalledTimes(3);
		music.setActive(false);
		music.setSettings({ ...CLIENT_AUDIO_DEFAULTS, playInBackground: true });
		expect(audio.play).toHaveBeenCalledTimes(3);
	});
	it("plays once per selection visit, retains playback through updates, and restarts after world entry", () => {
		const { audio, music } = fixture();
		music.setSettings({
			...CLIENT_AUDIO_DEFAULTS,
			masterVolume: 0.4,
			musicVolume: 0.3,
		});
		music.setActive(true);
		expect(audio.loop).toBe(true);
		expect(audio.volume).toBeCloseTo(0.3);
		audio.currentTime = 17;
		music.setActive(true);
		music.setSettings({ ...CLIENT_AUDIO_DEFAULTS, muted: true });
		expect(audio.play).toHaveBeenCalledTimes(1);
		expect(audio.currentTime).toBe(17);
		expect(audio.muted).toBe(true);
		music.setActive(false);
		expect(audio.pause).toHaveBeenCalledOnce();
		expect(audio.currentTime).toBe(0);
		music.setActive(true);
		expect(audio.play).toHaveBeenCalledTimes(2);
	});

	it("admits an absent track without constructing browser audio", () => {
		const create = vi.fn();
		const report = vi.fn();
		const music = new ClientTitleMusic(undefined, report, create);
		music.setActive(true);
		music.setSettings(CLIENT_AUDIO_DEFAULTS);
		music.destroy();
		expect(create).not.toHaveBeenCalled();
		expect(report).not.toHaveBeenCalled();
	});

	it("reports load failures once and never retries on later screen changes", () => {
		const { audio, music, report } = fixture();
		music.setForeground(false);
		music.setSettings({ ...CLIENT_AUDIO_DEFAULTS, playInBackground: true });
		music.setActive(true);
		audio.dispatchEvent(new Event("error"));
		audio.dispatchEvent(new Event("error"));
		music.setSettings(CLIENT_AUDIO_DEFAULTS);
		music.setSettings({ ...CLIENT_AUDIO_DEFAULTS, playInBackground: true });
		music.setActive(false);
		music.setActive(true);
		expect(report).toHaveBeenCalledOnce();
		expect(audio.play).toHaveBeenCalledOnce();
	});

	it("contains rejected autoplay requests", async () => {
		const { audio, music, report } = fixture();
		const error = new Error("Playback denied");
		audio.play.mockRejectedValue(error);
		music.setActive(true);
		await Promise.resolve();
		expect(report).toHaveBeenCalledWith(error);
		expect(audio.pause).toHaveBeenCalledOnce();
	});

	it("ignores stale playback rejection after leaving selection", async () => {
		const { audio, music, report } = fixture();
		audio.play.mockRejectedValue(new DOMException("Paused", "AbortError"));
		music.setActive(true);
		music.setActive(false);
		await Promise.resolve();
		expect(report).not.toHaveBeenCalled();
	});

	it("releases the source on shutdown and ignores pending completion", async () => {
		const { audio, music, report } = fixture();
		audio.play.mockRejectedValue(new Error("Late rejection"));
		music.setActive(true);
		music.destroy();
		music.destroy();
		audio.dispatchEvent(new Event("error"));
		music.setActive(true);
		await Promise.resolve();
		expect(audio.pause).toHaveBeenCalledOnce();
		expect(audio.removeAttribute).toHaveBeenCalledWith("src");
		expect(audio.load).toHaveBeenCalledOnce();
		expect(audio.play).toHaveBeenCalledOnce();
		expect(report).not.toHaveBeenCalled();
	});
	it("pauses in the background and resumes the same position and mix", () => {
		const { audio, music } = fixture();
		music.setSettings({
			...CLIENT_AUDIO_DEFAULTS,
			musicVolume: 0.37,
			muted: true,
		});
		music.setActive(true);
		audio.currentTime = 23;
		music.setForeground(false);
		music.setForeground(false);
		expect(audio.pause).toHaveBeenCalledOnce();
		expect(audio.currentTime).toBe(23);
		music.setForeground(true);
		music.setForeground(true);
		expect(audio.play).toHaveBeenCalledTimes(2);
		expect(audio.currentTime).toBe(23);
		expect(audio.volume).toBe(0.37);
		expect(audio.muted).toBe(true);
	});

	it("defers playback when selection first appears in the background", () => {
		const { audio, music } = fixture();
		music.setForeground(false);
		music.setActive(true);
		expect(audio.play).not.toHaveBeenCalled();
		music.setForeground(true);
		expect(audio.play).toHaveBeenCalledOnce();
	});

	it("resets on world entry while suspended and stays stopped when focus returns", () => {
		const { audio, music } = fixture();
		music.setActive(true);
		audio.currentTime = 23;
		music.setForeground(false);
		music.setActive(false);
		expect(audio.currentTime).toBe(0);
		music.setForeground(true);
		expect(audio.play).toHaveBeenCalledOnce();
		music.setActive(true);
		expect(audio.play).toHaveBeenCalledTimes(2);
	});

	it("ignores a pending play rejection after background suspension", async () => {
		const { audio, music, report } = fixture();
		audio.play.mockRejectedValueOnce(new DOMException("Paused", "AbortError"));
		music.setActive(true);
		music.setForeground(false);
		await Promise.resolve();
		music.setForeground(true);
		expect(report).not.toHaveBeenCalled();
		expect(audio.play).toHaveBeenCalledTimes(2);
	});
});
