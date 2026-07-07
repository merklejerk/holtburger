<script lang="ts">
	import { createAppStatus } from "./app-status";

	const status = createAppStatus();
</script>

<main class="shell" aria-label="Holtburger 3D">
	<section class="masthead">
		<p class="eyebrow">Fresh Client Shell</p>
		<h1>Holtburger 3D</h1>
		<p>{status.summary}</p>
	</section>
</main>
