<script lang="ts">
	import type { ComponentProps } from "svelte";
	import UiTabPanel from "../../app/ui/UiTabPanel.svelte";
	import UiTabs from "../../app/ui/UiTabs.svelte";
	import type { Texture2DReadback } from "../../lib/game/renderer/webgl2/webgl2-device";
	import type { StaticObjectRuntimeDiagnostics } from "../../lib/game/runtime/game-presentation-runtime";
	import type { TexturePageId } from "../../lib/game/textures/texture-manager";
	import ExplorerFramePanel from "./ExplorerFramePanel.svelte";
	import ExplorerTexturesPanel from "./ExplorerTexturesPanel.svelte";

	type DiagnosticsTab = "frame" | "textures";

	interface Props extends Omit<
		ComponentProps<typeof ExplorerFramePanel>,
		"visible"
	> {
		readonly visible: boolean;
		readonly readStaticObjectRuntimeDiagnostics: () => StaticObjectRuntimeDiagnostics | null;
		readonly readTextureAtlasPage: (pageId: TexturePageId) => Texture2DReadback;
	}

	const {
		visible,
		readStaticObjectRuntimeDiagnostics,
		readTextureAtlasPage,
		...frameProps
	}: Props = $props();
	let activeTab = $state<DiagnosticsTab>("frame");

	const tabs = [
		{
			value: "frame" as const,
			label: "Frame Info",
			id: "explorer-frame-tab",
			panelId: "explorer-frame-panel",
		},
		{
			value: "textures" as const,
			label: "Textures",
			id: "explorer-textures-tab",
			panelId: "explorer-textures-panel",
		},
	] as const;
</script>

<div class="explorer-diagnostics-window ui-tabbed-panel ui-body">
	<UiTabs
		{tabs}
		selected={activeTab}
		label="Diagnostics sections"
		onSelect={(value) => (activeTab = value)}
	/>
	<UiTabPanel
		id="explorer-frame-panel"
		labelledBy="explorer-frame-tab"
		active={activeTab === "frame"}
	>
		<ExplorerFramePanel
			visible={visible && activeTab === "frame"}
			{...frameProps}
		/>
	</UiTabPanel>
	<UiTabPanel
		id="explorer-textures-panel"
		labelledBy="explorer-textures-tab"
		active={activeTab === "textures"}
	>
		<ExplorerTexturesPanel
			visible={visible && activeTab === "textures"}
			readDiagnostics={readStaticObjectRuntimeDiagnostics}
			{readTextureAtlasPage}
		/>
	</UiTabPanel>
</div>

<style>
	@layer components {
		.explorer-diagnostics-window {
			height: 100%;
			min-height: 0;
		}
	}
</style>
