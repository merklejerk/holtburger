<script lang="ts">
	import { onMount, tick } from "svelte";
	import {
		measureContainerOpeningWidth,
		measureContainerOpeningHeight,
	} from "./client-world-container-size";
	import { startUiIconDisplay } from "../app/ui-icon-display";
	import type { UiIconDisplay } from "../app/ui-icon-repository";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import ClientWorldContainerPanel from "./ClientWorldContainerPanel.svelte";
	import { CLIENT_TUNING } from "./client-tuning";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import type { ClientItemInteractions } from "./client-item-interactions";
	import type {
		ClientWorldContainerPanelState,
		ClientWorldContainerView,
	} from "./client-world-container-panel-state";
	interface Props {
		readonly model: ClientWorldContainerPanelState;
		readonly interactions: ClientItemInteractions;
		readonly selectedGuid: number | null;
		readonly onSelectItem: (guid: number) => void;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}
	const {
		model,
		interactions,
		selectedGuid,
		onSelectItem,
		placement,
		viewport,
		onPlacementChange,
	}: Props = $props();
	/** Only the bounded display sampler writes these markup inputs. */
	let view = $state<ClientWorldContainerView | null>(null);
	let displays = $state<ReadonlyMap<string, UiIconDisplay>>(new Map());
	let refresh: (() => void) | null = null;
	/** Cold opening identity; hidden measurement never changes an already-visible window. */
	let opening = $state<symbol | null>(null);
	let minimum = $state({ ...CLIENT_UI_DEFAULTS.worldContainer.minSize });
	let surface = $state<HTMLDivElement | null>(null);
	async function sizeOpening(
		identity: symbol,
		itemCount: number,
	): Promise<void> {
		await tick();
		if (opening !== identity) return;
		const frame = surface;
		if (frame === null)
			throw new Error(
				"Opening container did not mount its measurement surface",
			);
		const width = measureContainerOpeningWidth(frame, itemCount);
		minimum = { ...minimum, width: width.minimum };
		onPlacementChange({ ...placement, preferredWidth: width.preferred });
		await tick();
		if (opening !== identity) return;
		const height = measureContainerOpeningHeight(frame);
		minimum = { ...minimum, height: height.minimum };
		onPlacementChange({ ...placement, preferredHeight: height.preferred });
		await tick();
		if (opening === identity) opening = null;
	}

	onMount(() => {
		const display = startUiIconDisplay({
			repository: model.icons,
			intervalMs: CLIENT_TUNING.worldContainer.displayIntervalMs,
			read: () => model.read(),
			keys: (next) => next?.iconKeys.values() ?? [],
			publish: (next, images) => {
				const opens = next !== null && next.root.guid !== view?.root.guid;
				view = next;
				displays = images;
				if (next === null) opening = null;
				else if (opens) {
					const identity = Symbol("container opening");
					opening = identity;
					const itemCount = next.sections.reduce(
						(count, section) =>
							count +
							section.items.length +
							section.packs.length +
							section.unslotted.length,
						0,
					);
					void sizeOpening(identity, itemCount);
				}
			},
		});
		refresh = display.refresh;
		return () => {
			opening = null;
			refresh = null;
			display.destroy();
		};
	});
</script>

{#if view !== null}
	{@const current = view}
	<div
		class="world-container-window"
		bind:this={surface}
		style:visibility={opening === null ? "visible" : "hidden"}
		inert={opening !== null}
	>
		<span class="container-cell-measure" aria-hidden="true"></span>
		<ClientHudWindow
			icon="inventory"
			title={current.root.description.kind === "known"
				? current.root.description.name
				: "Container"}
			{placement}
			{viewport}
			{onPlacementChange}
			minWidth={minimum.width}
			minHeight={minimum.height}
			onClose={() => model.close(current.root.guid)}
		>
			{#key current.root.guid}
				<ClientWorldContainerPanel
					{model}
					view={current}
					{displays}
					{interactions}
					{selectedGuid}
					{onSelectItem}
					onSort={() => {
						model.cycleSort();
						refresh?.();
					}}
				/>
			{/key}
		</ClientHudWindow>
	</div>
{/if}

<style>
	@layer components {
		.world-container-window {
			display: contents;
		}
		.container-cell-measure {
			position: absolute;
			visibility: hidden;
			pointer-events: none;
			width: var(--ui-item-cell-min-size);
		}
		.world-container-window :global(.contents-scroll) {
			scrollbar-gutter: stable;
		}
	}
</style>
