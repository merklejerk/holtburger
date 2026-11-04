import { describe, expect, it } from "vitest";

import {
	HOST_COMMAND_NAMES,
	HOST_EVENT_NAMES,
	HOST_MODES,
	MODE_COMMAND_NAMES,
	MODE_EVENT_NAMES,
} from "./host-transport";

/** Commands issued by each route while it mounts, before user interaction starts. */
const STARTUP_COMMANDS = {
	explorer: [
		"request_explorer_dynamic_entity_snapshot",
		"explorer_catalog_capability",
		"load_active_region_data",
		"load_sky_source",
	],
	client: ["request_client_current_state", "load_active_region_data"],
} as const;

describe("host mode inventories", () => {
	it("gives each mode an explicit command and event inventory", () => {
		for (const mode of HOST_MODES) {
			expect(MODE_COMMAND_NAMES[mode].length).toBeGreaterThan(0);
			expect(MODE_EVENT_NAMES[mode].length).toBeGreaterThan(0);
		}
	});

	it("allowlists every command issued during route startup", () => {
		for (const mode of HOST_MODES) {
			for (const command of STARTUP_COMMANDS[mode]) {
				expect(MODE_COMMAND_NAMES[mode]).toContain(command);
			}
		}
	});

	it("does not expose one authority's commands through the other mode", () => {
		expect(MODE_COMMAND_NAMES.client).not.toContain(
			"request_explorer_dynamic_entity_snapshot",
		);
		expect(MODE_COMMAND_NAMES.explorer).not.toContain(
			"request_client_current_state",
		);
	});

	it("keeps the privileged client startup command out of every renderer inventory", () => {
		for (const mode of HOST_MODES) {
			expect(MODE_COMMAND_NAMES[mode]).not.toContain("start_client");
		}
	});

	it("composes complete inventories from the mode-owned lists", () => {
		expect(HOST_COMMAND_NAMES).toHaveLength(new Set(HOST_COMMAND_NAMES).size);
		expect([...HOST_COMMAND_NAMES].sort()).toEqual(
			[
				...new Set([
					...MODE_COMMAND_NAMES.explorer,
					...MODE_COMMAND_NAMES.client,
				]),
			].sort(),
		);
		expect(HOST_EVENT_NAMES).toHaveLength(new Set(HOST_EVENT_NAMES).size);
		expect([...HOST_EVENT_NAMES].sort()).toEqual(
			[
				...new Set([...MODE_EVENT_NAMES.explorer, ...MODE_EVENT_NAMES.client]),
			].sort(),
		);
	});
});
