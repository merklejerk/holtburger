import { describe, expect, it } from "vitest";
import type { HostCommandName, HostTransport } from "../../host/host-transport";
import { HostPresentationAssets } from "./host-presentation-assets";
import { GamePresentationOwner } from "./game-presentation-owner";
import { EXPLORER_TUNING } from "../../../explorer/explorer-tuning";

const appearance = {
	paletteDid: null,
	subPalettes: [],
	textureChanges: [],
	partChanges: [],
};

function transport(commands: HostCommandName[]): HostTransport {
	return {
		invoke: async (command) => {
			commands.push(command);
			throw new Error("fixture content unavailable");
		},
		listen: async () => () => {},
	};
}

describe("HostPresentationAssets", () => {
	it("keeps app assets usable after a borrowing world owner fails startup", async () => {
		const commands: HostCommandName[] = [];
		const host = transport(commands);
		const owner = new HostPresentationAssets(host);
		const resources = await owner.resources();
		await expect(
			GamePresentationOwner.build({
				// Content fails before this test's canvas can be used to create a device.
				canvas: {} as HTMLCanvasElement,
				hostTransport: host,
				presentationResources: resources,
				frameSettings: EXPLORER_TUNING.frameSettings,
				portalWarpDriveTuning: EXPLORER_TUNING.portalTransition.visual,
				audioTuning: EXPLORER_TUNING.audio,
			}),
		).rejects.toThrow("fixture content unavailable");
		await expect(
			resources.assets.setupVisuals.acquire(0x02000001, appearance),
		).rejects.toThrow("fixture content unavailable");
		expect(commands).toEqual(["load_active_region_data", "load_setup_visual"]);
		await owner.destroy();
	});
	it("shares static preparation capabilities and closes their sources after borrowers release", async () => {
		const commands: HostCommandName[] = [];
		const owner = new HostPresentationAssets(transport(commands));
		const [first, second] = await Promise.all([
			owner.resources(),
			owner.resources(),
		]);
		expect(first.assets).toBe(second.assets);
		await expect(
			first.assets.setupVisuals.acquire(0x02000001, appearance),
		).rejects.toThrow("fixture content unavailable");
		expect(commands).toEqual(["load_setup_visual"]);
		const retirement = owner.destroy();
		expect(owner.destroy()).toBe(retirement);
		await retirement;
		await expect(
			first.setupVisualSource.load(0x02000001, appearance),
		).rejects.toThrow("Host requests are stopped");
		await expect(owner.resources()).rejects.toMatchObject({
			name: "AbortError",
		});
	});

	it("retires pending construction without publishing usable resources after closure", async () => {
		const owner = new HostPresentationAssets(transport([]));
		const pending = owner.resources();
		const rejected = expect(pending).rejects.toMatchObject({
			name: "AbortError",
		});
		await owner.destroy();
		await rejected;
	});
});
