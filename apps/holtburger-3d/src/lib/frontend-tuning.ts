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
		/** Cadence for listener-relative ambient weighting and live voice placement updates. */
		controlUpdateIntervalSeconds: 1 / 30,
		/**
		 * Simultaneous authored voices before one is stolen.
		 *
		 * RETAIL DIVERGENCE: double retail's DirectSound-era 16 — at 16 a dense ambience pose
		 * saturated and audibly cut 27 voices in ~14 s. Still bounded, because an unbounded voice
		 * pool turns any trigger bug into a runaway mixer instead of a diagnosable steal counter.
		 * The steal policy (quietest, not oldest) lives with its mechanism in
		 * `AudioSystem.#claimVoiceSlot`.
		 */
		maximumSimultaneousVoices: 32,
		/**
		 * `setTargetAtTime` time constant for live gain and pan updates, in seconds.
		 *
		 * Too small clicks at frame boundaries; too large smears a fast pan sweep. A listening
		 * judgement rather than a derived value — revisit by ear, not by math.
		 */
		placementSmoothingSeconds: 0.02,
		/**
		 * Exponent shaping each voice's linear gain before it reaches the device: `gain ** exponent`.
		 *
		 * RETAIL DIVERGENCE: retail plays the attenuation curve's linear gain as-is. Gains live in
		 * (0, 1], so an exponent below 1 lifts quiet-to-mid sounds while leaving silence and full
		 * volume untouched (at 0.75: 0.02 → 0.053, 0.1 → 0.18, 0.5 → 0.6, 1 → 1) — a loudness
		 * contour for distant ambience, not a mix change content can observe structurally. The
		 * audibility floor still judges unshaped retail gains, so *which* sounds play is unchanged;
		 * only how loud the quiet ones are. `1` restores retail exactly. Tune by ear.
		 */
		loudnessCurveExponent: 0.75,
		/**
		 * How late a warmed sound may still be played, in seconds.
		 *
		 * The device refuses a sound whose buffer has not decoded, so the first trigger of any sound
		 * warms it and replays once it lands. The bound is purely temporal: a footstep arriving this
		 * late belongs to a moment that has passed, however correctly it would now be placed.
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
				/** Explorer-owned numeric capabilities registered for the synthetic grounded body. */
				groundedCharacterCapabilities: {
					/** Human walk-forward motion-table speed (`acclient.c:329869`). */
					baseWalkForwardSpeed: 3.12,
					/** Human run-forward motion-table speed (`acclient.c:329873`). */
					baseRunForwardSpeed: 4,
					/** Explorer product run rate; keeps the accepted 12-unit default run speed. */
					runRateScalar: 3,
					/** Full-charge jump apex in world units, intentionally taller than retail skill 300. */
					fullChargeJumpHeight: 8.425,
				},
				/** Seconds over which held keyboard movement reaches full speed. */
				keyboardAccelerationSeconds: 2,
				/** Starting fraction of full speed for held keyboard movement. */
				keyboardInitialSpeedMultiplier: 0.125,
				/** Free-fly keyboard yaw speed before the precision modifier is applied. */
				keyboardYawRadiansPerSecond: 1.8,
				/** Human motion-table turn omega without the retail Run multiplier. */
				groundedWalkYawRadiansPerSecond: 1.5,
				/** Human motion-table turn omega after retail's fixed 1.5 Run multiplier. */
				groundedRunYawRadiansPerSecond: 2.25,
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
				/** Free-fly movement multiplier while the precision modifier is active. */
				shiftSlowMultiplier: 0.05,
				/** Largest browser wheel delta consumed by one camera event. */
				wheelDeltaClamp: 900,
				/** Local-up movement applied per normalized browser wheel unit. */
				wheelLocalUpUnitsPerDelta: -0.025,
			},
			/**
			 * Third-person boom arm used while an entity is possessed.
			 *
			 * The camera is not a physical body in this mode: these drive spherical state about the
			 * possessed entity's head, and the host only answers how far the boom may reach.
			 */
			boom: {
				/** Height above the entity's root the boom pivots about. */
				anchorHeight: 1.5,
				/** Distance a newly possessed entity is watched from. */
				defaultDistance: 4.5,
				/**
				 * Seconds for the rendered distance to ease back out once geometry clears.
				 *
				 * Pull-in has no matching constant on purpose: it is immediate, because easing
				 * inward would render frames inside a wall.
				 */
				easeOutSeconds: 0.35,
				/**
				 * Hard-coupled to the host's `FREE_SPHERE_FLY_CONFIG` budget: 0.25 m substeps over
				 * 32 substeps bounds one sweep at 8 m, and the host **refuses** a longer request
				 * rather than answering short. Raising this without raising that budget leaves the
				 * boom permanently unclamped — it would clip through geometry, reporting only a
				 * console error per frame. Change both or neither.
				 */
				maximumDistance: 8,
				/** Closest the boom may sit, so a pinned camera stops at the entity's back. */
				minimumDistance: 1.2,
				/** Sphere the host sweeps the boom with; matches the retail viewer sphere. */
				sweepRadius: 0.3,
				/** Zoom rate per normalized browser wheel unit. */
				zoomMetersPerWheelUnit: 0.01,
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
		environment: {
			/** Default day group index in Explorer (day group 0 / "Clear"). */
			defaultDayGroupOverride: 0 as number | null,
			defaultDayIndex: 0,
			defaultTimeOfDay: 0.5,
		},
		residency: {
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
		/** Immutable quality choices and initial runtime values for near-field ambient occlusion. */
		ambientOcclusion: {
			/** Modern near-field presentation divergence; users may explicitly disable it. */
			enabledByDefault: true,
			/** Linear resolution multiplier applied independently to both scratch-target axes. */
			resolutionScale: 1,
			/** World-space neighborhood radius sampled around each receiving surface. */
			sampleRadius: 2,
			/** Minimum view-space separation required before a sample can occlude. */
			bias: 0.05,
			/** Strength applied to accumulated obscurance before composition. */
			intensity: 1.5,
			/** Number of deterministic spiral taps evaluated for each eligible pixel. */
			sampleCount: 12,
			/** View-space depth separation at which bilateral neighbors stop contributing. */
			bilateralDepthThreshold: 0.75,
			/** Renderer-owned camera-distance interval over which AO becomes neutral. */
			distanceFade: { fullStrengthUntil: 64, disabledAt: 128 },
		},
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
			opacityScale: 1.0,
		},
		/** Authored sky and starfield particle presentation tuning. */
		skyParticles: {
			/**
			 * Opacity multiplier applied to sky-attached particles (stars, raindrops), in [0, 1].
			 * Set to 0 to completely disable them, or lower to keep them subtle.
			 */
			opacityScale: 0.5,
			/**
			 * Simulation speed multiplier for sky particle motion and twinkles.
			 * Set to 0 to freeze them in place, or e.g. 0.1 to slow the rotation down.
			 */
			speedMultiplier: 0.5,
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
			/** CSS-pixel cutoff for independently optional object presentations. */
			minimumObjectFootprintCssPixelArea: 64,
			/** CSS-pixel cutoff for non-near-plane recursive portal windows. */
			minimumPortalFootprintCssPixelArea: 4,
			/**
			 * Device pixels per CSS pixel.
			 *
			 * One renders at native CSS resolution, so a HiDPI display costs the same as any
			 * other. Raising it supersamples, which is where anti-aliasing comes from; the
			 * browser resolves the oversized drawing buffer when it composites the canvas.
			 */
			renderScale: 1,
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
		/**
		 * Fog coverage at which terrain switches from near composition to far vertex colors.
		 *
		 * The far pass skips surface, sampler, and point-light state while preserving authored type
		 * changes across the mesh. Lower values move the switch nearer the camera; raise it if the
		 * approximation reads badly, since its color error survives the fog blend in proportion to
		 * how much fog is left at the ring.
		 *
		 * The ring itself is derived, not configured: `farTerrainCutoffLandblocks` converts this
		 * and the frame's fog into whole landblocks, and the renderer reports where it landed as
		 * `FrameSelectionMetrics.farTerrainCutoffLandblocks`.
		 */
		farTerrainFogCoverage: 0.33,
		transparentObjects: {
			/** Radius within which transparent objects receive exact camera-depth ordering. */
			nearDistance: 16,
		},
	},
	workloads: {
		staticObjectTextureAtlas: {
			/** Atlas pages rebuilt during one incremental compaction pass. */
			maximumCompactionRebuildPages: 2,
			/** Fixed dimensions of each resident static-object texture page. */
			pageSize: 2_048,
		},
	},
} as const;
