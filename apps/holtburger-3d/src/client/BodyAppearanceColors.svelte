<script lang="ts">
	import UiPaletteDropdown from "../app/UiPaletteDropdown.svelte";
	import type { BodyAppearanceChoices } from "./client-body-appearance-contract";
	import { appearanceShadeIndex } from "./client-body-appearance";

	interface Props {
		readonly value: BodyAppearanceChoices;
		readonly skinColors: readonly string[];
		readonly hairColors: readonly (readonly string[])[];
		readonly eyeColors: readonly string[];
		readonly visible: boolean;
		readonly disabled: boolean;
		readonly onchange: (
			field: "skinHue" | "hairColor" | "hairHue" | "eyeColor",
			value: number,
		) => void;
	}
	const {
		value,
		skinColors,
		hairColors,
		eyeColors,
		visible,
		disabled,
		onchange,
	}: Props = $props();
	const shades = $derived.by(() => {
		if (hairColors.length === 0) return null;
		const colors = hairColors[value.hairColor];
		if (colors === undefined)
			throw new Error(
				"Selected hair color is outside the authored palette catalog.",
			);
		return colors;
	});
</script>

<div class="body-colors">
	<div class="body-color">
		<span>Skin color</span><UiPaletteDropdown
			label="Skin color"
			colors={skinColors}
			value={appearanceShadeIndex(value.skinHue, skinColors.length)}
			{visible}
			{disabled}
			onchange={(index) =>
				onchange("skinHue", (index + 0.5) / skinColors.length)}
		/>
	</div>
	{#if shades !== null}
		<div class="body-color">
			<span>Hair color</span><UiPaletteDropdown
				label="Hair color"
				colors={hairColors.map(
					(colors) =>
						colors[appearanceShadeIndex(value.hairHue, colors.length)],
				)}
				value={value.hairColor}
				{visible}
				{disabled}
				onchange={(index) => onchange("hairColor", index)}
			/>
		</div>
		<div class="body-color">
			<span>Hair shade</span><UiPaletteDropdown
				label="Hair shade"
				colors={shades}
				value={appearanceShadeIndex(value.hairHue, shades.length)}
				{visible}
				{disabled}
				onchange={(index) => onchange("hairHue", (index + 0.5) / shades.length)}
			/>
		</div>
	{/if}
	{#if eyeColors.length > 0}
		<div class="body-color">
			<span>Eye color</span><UiPaletteDropdown
				label="Eye color"
				colors={eyeColors}
				value={value.eyeColor}
				{visible}
				{disabled}
				onchange={(index) => onchange("eyeColor", index)}
			/>
		</div>
	{/if}
</div>

<style>
	@layer components {
		.body-colors {
			display: grid;
			/* The containing panel owns column layout; creation retains one column. */
			grid-template-columns: repeat(
				var(--body-colors-columns, 1),
				minmax(0, 1fr)
			);
			gap: 8px;
		}
		.body-color {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
		}
	}
</style>
