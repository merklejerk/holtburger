import { describe, expect, it } from "vitest";
import {
	bindClientPresentationEnvironment,
	clientWeatherPresets,
	createClientServerEnvironmentSource,
	resolveClientEnvironmentSelection,
} from "./client-environment";
import {
	CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
	clientEnvironmentOverridesSchema,
	MINUTES_PER_GAME_DAY,
	type ClientEnvironmentOverrides,
} from "./client-environment-settings";
import {
	clientEnvironmentFixture,
	ENVIRONMENT_FIXTURE_DAY_SECONDS,
} from "./client-environment.test-support";
import { formatGameTime } from "./client-environment-format";

describe("client environment source and adapter", () => {
	it("shares the original source for server-following presentation", () => {
		const region = clientEnvironmentFixture();
		const server = createClientServerEnvironmentSource(region, () => 0);
		expect(
			bindClientPresentationEnvironment(
				server,
				region,
				CLIENT_ENVIRONMENT_OVERRIDES_DEFAULT,
			),
		).toEqual({ source: server, issue: null });
		server.refresh(0);
		expect(server.readout()?.weather).toEqual({ name: "Rainy", icon: "rainy" });
	});
	it.each([false, true])(
		"keeps server facts intact across rollover with fixed time=%s",
		(fixed) => {
			const region = clientEnvironmentFixture();
			const server = createClientServerEnvironmentSource(
				region,
				(timeMs) => timeMs / 1000,
			);
			const preset = clientWeatherPresets(region).find(
				({ choice }) => choice.dayGroupName === "Sunny",
			);
			if (preset === undefined) throw new Error("Fixture has no Sunny preset.");
			const overrides: ClientEnvironmentOverrides = {
				time: fixed
					? { kind: "fixed", minuteOfDay: MINUTES_PER_GAME_DAY / 2 }
					: { kind: "server" },
				weather: preset.choice,
			};
			const { source } = bindClientPresentationEnvironment(
				server,
				region,
				overrides,
			);
			// Retail hashing selects Rainy on fixture day 1 and Sunny on day 2.
			for (const dayFraction of [1.9, 2.1]) {
				server.refresh(dayFraction * ENVIRONMENT_FIXTURE_DAY_SECONDS * 1000);
				const base = server.read();
				const adapted = source.read();
				expect(adapted?.selection.dayIndex).toBe(base?.selection.dayIndex);
				expect(adapted?.selection.timeOfDay).toBeCloseTo(
					fixed ? 0.5 : dayFraction % 1,
				);
				expect(adapted?.environment.sky?.dayGroupName).toBe("Sunny");
				expect(server.readout()?.dayFraction).toBeCloseTo(dayFraction % 1);
				expect(server.readout()?.weather?.name).toBe(
					dayFraction < 2 ? "Rainy" : "Sunny",
				);
			}
		},
	);
	it("fixed time preserves automatically selected server weather while changing sky orientation", () => {
		const region = clientEnvironmentFixture();
		const server = createClientServerEnvironmentSource(
			region,
			() => ENVIRONMENT_FIXTURE_DAY_SECONDS / 4,
		);
		server.refresh(0);
		const binding = bindClientPresentationEnvironment(server, region, {
			time: { kind: "fixed", minuteOfDay: MINUTES_PER_GAME_DAY / 2 },
			weather: { kind: "server" },
		});
		expect(binding.source.read()?.environment.sky?.dayGroupName).toBe(
			server.readout()?.weather?.name,
		);
		expect(
			binding.source.read()?.environment.sky?.objects[0]?.orientation,
		).not.toEqual(server.read()?.environment.sky?.objects[0]?.orientation);
	});
	it("propagates unavailable time and represents missing authored weather honestly", () => {
		const region = clientEnvironmentFixture();
		const server = createClientServerEnvironmentSource(region, () => null);
		server.refresh(0);
		expect(server.readout()).toBeNull();
		expect(
			bindClientPresentationEnvironment(server, region, {
				time: { kind: "fixed", minuteOfDay: 0 },
				weather: { kind: "server" },
			}).source.read(),
		).toBeNull();
		const absent = createClientServerEnvironmentSource(
			{ ...region, data: { ...region.data, sky: null } },
			() => 0,
		);
		absent.refresh(0);
		expect(absent.readout()).toEqual({ dayFraction: 0, weather: null });
	});
	it("retains distinct duplicate names and gives unknown names neutral art", () => {
		const region = clientEnvironmentFixture();
		if (region.data.sky === null) throw new Error("Fixture sky missing.");
		const altered = {
			...region,
			data: {
				...region.data,
				sky: {
					...region.data.sky,
					dayGroups: region.data.sky.dayGroups.map((group) => ({
						...group,
						dayName: "Unfamiliar",
					})),
				},
			},
		};
		expect(clientWeatherPresets(altered).map(({ label }) => label)).toEqual([
			"Unfamiliar (variant 1)",
			"Unfamiliar (variant 2)",
		]);
		const source = createClientServerEnvironmentSource(altered, () => 0);
		source.refresh(0);
		expect(source.readout()?.weather).toEqual({
			name: "Unfamiliar",
			icon: "unknown",
		});
	});
	it.each([
		[{ sourceRecordId: "0x13000001" }, "different region."],
		[{ sourceVersion: 4 }, "different region version"],
		[{ dayGroupIndex: 100 }, "absent"],
		[{ dayGroupName: "Renamed" }, "name no longer matches"],
	] as const)("reports a stale preset %j at binding", (patch, message) => {
		const region = clientEnvironmentFixture();
		const preset = clientWeatherPresets(region)[0];
		if (preset === undefined) throw new Error("Fixture preset missing.");
		const server = createClientServerEnvironmentSource(region, () => 0);
		const binding = bindClientPresentationEnvironment(server, region, {
			time: { kind: "server" },
			weather: { ...preset.choice, ...patch },
		});
		expect(binding.issue).toContain(message);
		expect(binding.source).toBe(server);
	});
	it("reports a preset with no usable sky keyframes", () => {
		const region = clientEnvironmentFixture();
		const preset = clientWeatherPresets(region)[0];
		if (preset === undefined || region.data.sky === null)
			throw new Error("Fixture preset missing.");
		const altered = {
			...region,
			data: {
				...region.data,
				sky: {
					...region.data.sky,
					dayGroups: region.data.sky.dayGroups.map((group) => ({
						...group,
						skyTimes: [],
					})),
				},
			},
		};
		const server = createClientServerEnvironmentSource(altered, () => 0);
		expect(
			bindClientPresentationEnvironment(server, altered, {
				time: { kind: "server" },
				weather: preset.choice,
			}).issue,
		).toContain("no authored sky keyframes");
	});
	it("uses the calendar offset and rejects invalid synchronized time", () => {
		const region = clientEnvironmentFixture();
		expect(
			resolveClientEnvironmentSelection(
				{
					...region,
					data: {
						...region.data,
						calendar: {
							...region.data.calendar,
							zeroTimeOfYear: ENVIRONMENT_FIXTURE_DAY_SECONDS / 4,
						},
					},
				},
				ENVIRONMENT_FIXTURE_DAY_SECONDS * 0.75,
			).dayIndex,
		).toBe(1);
		for (const time of [NaN, Infinity, -1])
			expect(() => resolveClientEnvironmentSelection(region, time)).toThrow();
	});
});

describe("environment settings and clock text", () => {
	it.each([
		[0, "00:00", "12:00 AM"],
		[MINUTES_PER_GAME_DAY / 2, "12:00", "12:00 PM"],
		[MINUTES_PER_GAME_DAY - 1, "23:59", "11:59 PM"],
	])("formats minute %s in both conventions", (minute, full, half) => {
		expect(formatGameTime(minute / MINUTES_PER_GAME_DAY, "24-hour")).toBe(full);
		expect(formatGameTime(minute / MINUTES_PER_GAME_DAY, "12-hour")).toBe(half);
	});
	it("does not lose a minute at a floating-point day-rollover boundary", () => {
		expect(formatGameTime(1.9 % 1, "24-hour")).toBe("21:36");
		expect(formatGameTime(0.9 - 0.000001, "24-hour")).toBe("21:35");
	});
	it("validates boundaries and prevents stale inactive fields", () => {
		for (const minuteOfDay of [-1, MINUTES_PER_GAME_DAY, 0.5, NaN])
			expect(() =>
				clientEnvironmentOverridesSchema.parse({
					time: { kind: "fixed", minuteOfDay },
					weather: { kind: "server" },
				}),
			).toThrow();
		expect(() =>
			clientEnvironmentOverridesSchema.parse({
				time: { kind: "server", minuteOfDay: 0 },
				weather: { kind: "server" },
			}),
		).toThrow();
		for (const fraction of [-1, 1, NaN])
			expect(() => formatGameTime(fraction, "24-hour")).toThrow();
	});
});
