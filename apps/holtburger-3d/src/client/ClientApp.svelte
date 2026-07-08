<script lang="ts">
	import RouteShell from "../app/RouteShell.svelte";
	import { readEntryParams } from "../app/entry-params";

	const params = readEntryParams();
</script>

<RouteShell
	eyebrow="Client"
	title="Holtburger 3D Client"
	summary="The primary game-client surface for the fresh renderer architecture."
	{params}
/>
