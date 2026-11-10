import { mount, tick, unmount } from "svelte";
import type { MinimapFrame } from "../../app/minimap-frame";
import ClientWorldPanel from "../../client/ClientWorldPanel.svelte";
import type { ClientContractsState } from "../../client/client-contracts-state";
import { emptyHousing } from "../../client/client-housing-contract";
import type { WorldMapOwner } from "../../lib/game/world-map/owner";
import { createWorldMapFixture } from "./world-map-fixture";

/** Exercise actual SVG bindings, overlay cleanup, and late map delivery across remounts. */
export async function probeWorldMapLifetime(
	context: Map<unknown, unknown>,
	contracts: ClientContractsState,
	readFrame: () => MinimapFrame,
) {
	const target = document.createElement("div");
	target.style.cssText = "position:fixed;width:500px;height:500px";
	document.body.append(target);
	try {
		for (let attempt = 0; attempt < 2; attempt++) {
			let frameReads = 0;
			const fixture = createWorldMapFixture();
			fixture.holdPreparation();
			const panel = mount(ClientWorldPanel, {
				target,
				context,
				props: {
					contracts,
					characterGuid: 1,
					housing: emptyHousing(),
					housingManagement: null,
					onRefreshHousing: async () => {},
					onSearchHousing: async () => {},
					source: fixture.source,
					canTeleportFromMap: false,
					onSetWaypoint: () => {},
					recallDestinations: [],
					onRecall: async () => {},
					onTeleportToMapPosition: async () => {},
					visible: true,
					readFrame: () => {
						frameReads++;
						return readFrame();
					},
				},
			});
			let owner: WorldMapOwner;
			try {
				await tick();
				const mountedOwner = panel.readOwner();
				if (mountedOwner === null) throw new Error("Map owner did not mount.");
				owner = mountedOwner;
				await owner.drawSettled();
				if (owner.read().kind !== "streaming")
					throw new Error("Map fixture did not retain pending tile delivery.");
				if (frameReads === 0)
					throw new Error("Map overlays did not draw.");
			} finally {
				try {
					await unmount(panel);
				} finally {
					fixture.releasePreparation();
				}
			}
			if (owner.read().kind !== "disposed")
				throw new Error("Unmount retained the map owner.");
			const readsAtUnmount = frameReads;
			await new Promise((resolve) => setTimeout(resolve, 100));
			if (frameReads !== readsAtUnmount)
				throw new Error("Map polling survived unmount.");
		}
		return { remounts: 2, disposed: true, stoppedPolling: true };
	} finally {
		target.remove();
	}
}
