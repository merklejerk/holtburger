<script lang="ts">
	import type { SpellReference } from "../app/spell-references";
	import type { ClientSpellServices } from "./client-spells";
	import ClientInspectionArtwork, {
		type InspectionArtwork,
	} from "./ClientInspectionArtwork.svelte";
	import ClientSpellDetails from "./ClientSpellDetails.svelte";
	const {
		spells,
		reference,
	}: {
		/** Character-bound spell services and shared icon repository. */
		readonly spells: ClientSpellServices;
		/** Static definition resolved for this keyed inspector subject. */
		readonly reference: SpellReference;
	} = $props();
	const name = $derived(
		reference.kind === "known" ? reference.name : `Spell ${reference.id}`,
	);
	const artwork = $derived<InspectionArtwork>(
		reference.kind === "known"
			? reference.artwork
			: {
					kind: "failed",
					detail:
						reference.kind === "missing"
							? "Spell definition is missing."
							: reference.detail,
				},
	);
</script>

<article class="inspection-body inspection-spell">
	<header class="inspection-hero">
		<ClientInspectionArtwork {artwork} icons={spells.icons} {name} />
		<div>
			<h2 class="inspection-name">{name}</h2>
			<p class="inspection-kicker">Spell</p>
		</div>
	</header>
	<ClientSpellDetails
		{spells}
		spellId={reference.id}
		details={reference.kind === "known" ? reference.details : null}
		visible={true}
	/>
</article>
