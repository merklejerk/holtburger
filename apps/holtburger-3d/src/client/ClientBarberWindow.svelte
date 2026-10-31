<script lang="ts">
	import { onMount, untrack } from "svelte";
	import ClientHudWindow from "./ClientHudWindow.svelte";
	import UiOrdinalRange from "../app/UiOrdinalRange.svelte";
	import BodyAppearanceColors from "./BodyAppearanceColors.svelte";
	import type { BarberChoices } from "./client-barber-contract";
	import type { ClientBarberState } from "./client-barber-state";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";
	import { CLIENT_UI_DEFAULTS } from "./client-ui-defaults";

	interface Props {
		readonly model: ClientBarberState;
		readonly placement: ClientHudPlacement;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
	}
	const { model, placement, viewport, onPlacementChange }: Props = $props();
	let view = $state(untrack(() => model.read()));
	onMount(() =>
		model.subscribe(() => {
			view = model.read();
		}),
	);
	const styles = [
		{ field: "hairStyle", count: "hair", label: "Hair / body style" },
		{ field: "eyes", count: "eyes", label: "Eyes" },
		{ field: "nose", count: "noses", label: "Nose" },
		{ field: "mouth", count: "mouths", label: "Mouth" },
	] as const;
	function changeBody(field: keyof BarberChoices["body"], value: number): void {
		if (view.choices !== null)
			model.change({
				...view.choices,
				body: { ...view.choices.body, [field]: value },
			});
	}
	function changeRacial(checked: boolean): void {
		const choices = view.choices;
		if (choices === null) return;
		const racial = choices.racial;
		switch (racial.kind) {
			case "standard":
				return;
			case "empyrean":
				model.change({
					...choices,
					racial: { ...racial, earthbound: checked },
				});
				return;
			case "undead":
				model.change({ ...choices, racial: { ...racial, flames: checked } });
				return;
			case "umbraen":
			case "penumbraen":
				model.change({ ...choices, racial: { ...racial, crown: checked } });
				return;
		}
	}
	function color(rgb: readonly number[]): string {
		return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
	}
</script>

<ClientHudWindow
	title="Barbershop"
	icon="examine"
	resizable={false}
	fitContentHeight={true}
	visible={view.interaction !== null}
	{placement}
	{viewport}
	{onPlacementChange}
	minWidth={CLIENT_UI_DEFAULTS.barber.minSize.width}
	minHeight={CLIENT_UI_DEFAULTS.barber.minSize.height}
	onClose={() => model.cancel()}
>
	<div class="barber-panel ui-body" aria-busy={view.pending}>
		{#if view.interaction?.phase.kind === "loading"}<p>Loading appearance…</p>
		{:else if view.interaction?.phase.kind === "unavailable"}<p role="alert">
				{view.interaction.phase.message}
			</p>
		{:else if view.interaction?.phase.kind === "editing" && view.choices !== null}
			{@const catalog = view.interaction.phase.catalog}
			{@const choices = view.choices}
			<small class="ui-muted">Equipment hidden while editing.</small>
			<fieldset class="ui-fieldset" disabled={!view.canEdit}>
				<legend class="sr-only">Body and appearance</legend>
				{#if catalog.styles.kind === "editable"}
					{#each styles as control}
						{@const count = catalog.styles[control.count]}
						{#if count > 1}<div class="barber-style">
								<span id={`barber-appearance-${control.field}`}
									>{control.label}</span
								>
								<UiOrdinalRange
									label={control.label}
									labelledBy={`barber-appearance-${control.field}`}
									value={choices.body[control.field]}
									{count}
									disabled={!view.canEdit}
									onchange={(value) => changeBody(control.field, value)}
								/>
							</div>{/if}
					{/each}
				{:else}<p class="ui-muted">
						Body and face styles cannot be changed for this heritage.
					</p>{/if}
				<BodyAppearanceColors
					value={choices.body}
					skinColors={catalog.skinColors.map(color)}
					hairColors={catalog.hairColors.map((shades) => shades.map(color))}
					eyeColors={catalog.eyeColors.map(color)}
					visible={true}
					disabled={!view.canEdit}
					onchange={changeBody}
				/>
				{#if choices.racial.kind !== "standard"}
					<label class="ui-checkbox"
						><input
							type="checkbox"
							checked={choices.racial.kind === "empyrean"
								? choices.racial.earthbound
								: choices.racial.kind === "undead"
									? choices.racial.flames
									: choices.racial.crown}
							onchange={(event) => changeRacial(event.currentTarget.checked)}
						/>{choices.racial.kind === "empyrean"
							? "Earthbound"
							: choices.racial.kind === "undead"
								? "Flames"
								: "Crown"}</label
					>
				{/if}
				{#if choices.racial.kind === "empyrean"}<p class="ui-muted">
						Earthbound movement takes effect after Apply.
					</p>{/if}
			</fieldset>
		{/if}
		{#if view.problem !== null}<p role="alert">{view.problem}</p>{/if}
		<div class="barber-actions">
			<button
				type="button"
				class="ui-button"
				disabled={!view.canApply}
				onclick={() => model.apply()}
				>{view.interaction?.phase.kind === "sending"
					? "Submitting…"
					: "Apply"}</button
			><button
				type="button"
				class="ui-button"
				disabled={view.interaction?.phase.kind === "sending"}
				onclick={() => model.cancel()}>Cancel</button
			>
		</div>
	</div>
</ClientHudWindow>

<style>
	@layer components {
		.barber-panel {
			--body-colors-columns: 2;
			display: grid;
			gap: 8px;
			overflow: auto;
		}
		fieldset {
			display: grid;
			gap: 8px;
		}
		.barber-actions {
			display: flex;
			gap: 8px;
			justify-content: flex-end;
		}
		.barber-style {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
			align-items: center;
			gap: 8px;
		}
	}
</style>
