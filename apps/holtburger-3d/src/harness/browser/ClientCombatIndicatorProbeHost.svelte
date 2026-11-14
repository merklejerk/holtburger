<script lang="ts">
	import ClientCombatTargetIndicator from "../../client/ClientCombatTargetIndicator.svelte";
	import type { ClientCombatTargetFrame } from "../../client/client-target-indicator";

	let {
		readFrame,
	}: { readonly readFrame: () => ClientCombatTargetFrame | null } = $props();
	let active = $state(false);

	export function setActive(value: boolean): void {
		active = value;
	}
</script>

<ClientCombatTargetIndicator {readFrame} {active} />
