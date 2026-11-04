import type { ActiveRegionSource } from "../lib/assets/active-region-source";
import { resolveDayFraction } from "../lib/game/environment/game-clock";
import {
	resolveSceneEnvironment,
	type SceneEnvironmentSelection,
	type ResolvedSceneEnvironment,
} from "../lib/game/environment/scene-environment";
import {
	MINUTES_PER_GAME_DAY,
	type ClientEnvironmentOverrides,
} from "./client-environment-settings";

/** Maximum real-time interval between coherent client environment samples. */
export const CLIENT_ENVIRONMENT_INTERVAL_MS = 250;

/** Authored weather names mapped explicitly; other content keeps its exact name and neutral art. */
type ClientWeatherIcon = "sunny" | "clear" | "cloudy" | "rainy" | "unknown";

/** Server-only display facts, projected by their source rather than reconstructed by markup. */
export interface ClientEnvironmentReadout {
	readonly dayFraction: number;
	readonly weather: {
		readonly name: string;
		readonly icon: ClientWeatherIcon;
	} | null;
}

/** Coherent selection/output pair: the adapter consumes selection; rendering consumes output. */
export interface ClientEnvironmentSample {
	readonly selection: SceneEnvironmentSelection;
	readonly environment: ResolvedSceneEnvironment;
}

/** Consumer-facing pull capability, independent of override configuration. */
export interface ClientEnvironmentSource {
	read(): ClientEnvironmentSample | null;
}

/** Server source owns the bounded sample and its display projection. */
export interface ClientServerEnvironmentSource extends ClientEnvironmentSource {
	refresh(timeMs: number): void;
	readout(): ClientEnvironmentReadout | null;
}

/** One distinct authored preset offered by Settings; identity also validates a saved choice. */
export interface ClientWeatherPreset {
	readonly choice: Extract<
		ClientEnvironmentOverrides["weather"],
		{ kind: "preset" }
	>;
	readonly label: string;
}

/** Convert synchronized portal-year seconds using the active region's authored calendar. */
export function resolveClientEnvironmentSelection(
	activeRegion: ActiveRegionSource,
	serverTime: number,
): SceneEnvironmentSelection {
	if (!Number.isFinite(serverTime))
		throw new Error("Client server time must be finite.");
	const { dayLength, zeroTimeOfYear } = activeRegion.data.calendar;
	const elapsed = serverTime + zeroTimeOfYear;
	if (elapsed < 0)
		throw new Error("Client server time precedes the active-region calendar.");
	return {
		dayIndex: Math.floor(elapsed / dayLength),
		timeOfDay: resolveDayFraction(elapsed, dayLength),
		dayGroupOverride: null,
	};
}

/** One source of true facts, shared by the readout and the presentation adapter. */
export function createClientServerEnvironmentSource(
	region: ActiveRegionSource,
	readServerTime: (timeMs: number) => number | null,
): ClientServerEnvironmentSource {
	// The projection and resolved facts share one lifetime and one atomic replacement.
	let sample:
		| (ClientEnvironmentSample & { readonly readout: ClientEnvironmentReadout })
		| null = null;
	return {
		read: () => sample,
		readout: () => sample?.readout ?? null,
		refresh: (timeMs) => {
			const serverTime = readServerTime(timeMs);
			if (serverTime === null) {
				sample = null;
				return;
			}
			const selection = resolveClientEnvironmentSelection(region, serverTime);
			const environment = resolveSceneEnvironment(region, selection);
			const sky = environment.sky;
			sample = {
				selection,
				environment,
				readout: {
					dayFraction: selection.timeOfDay,
					weather:
						sky === null
							? null
							: { name: sky.dayGroupName, icon: weatherIcon(sky.dayGroupName) },
				},
			};
		},
	};
}

/** Catalog retains duplicate authored variants, assigning readable labels in authored order. */
export function clientWeatherPresets(
	region: ActiveRegionSource,
): readonly ClientWeatherPreset[] {
	const groups = region.data.sky?.dayGroups;
	if (groups === undefined) return [];
	const counts = new Map<string, number>();
	return groups.flatMap((group, dayGroupIndex) => {
		if (group.skyTimes.length === 0) return [];
		const variant = (counts.get(group.dayName) ?? 0) + 1;
		counts.set(group.dayName, variant);
		return [
			{
				choice: {
					kind: "preset" as const,
					sourceRecordId: region.provenance.sourceRecordId,
					sourceVersion: region.provenance.version,
					dayGroupIndex,
					dayGroupName: group.dayName,
				},
				label: `${group.dayName} (variant ${variant})`,
			},
		];
	});
}

/** Binding outcome exposes content mismatch once at configuration, never at render cadence. */
export interface ClientPresentationEnvironmentBinding {
	readonly source: ClientEnvironmentSource;
	readonly issue: string | null;
}

/** Stateless selection adapter; both consuming layers are unaware of override modes. */
export function bindClientPresentationEnvironment(
	server: ClientEnvironmentSource,
	region: ActiveRegionSource,
	overrides: ClientEnvironmentOverrides,
): ClientPresentationEnvironmentBinding {
	const issue = presetIssue(region, overrides.weather);
	if (issue !== null) return { source: server, issue };
	if (overrides.time.kind === "server" && overrides.weather.kind === "server") {
		return { source: server, issue: null };
	}
	const source: ClientEnvironmentSource = {
		read: () => {
			const base = server.read();
			if (base === null) return null;
			const selection = {
				...base.selection,
				timeOfDay:
					overrides.time.kind === "fixed"
						? overrides.time.minuteOfDay / MINUTES_PER_GAME_DAY
						: base.selection.timeOfDay,
				dayGroupOverride:
					overrides.weather.kind === "preset"
						? overrides.weather.dayGroupIndex
						: base.selection.dayGroupOverride,
			};
			return {
				selection,
				environment: resolveSceneEnvironment(region, selection),
			};
		},
	};
	return { source, issue: null };
}

function presetIssue(
	region: ActiveRegionSource,
	weather: ClientEnvironmentOverrides["weather"],
): string | null {
	if (weather.kind === "server") return null;
	if (
		weather.sourceRecordId.toLowerCase() !==
		region.provenance.sourceRecordId.toLowerCase()
	)
		return "Saved weather preset belongs to a different region.";
	if (weather.sourceVersion !== region.provenance.version)
		return "Saved weather preset belongs to a different region version.";
	const group = region.data.sky?.dayGroups[weather.dayGroupIndex];
	if (group === undefined)
		return "Saved weather preset is absent from the active region.";
	if (group.dayName !== weather.dayGroupName)
		return "Saved weather preset name no longer matches the active region.";
	if (group.skyTimes.length === 0)
		return "Saved weather preset has no authored sky keyframes.";
	return null;
}

function weatherIcon(name: string): ClientWeatherIcon {
	// Active-region census (2026-10-10): 6 Sunny, 3 Clear, 3 Cloudy, 8 Rainy groups.
	// Names describe whole presets; they do not assert precipitation is visible at this instant.
	switch (name) {
		case "Sunny":
			return "sunny";
		case "Clear":
			return "clear";
		case "Cloudy":
			return "cloudy";
		case "Rainy":
			return "rainy";
		default:
			return "unknown";
	}
}
