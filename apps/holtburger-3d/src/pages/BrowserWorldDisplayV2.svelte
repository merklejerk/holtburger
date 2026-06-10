<script lang="ts">
	import { onMount } from "svelte";
	import { createBrowserV2Runtime } from "../v2/browser/create-browser-v2-runtime";
	import type {
		ClientRuntime,
		RuntimeSnapshot,
	} from "../v2/runtime/client-runtime";
	import type { StaticDomain } from "../v2/static/contracts";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let runtime: ClientRuntime | null = $state(null);
	let startupError = $state<string | null>(null);
	let landblockId = $state("0000");
	let terrainEnabled = $state(true);
	let buildingsEnabled = $state(false);
	let detailEnabled = $state(false);
	let envCellsEnabled = $state(false);
	let snapshot = $state<RuntimeSnapshot | null>(null);

	onMount(() => {
		if (!canvasElement) {
			startupError = "V2 canvas was not mounted.";
			return;
		}

		try {
			runtime = createBrowserV2Runtime(canvasElement);
			const unsubscribe = runtime.subscribe((nextSnapshot) => {
				snapshot = nextSnapshot;
			});
			const frameInterval = window.setInterval(() => {
				runtime?.updateFrameState({
					camera: {
						position: [0, 0, 0],
						yawRadians: 0,
						pitchRadians: 0,
					},
					timeSeconds: performance.now() / 1000,
				});
			}, 1000 / 30);

			return () => {
				window.clearInterval(frameInterval);
				unsubscribe();
				runtime?.dispose();
				runtime = null;
			};
		} catch (error) {
			startupError = error instanceof Error ? error.message : String(error);
		}
	});

	function requestStaticWork(): void {
		if (!runtime) {
			return;
		}

		runtime.requestStaticWork({
			domains: selectedDomains(),
			landblockId,
		});
	}

	function selectedDomains(): StaticDomain[] {
		const domains: StaticDomain[] = [];

		if (terrainEnabled) {
			domains.push("terrain");
		}
		if (buildingsEnabled) {
			domains.push("buildings");
		}
		if (detailEnabled) {
			domains.push("detail");
		}
		if (envCellsEnabled) {
			domains.push("envCells");
		}

		return domains;
	}
</script>

<svelte:head>
	<title>Holtburger 3D V2 Harness</title>
	<meta
		name="description"
		content="V2 frontend harness for proving runtime, renderer, and static pipeline boundaries."
	/>
</svelte:head>

<section class="browser-v2">
	<canvas bind:this={canvasElement} class="browser-v2__canvas"></canvas>

	<aside class="browser-v2__panel" aria-label="V2 runtime controls">
		<header>
			<p class="kicker">Frontend V2</p>
			<h1>Runtime Harness</h1>
		</header>

		{#if startupError}
			<p class="browser-v2__error">{startupError}</p>
		{/if}

		<label class="browser-v2__field">
			<span>Landblock</span>
			<input bind:value={landblockId} autocomplete="off" spellcheck="false" />
		</label>

		<div class="browser-v2__toggles" aria-label="Static domains">
			<label>
				<input bind:checked={terrainEnabled} type="checkbox" />
				<span>Terrain</span>
			</label>
			<label>
				<input bind:checked={buildingsEnabled} type="checkbox" />
				<span>Buildings</span>
			</label>
			<label>
				<input bind:checked={detailEnabled} type="checkbox" />
				<span>Detail</span>
			</label>
			<label>
				<input bind:checked={envCellsEnabled} type="checkbox" />
				<span>Env cells</span>
			</label>
		</div>

		<button
			class="browser-v2__request"
			disabled={!runtime || selectedDomains().length === 0}
			type="button"
			onclick={requestStaticWork}
		>
			Request Static Scope
		</button>

		<dl class="browser-v2__status">
			<div>
				<dt>Status</dt>
				<dd>{snapshot?.status ?? "starting"}</dd>
			</div>
			<div>
				<dt>Static</dt>
				<dd>
					{#if snapshot}
						r{snapshot.static.revision} req {snapshot.static.requested} res
						{snapshot.static.resolving} bake {snapshot.static.baking} commit
						{snapshot.static.committed}
					{:else}
						pending
					{/if}
				</dd>
			</div>
			<div>
				<dt>Renderer</dt>
				<dd>{snapshot?.renderer.backend ?? "none"}</dd>
			</div>
			<div>
				<dt>Canvas</dt>
				<dd>
					{snapshot
						? `${snapshot.renderer.canvasWidth}x${snapshot.renderer.canvasHeight}`
						: "pending"}
				</dd>
			</div>
			<div>
				<dt>Frames</dt>
				<dd>{snapshot?.renderer.frameCount ?? 0}</dd>
			</div>
			<div>
				<dt>Last request</dt>
				<dd>
					{#if snapshot?.lastStaticRequest}
						{snapshot.lastStaticRequest.landblockId}
						({snapshot.lastStaticRequest.domains.join(", ")})
					{:else}
						none
					{/if}
				</dd>
			</div>
		</dl>
	</aside>
</section>
