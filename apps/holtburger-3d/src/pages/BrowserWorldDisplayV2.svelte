<script lang="ts">
	import { onMount } from "svelte";
	import { createBrowserV2Runtime } from "../v2/browser/create-browser-v2-runtime";
	import {
		createStaticWorkCommandFromLocation,
		inferV2LandblockInputMode,
		isV2LandblockPrefixInput,
		parseV2LocationInput,
		type V2LandblockInputMode,
	} from "../v2/browser/location-input";
	import type {
		ClientRuntime,
		ManualStaticDomain,
		RuntimeSnapshot,
	} from "../v2/runtime/client-runtime";

	let canvasElement: HTMLCanvasElement | null = $state(null);
	let runtime: ClientRuntime | null = $state(null);
	let startupError = $state<string | null>(null);
	let locationInput = $state("0000");
	let landblockInputMode = $state<V2LandblockInputMode>("outdoor");
	let terrainEnabled = $state(true);
	let buildingsEnabled = $state(false);
	let detailEnabled = $state(false);
	let topologyEnabled = $state(false);
	let snapshot = $state<RuntimeSnapshot | null>(null);
	const parsedLocation = $derived(
		parseV2LocationInput(locationInput, landblockInputMode),
	);
	const parsedIsInterior = $derived(parsedLocation?.kind === "interior-cell");
	const canToggleLandblockMode = $derived(isV2LandblockPrefixInput(locationInput));

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
		if (!runtime || !parsedLocation) {
			return;
		}

		runtime.requestStaticWork(
			createStaticWorkCommandFromLocation(parsedLocation, selectedDomains()),
		);
	}

	function handleLocationInput(event: Event): void {
		const input = event.currentTarget as HTMLInputElement;
		locationInput = input.value;
		landblockInputMode = inferV2LandblockInputMode(
			locationInput,
			landblockInputMode,
		);
	}

	function toggleLandblockInputMode(): void {
		if (!canToggleLandblockMode) {
			return;
		}

		landblockInputMode =
			landblockInputMode === "dungeon" ? "outdoor" : "dungeon";
	}

	function canRequestStaticWork(): boolean {
		if (!runtime || !parsedLocation) {
			return false;
		}

		return parsedLocation.kind === "interior-cell" || selectedDomains().length > 0;
	}

	function selectedDomains(): ManualStaticDomain[] {
		const domains: ManualStaticDomain[] = [];

		if (terrainEnabled) {
			domains.push("terrain");
		}
		if (buildingsEnabled) {
			domains.push("buildings");
		}
		if (detailEnabled) {
			domains.push("detail");
		}
		if (topologyEnabled) {
			domains.push("topology");
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
			<span>Location</span>
			<input
				autocomplete="off"
				placeholder="33.50S, 72.80E, 0xda55, or 0xda550123"
				spellcheck="false"
				value={locationInput}
				oninput={handleLocationInput}
			/>
		</label>

		<div class="browser-v2__toggles" aria-label="Landblock focus mode">
			<label>
				<input
					checked={landblockInputMode === "outdoor"}
					disabled={!canToggleLandblockMode}
					name="browser-v2-landblock-mode"
					type="radio"
					onchange={() => {
						landblockInputMode = "outdoor";
					}}
				/>
				<span>Outdoor</span>
			</label>
			<label>
				<input
					checked={landblockInputMode === "dungeon"}
					disabled={!canToggleLandblockMode}
					name="browser-v2-landblock-mode"
					type="radio"
					onchange={() => {
						landblockInputMode = "dungeon";
					}}
				/>
				<span>Dungeon</span>
			</label>
			<button
				disabled={!canToggleLandblockMode}
				type="button"
				onclick={toggleLandblockInputMode}
			>
				Toggle
			</button>
		</div>

		<div class="browser-v2__toggles" aria-label="Static domains">
			<label>
				<input bind:checked={terrainEnabled} disabled={parsedIsInterior} type="checkbox" />
				<span>Terrain</span>
			</label>
			<label>
				<input
					bind:checked={buildingsEnabled}
					disabled={parsedIsInterior}
					type="checkbox"
				/>
				<span>Buildings</span>
			</label>
			<label>
				<input bind:checked={detailEnabled} disabled={parsedIsInterior} type="checkbox" />
				<span>Detail</span>
			</label>
			<label>
				<input bind:checked={topologyEnabled} disabled={parsedIsInterior} type="checkbox" />
				<span>Topology</span>
			</label>
		</div>

		<button
			class="browser-v2__request"
			disabled={!canRequestStaticWork()}
			type="button"
			onclick={requestStaticWork}
		>
			Request Static Scope
		</button>

		<dl class="browser-v2__status">
			<div>
				<dt>Parsed</dt>
				<dd>{parsedLocation?.label ?? "invalid"}</dd>
			</div>
			<div>
				<dt>Mode</dt>
				<dd>
					{parsedLocation?.kind === "interior-cell"
						? "interior cell"
						: parsedLocation?.kind === "outdoor-landblock"
							? "outdoor landblock"
							: "unknown"}
				</dd>
			</div>
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
				<dt>Terrain payload</dt>
				<dd>
					{#if snapshot?.static.latestTerrainPayload}
						lb {snapshot.static.latestTerrainPayload.landblockId
							.toString(16)
							.padStart(8, "0")} region
						{snapshot.static.latestTerrainPayload.regionNumber} mesh
						{snapshot.static.latestTerrainPayload.vertexCount}v/{snapshot.static
							.latestTerrainPayload.triangleCount}t tex
						{snapshot.static.latestTerrainPayload.textureUseCount} missing
						{snapshot.static.latestTerrainPayload.missingRefCount}
					{:else}
						none
					{/if}
				</dd>
			</div>
			<div>
				<dt>Resolver failure</dt>
				<dd>{snapshot?.static.latestResolverFailure?.message ?? "none"}</dd>
			</div>
			<div>
				<dt>Topology payload</dt>
				<dd>
					{#if snapshot?.static.latestLandblockTopologyPayload}
						lb {snapshot.static.latestLandblockTopologyPayload.landblockId
							.toString(16)
							.padStart(8, "0")}
						{snapshot.static.latestLandblockTopologyPayload.classification} cells
						{snapshot.static.latestLandblockTopologyPayload.envCellCount} visible
						{snapshot.static.latestLandblockTopologyPayload.visibleCellCount} links
						{snapshot.static.latestLandblockTopologyPayload.portalLinkCount} missing
						{snapshot.static.latestLandblockTopologyPayload.missingRefCount}
					{:else}
						none
					{/if}
				</dd>
			</div>
			<div>
				<dt>Dungeon payload</dt>
				<dd>
					{#if snapshot?.static.latestDungeonPayload}
						lb {snapshot.static.latestDungeonPayload.landblockId
							.toString(16)
							.padStart(8, "0")} cells
						{snapshot.static.latestDungeonPayload.envCellCount} visible
						{snapshot.static.latestDungeonPayload.visibleCellCount} portals
						{snapshot.static.latestDungeonPayload.portalCount} missing
						{snapshot.static.latestDungeonPayload.missingRefCount}
					{:else}
						none
					{/if}
				</dd>
			</div>
			<div>
				<dt>Host</dt>
				<dd>{snapshot?.host.isAvailable ? "tauri" : "unavailable"}</dd>
			</div>
			<div>
				<dt>Assets</dt>
				<dd>
					{#if snapshot}
						p{snapshot.assets.pending.length} c{snapshot.assets.committed.length} f{snapshot.assets.failures.length}
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
						{#if snapshot.lastStaticRequest.envCellId}
							/ {snapshot.lastStaticRequest.envCellId}
						{/if}
						({snapshot.lastStaticRequest.domains.join(", ")})
					{:else}
						none
					{/if}
				</dd>
			</div>
		</dl>
	</aside>
</section>
