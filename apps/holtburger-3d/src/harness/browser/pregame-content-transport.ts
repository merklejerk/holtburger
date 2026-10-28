import type {
	HostCommandName,
	HostTransport,
} from "../../lib/host/host-transport";

/** Diagnostic HTTP adapter; all scene/preview bytes still come from production content loaders. */
export function pregameContentTransport(url: string): HostTransport {
	const endpoints: Partial<Record<HostCommandName, string>> = {
		load_active_region_data: "/active-region-data",
		load_sky_source: "/sky-source",
		load_audio: "/audio",
		load_sound_table: "/sound-table",
		load_physics_script_table: "/physics-script-table",
		load_landblock_profile: "/landblock-profile",
		load_landblock_source_batch: "/landblock-source-batch",
		load_setup_visual: "/setup-visual",
		load_character_creation_catalog: "/character-creation-catalog",
		resolve_character_creation_appearance: "/character-creation-appearance",
		resolve_character_creation_stats: "/character-creation-stats",
		load_animation: "/animation",
		load_physics_script: "/physics-script",
		load_particle_emitter: "/particle-emitter",
		load_particle_meshes: "/particle-meshes",
		load_texture_pixels: "/texture-pixels",
	};
	return {
		invoke: async (command, args) => {
			const endpoint = endpoints[command];
			if (endpoint === undefined)
				throw new Error(`Unexpected static content command: ${command}`);
			const catalog = command === "load_character_creation_catalog";
			const response = await fetch(
				new URL(endpoint, url),
				catalog
					? {}
					: {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify(args?.request ?? {}),
						},
			);
			if (!response.ok) throw new Error(await response.text());
			return catalog ||
				command === "load_landblock_profile" ||
				command === "resolve_character_creation_appearance" ||
				command === "resolve_character_creation_stats"
				? response.json()
				: new Uint8Array(await response.arrayBuffer());
		},
		listen: async () => {
			throw new Error("Static content does not subscribe to authority events");
		},
	};
}
