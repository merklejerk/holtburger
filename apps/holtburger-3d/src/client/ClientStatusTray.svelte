<script lang="ts">
	import ClientHudTray from "./ClientHudTray.svelte";
	import ClientHudIcon, {
		type ClientHudIconName,
	} from "./ClientHudIcon.svelte";
	import type {
		ClientHudPlacement,
		ClientHudViewport,
	} from "./client-hud-layout";

	interface Props {
		/** Saved position and long-axis orientation of the fixed-size tray. */
		readonly placement: ClientHudPlacement;
		readonly editable: boolean;
		readonly viewport: ClientHudViewport;
		readonly onPlacementChange: (placement: ClientHudPlacement) => void;
		/** Presence of effective ordinary spells and the separately classified vitae penalty. */
		readonly kinds: { readonly beneficial: boolean; readonly harmful: boolean };
		readonly onOpenEnchantments: (kind: "beneficial" | "harmful") => void;
	}

	const {
		placement,
		editable,
		viewport,
		onPlacementChange,
		kinds,
		onOpenEnchantments,
	}: Props = $props();
	const statuses = $derived<
		readonly {
			name: ClientHudIconName;
			label: string;
			kind: "beneficial" | "harmful";
		}[]
	>([
		...(kinds.beneficial
			? [
					{
						name: "buffed" as const,
						label: "Beneficial enchantments",
						kind: "beneficial" as const,
					},
				]
			: []),
		...(kinds.harmful
			? [
					{
						name: "debuffed" as const,
						label: "Harmful enchantments",
						kind: "harmful" as const,
					},
				]
			: []),
	]);
</script>

<ClientHudTray
	label="Status tray"
	{placement}
	{editable}
	{viewport}
	{onPlacementChange}
>
	{#each statuses as status}
		<button
			type="button"
			class="status-icon ui-hud-button"
			title={status.label}
			aria-label={status.label}
			onclick={() => onOpenEnchantments(status.kind)}
		>
			<ClientHudIcon name={status.name} />
		</button>
	{/each}
</ClientHudTray>

<style>
	@layer components {
		.status-icon {
			box-sizing: border-box;
			flex: 0 0 32px;
			width: 32px;
			height: 32px;
			pointer-events: auto;
		}
	}
</style>
