import {
	bindClientPresentationEnvironment,
	clientWeatherPresets,
	createClientServerEnvironmentSource,
	CLIENT_ENVIRONMENT_INTERVAL_MS,
	type ClientEnvironmentReadout,
	type ClientEnvironmentSource,
	type ClientServerEnvironmentSource,
	type ClientWeatherPreset,
} from "../settings/environment";
import {
	CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
	type ClientEnvironmentOverrides,
} from "../settings/environment-settings";
import type { ClientGameplayPresentationResources } from "./gameplay-presentation";

export interface ClientEnvironmentPresenterOptions {
	readonly onWeatherPresets?: (presets: readonly ClientWeatherPreset[]) => void;
	readonly onEnvironmentIssue?: (issue: string | null) => void;
}

/**
 * Owns server environment sampling and local override binding for one gameplay presentation.
 *
 * Local overrides can be staged before `attach()` and replace only the presentation source
 * without discarding the authoritative server readout.
 */
export class ClientEnvironmentPresenter {
	/** Source composition owns one server sample; the presenter retains no resolved output. */
	#environmentSources: {
		readonly server: ClientServerEnvironmentSource;
		presentation: ClientEnvironmentSource;
	} | null = null;
	/** Cold preferences seed the borrowed runtime when gameplay starts. */
	#environmentOverrides: ClientEnvironmentOverrides =
		CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT;
	#lastEnvironmentAtMs = Number.NEGATIVE_INFINITY;
	#activeResources: ClientGameplayPresentationResources | null = null;
	readonly #onWeatherPresets: ClientEnvironmentPresenterOptions["onWeatherPresets"];
	readonly #onEnvironmentIssue: ClientEnvironmentPresenterOptions["onEnvironmentIssue"];

	constructor(options: ClientEnvironmentPresenterOptions) {
		this.#onWeatherPresets = options.onWeatherPresets;
		this.#onEnvironmentIssue = options.onEnvironmentIssue;
	}

	/** True server display facts; this capability is never routed through the override adapter. */
	readServerEnvironment(): ClientEnvironmentReadout | null {
		return this.#environmentSources?.server.readout() ?? null;
	}

	/** Replace only the local presentation binding; the server source and runtime survive. */
	setEnvironmentOverrides(overrides: ClientEnvironmentOverrides): void {
		this.#environmentOverrides = overrides;
		this.#bindEnvironment();
		this.#applyEnvironment();
	}

	attach(
		resources: ClientGameplayPresentationResources,
		readServerTime: (timeMs: number) => number | null,
	): void {
		this.#activeResources = resources;
		const server = createClientServerEnvironmentSource(
			resources.activeRegion,
			readServerTime,
		);
		this.#environmentSources = { server, presentation: server };
		this.#onWeatherPresets?.(clientWeatherPresets(resources.activeRegion));
		this.#bindEnvironment();
	}

	detach(): void {
		this.#activeResources = null;
		this.#environmentSources = null;
		this.#lastEnvironmentAtMs = Number.NEGATIVE_INFINITY;
		this.#onWeatherPresets?.([]);
		this.#onEnvironmentIssue?.(null);
	}

	refreshIfDue(nowMs: number): void {
		if (nowMs - this.#lastEnvironmentAtMs >= CLIENT_ENVIRONMENT_INTERVAL_MS) {
			this.refreshNow(nowMs);
		}
	}

	refreshNow(nowMs: number): void {
		const resources = this.#activeResources;
		const sources = this.#environmentSources;
		if (resources === null || sources === null) return;
		sources.server.refresh(nowMs);
		this.#lastEnvironmentAtMs = nowMs;
		this.#applyEnvironment();
	}

	#bindEnvironment(): void {
		const resources = this.#activeResources;
		const sources = this.#environmentSources;
		if (resources === null || sources === null) return;
		const binding = bindClientPresentationEnvironment(
			sources.server,
			resources.activeRegion,
			this.#environmentOverrides,
		);
		sources.presentation = binding.source;
		this.#onEnvironmentIssue?.(binding.issue);
	}

	/** Renderer application is shared by cold binding changes and server-source refresh. */
	#applyEnvironment(): void {
		const resources = this.#activeResources;
		const sources = this.#environmentSources;
		if (resources === null || sources === null) return;
		const sample = sources.presentation.read();
		if (sample !== null) {
			resources.runtime.setSceneEnvironment(sample.environment);
		}
	}
}
