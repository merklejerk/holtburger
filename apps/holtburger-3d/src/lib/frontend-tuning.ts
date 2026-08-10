/**
 * Frontend-owned tuning policy for Explorer interaction, presentation, and bounded background work.
 *
 * Values whose changes would alter decoded game data, renderer correctness, or API safety remain
 * beside their owning implementations instead of masquerading as product knobs here.
 */
export const FRONTEND_TUNING = {
	animationPresentation: {
		/** Visual sampling cadence for animated roots omitted by the previous rendered frame. */
		offscreenSampleIntervalSeconds: 0.1,
	},
	audio: {
		/**
		 * Simultaneous authored voices before the oldest is stolen.
		 *
		 * Retail runs 16 with priority stealing, but every hook sound carries priority 0 and loses
		 * every contest, so this is a plain budget rather than a priority queue.
		 */
		maximumSimultaneousVoices: 16,
		/**
		 * How late a warmed sound may still be played, in seconds.
		 *
		 * The device refuses a sound whose buffer has not decoded, so the first trigger of any sound
		 * warms it and replays once it lands. Beyond this the moment has passed and playing it would
		 * place a sound where the listener no longer is, since retail fixes gain and pan at trigger
		 * time and never updates them.
		 */
		maximumWarmupReplaySeconds: 0.25,
	},
	diagnostics: {
		/** Smoothing window used by the on-screen frame-time readout. */
		frameMetricsEmaWindowMs: 1_000,
		/** Largest numeric frame rate rendered by the compact frame-time readout. */
		maximumDisplayedFramesPerSecond: 1_000,
		/** GPU query frames allowed to await asynchronous device results. */
		maximumPendingGpuFrames: 4,
		/** Completed CPU frame profiles retained for delayed GPU-query reconciliation. */
		maximumRetainedCpuFrames: 60,
		/** Recent effect observations retained for Explorer diagnostics. */
		maximumRecentEffectObservations: 256,
	},
	explorer: {
		camera: {
			controls: {
				/** Seconds over which held keyboard movement reaches full speed. */
				keyboardAccelerationSeconds: 2,
				/** Starting fraction of full speed for held keyboard movement. */
				keyboardInitialSpeedMultiplier: 0.125,
				/** Keyboard yaw speed before the slow modifier is applied. */
				keyboardYawRadiansPerSecond: 1.8,
				/** Largest simulation step admitted after an animation-frame pause. */
				maximumFrameDeltaSeconds: 0.05,
				/** Vertical rotation limit, short of the camera-axis singularity. */
				maximumPitchRadians: 1.38,
				/** Full-speed keyboard translation rate in world units per second. */
				moveSpeed: 150,
				/** World-space pan distance applied per pointer pixel. */
				panUnitsPerPixel: 0.18,
				/** Vertical rotation applied per pointer pixel. */
				pointerPitchRadiansPerPixel: 0.005,
				/** Horizontal rotation applied per pointer pixel. */
				pointerYawRadiansPerPixel: 0.006,
				/** Movement multiplier while the precision modifier is active. */
				shiftSlowMultiplier: 0.05,
				/** Largest browser wheel delta consumed by one camera event. */
				wheelDeltaClamp: 900,
				/** Local-up movement applied per normalized browser wheel unit. */
				wheelLocalUpUnitsPerDelta: -0.025,
			},
			/** Projection shared by Explorer-controlled primary views. */
			framing: { fov: 60, near: 0.5, far: 2_000 },
			/** Initial orientation before automatic scene focus or manual input. */
			initialOrientation: { pitchRadians: -0.45, yawRadians: 0 },
			outdoorFocus: {
				/** Height above sampled terrain used for automatic outdoor placement. */
				clearance: 48,
				/** Horizontal offset from the focused landblock center. */
				offset: 48,
			},
		},
		lod: {
			/** Initial outdoor scene-interest radii exposed by Explorer controls. */
			defaultRadii: {
				buildingRadius: 8,
				envCellRadius: 2,
				explicitObjectRadius: 2,
				generatedObjectRadius: 2,
				terrainRadius: 8,
			},
			/** Largest outdoor scene-interest radius selectable in Explorer. */
			maximumRadius: 8,
			/** Smallest outdoor scene-interest radius selectable in Explorer. */
			minimumRadius: 0,
		},
	},
	rendering: {
		/** Fallback framebuffer color exposed when no scene presentation covers a pixel. */
		clearColor: { red: 0.15, green: 0.05, blue: 0.05, alpha: 1 },
		/** Authored weather presentation, which is ours to shape rather than inherit. */
		weather: {
			/**
			 * How much of its authored opacity an authored weather object contributes, in [0, 1].
			 *
			 * RETAIL DIVERGENCE: retail draws weather columns at their full authored opacity
			 * (`GameSky::Draw`, acclient.c:297381, with no per-object opacity policy anywhere in the
			 * sky path). We scale them down deliberately.
			 *
			 * Why departing is safe: the rain columns are `0x01004C42` and `0x01004C44` and nothing
			 * else — a census of the shipped region found exactly two weather meshes, both drawn only
			 * by the sky pass, both purely decorative. No authored content, script, or gameplay system
			 * reads their opacity, so nothing can observe the change but a viewer.
			 *
			 * Why it is wanted: both columns are viewer-pinned with an absolute height clamp
			 * (`GameSky::UpdatePosition`, acclient.c:297298), so they slide vertically past the camera
			 * whenever it changes height. Retail was tuned against a walking player; an explorer or
			 * free-fly camera moves vertically far faster than retail could, which turns an authored
			 * ambience into a distracting sweep. The motion is faithful, the input envelope is not.
			 *
			 * Set to 1 to restore retail's contribution exactly.
			 */
			opacityScale: 0.5,
		},
		frameDefaults: {
			/** Whether region-authored distance fog is enabled initially. */
			distanceFogEnabled: true,
			viewerLightEnabled: true,
			/**
			 * Authored weather. Retail defaults `LScape::weather_enabled` to true
			 * (acclient.c:44269) and only the player option turns it off, so we default it on too.
			 */
			weatherEnabled: true,
			/** Authored outdoor lamps; disabled only to measure their cost. */
			staticLightsEnabled: true,
			/** Environment-cell visibility policy selected initially. */
			envCellRenderMode: "portal",
			/** Physical-pixel cutoff for independently optional object presentations. */
			minimumObjectFootprintPixelArea: 64,
			/** Physical-pixel cutoff for non-near-plane recursive portal windows. */
			minimumPortalFootprintPixelArea: 4,
			/** Requested normalized-texture filtering before device capability resolution. */
			textureFiltering: "anisotropic-2x",
		},
		/**
		 * Authored outdoor lamps, which retail never rendered at all.
		 *
		 * Retail's outdoor pass binds only the sun, so its lamps cast nothing at any hour. We
		 * light outdoor geometry with them deliberately, which makes both the magnitude and the
		 * time-of-day half of that policy ours to define rather than inherit.
		 *
		 * One further knob lives outside this file: `EVALUATED_LIGHT_ROLL_OFF_CEILING` in
		 * `game/renderer/webgl2-lighting.ts` caps an evaluated light's peak as a fraction of its
		 * colour. Shader-facing numbers stay beside their GLSL so the shader validator can pin
		 * them as literals, which it cannot do through this nested object.
		 */
		outdoorAuthoredLights: {
			/**
			 * Applied to the authored intensity before falloff.
			 *
			 * Every lamp in the archive authors intensity 100, a value retail only ever fed to
			 * its hardware lights and its interior bake. Through the falloff we evaluate it is
			 * far too hot: unscaled it peaks around eleven times full lamp colour.
			 *
			 * Raised from the 0.17 that suited the old hard clamp. Evaluated lights now roll off
			 * smoothly and never saturate, so a scale tuned to keep the clipped plateau small
			 * reads dim instead. At 0.3 a median lamp peaks near 0.78 of its colour and decays
			 * continuously to nothing.
			 */
			intensityScale: 0.3,
			/**
			 * Up-facing terrain brightness at or below which lamps contribute in full.
			 *
			 * Measured against region-authored sky keyframes, an up-facing terrain surface sits
			 * near 0.24 at midnight and 0.90 at noon.
			 */
			fullResponseBrightness: 0.3,
			/** Up-facing terrain brightness at or above which lamps sit at `minimumResponse`. */
			minimumResponseBrightness: 0.8,
			/**
			 * Fraction of a lamp that survives full daylight.
			 *
			 * Fading to exactly zero reads as lamps switching off. A small floor keeps them
			 * faintly present instead. Daytime terrain already sits near 0.9 and the shader
			 * clamps at 1, so a floor this size reads as a subtle brightening in the pool core
			 * rather than a visible pool; raise it toward 0.3 to make lamps genuinely readable
			 * at midday, at the cost of looking lit in daylight.
			 */
			minimumResponse: 0.15,
		},
		terrainDetailFade: {
			/** World distance where terrain detail-texture fading begins. */
			near: 10,
			/** World distance where terrain detail texture becomes fully faded. */
			far: 50,
		},
		transparentObjects: {
			/** Number of coarse camera-depth bands used for near transparent objects. */
			depthBucketCount: 8,
			/** Radius within which transparent objects retain coarse depth ordering. */
			nearDistance: 16,
		},
	},
	workloads: {
		/** Outdoor grid width used to cluster generated scenery into culling groups. */
		generatedSceneryClusterGridSize: 2,
		staticObjectTextureAtlas: {
			/** Atlas pages rebuilt during one incremental compaction pass. */
			maximumCompactionRebuildPages: 2,
			/** Fixed dimensions of each resident static-object texture page. */
			pageSize: 2_048,
		},
	},
} as const;
