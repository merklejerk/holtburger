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
		/** UI publication cadence for a frame rate sampled imperatively by the render loop. */
		frameRateDisplayIntervalMs: 250,
		/** Largest numeric frame rate rendered by the compact frame-time readout. */
		maximumDisplayedFramesPerSecond: 1_000,
		/** GPU query frames allowed to await asynchronous device results. */
		maximumPendingGpuFrames: 4,
		/**
		 * Recent CPU frame profiles retained only so the profile's percentile has samples to rank.
		 *
		 * The mean does not use this: it accumulates since the last profile reset, because a fixed
		 * frame count spans a different amount of wall time at every frame rate.
		 */
		percentileCpuFrameTail: 60,
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
				/** Free-fly keyboard yaw speed before the precision modifier is applied. */
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
				/** Free-fly movement multiplier while the precision modifier is active. */
				shiftSlowMultiplier: 0.05,
				/** Largest browser wheel delta consumed by one camera event. */
				wheelDeltaClamp: 900,
				/** Local-up movement applied per normalized browser wheel unit. */
				wheelLocalUpUnitsPerDelta: -0.025,
			},
			/** Explorer gesture and initial-framing choices sent to the host-owned boom. */
			boom: {
				/** Interdependent operator reach bounds, validated and enforced by the host. */
				distance: {
					initial: 4.5,
					maximum: 32,
					minimum: 1.2,
				},
				/** Continuous translation before the possession camera returns behind the entity. */
				recenterDelayMs: 1_000,
				/** Desired rear-facing transition duration; zero would produce an instantaneous snap. */
				recenterDurationMs: 200,
				/** Multiplier from the normalized free-camera wheel distance to boom zoom distance. */
				zoomDistanceMultiplier: 0.25,
			},
			/** Projection shared by Explorer-controlled primary views. */
			framing: { fov: 75, near: 0.1, far: 2_000 },
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
	map: {
		/**
		 * Overhead-map presentation. Shared by the Explorer and the future client shell, so this
		 * sits beside `rendering` rather than inside `explorer`.
		 *
		 * Colours are authored channel-wise here and converted to GPU-ready buffers once in
		 * `game/map/map-appearance.ts`, which holds the conversion and no values of its own.
		 * Retail constants the map obeys are deliberately absent: the walkable-slope threshold
		 * lives in `game/walkability.ts` because it is a fact about the ground, not a preference.
		 */
		hillshade: {
			/**
			 * Direction toward the relief light, in scene axes (+x east, +y up, -z north).
			 *
			 * Fixed in the world rather than on screen, lit from the north-west at roughly 45
			 * degrees, which is the conventional cartographic relief angle.
			 */
			sunDirection: { x: -0.5774, y: 0.5774, z: -0.5774 },
			/** Fraction of terrain colour surviving where the relief light does not reach. */
			ambientLevel: 0.35,
			/**
			 * Vertical exaggeration applied to slope before shading, and to shading only.
			 *
			 * Relief maps have exaggerated their verticals since long before computers: Holtburg's
			 * surroundings span about 52 m of height across more than a kilometre, and true-scale
			 * shading of that reads as a flat wash. Explicitly not applied to the walkable-slope
			 * test, which must stay a fact about the real ground.
			 */
			reliefExaggeration: 4,
		},
		colors: {
			/** Background where no geometry is drawn, and the colour distant floors fade into. */
			void: { red: 0.05, green: 0.05, blue: 0.07 },
			/** Building footprints on the outdoor map. */
			blocker: { red: 0.13, green: 0.12, blue: 0.15 },
			/**
			 * Outline drawn around building footprints, and its width in pixels.
			 *
			 * A near-black footprint reads as a solid mass on pale ground and disappears entirely on
			 * dark ground, which is most of the map at dusk or under trees. The stroke is what makes
			 * the shape survive either background. Width is in pixels rather than metres, like the
			 * slope hatching, so a building stays outlined at every zoom instead of the outline
			 * thinning away as the map pulls back.
			 */
			blockerStroke: { red: 0.83, green: 0.8, blue: 0.72 },
			blockerStrokePixels: 1.5,
			/** Roads, and how strongly authored road cells are tinted toward it. */
			road: { red: 0.85, green: 0.76, blue: 0.55 },
			roadTintStrength: 0.85,
			/**
			 * Dark rim drawn just outside the road fill, in pixels, and how much ink it carries.
			 *
			 * The same device the building footprints use, in the opposite polarity: they are a dark
			 * mass needing a light stroke, a road is a light ribbon needing a dark one. Without it a
			 * tan road crossing tan ground vanishes exactly where a reader needs it — inside a
			 * settlement, where the ground is packed dirt the same colour as the road. Width is in
			 * pixels, like the hatch period and the footprint stroke, so a road stays cased at every
			 * zoom. Strength short of one keeps it a rim rather than a hard black outline.
			 */
			roadCasingPixels: 1.5,
			roadCasingStrength: 0.55,
			/**
			 * Ground retail will not let a body onto: hatched, not merely tinted.
			 *
			 * Two unrelated rules land here, because the reader is asking one question. Ground too
			 * steep to stand on is one; an entirely-water landblock is the other, and retail
			 * refuses entry to those whole — which is why an ocean hatches while a pond does not.
			 *
			 * Hue is already carrying terrain type, roads, and the interior height ramp, so
			 * impassability gets the free channel — pattern. Diagonal hatching is the cartographic
			 * convention for a cliff, it survives colour blindness by construction, and it reads as
			 * *impassable* where another dark tint would read as shadow. The stripes carry it
			 * alone: ground between them is left exactly as it is, because a wash underneath only
			 * darkened the ground without saying anything the stripes had not already said.
			 */
			impassable: { red: 0.9, green: 0.3, blue: 0.3 },
			/** Screen-space period of the hatch stripes, in pixels, and how opaque they are. */
			impassableHatchPeriodPixels: 7,
			impassableHatchStrength: 0.25,
			/**
			 * Contour lines, which carry the elevation that hillshade cannot.
			 *
			 * Hillshade shows the shape of the ground but says nothing about how high it is, and a
			 * gentle rise and a cliff can shade alike once relief is exaggerated. Contours restore
			 * the quantity: their spacing reads as steepness and their count reads as height
			 * climbed. Also hue-independent, so they compose with the palette rather than competing
			 * with it. Lines take their colour from the shared height ramp, so a contour says both
			 * how high the ground is and whether it stands above or below you — the question the
			 * interior floors answer, asked outdoors.
			 */
			/** Vertical distance between contour lines, in metres. */
			contourIntervalMeters: 10,
			contourStrength: 0.35,
			/**
			 * Height a pixel of ground must span before a contour is drawn on it, in metres.
			 *
			 * A contour marks where the ground *crosses* a height, so it needs the ground to be
			 * going somewhere. A flat face sitting exactly on a multiple of the interval is a level
			 * set with area rather than a curve, and without this the whole face floods with line
			 * colour. That is the common case, not a corner case: AC's terrain heights are
			 * quantised, so entire landblocks and shelves sit on exact multiples — Holtburg's
			 * ground is flat at 20 m, which is two intervals exactly.
			 *
			 * Not a delicate number. Flooded faces span exactly zero and ordinary ground spans
			 * roughly 5 mm per pixel, so anything small separates two populations that do not
			 * overlap. Raising it far enough to matter would start dropping contours from genuinely
			 * gentle ground.
			 */
			contourMinimumClimbPerPixelMeters: 0.001,
			/**
			 * Height over which a contour reaches its full above or below colour, in metres.
			 *
			 * Far larger than the interior spans, because a hillside is not a storey: at interior
			 * scale every line in a landscape would saturate and the ramp would read as two flat
			 * colours rather than as a gradient.
			 */
			contourHeightSpanMeters: 30,
			/** Doorways between inside and outside, marked in both map modes. */
			transitionAccent: { red: 0.95, green: 0.83, blue: 0.35 },
		},
		heightRamp: {
			/**
			 * The three-stop height ramp: below the anchor, at its level, above it.
			 *
			 * Shared by interior floors and outdoor contour lines, so the map means one thing by
			 * "above" and "below" wherever the reader is. Only the spans differ, because the domains
			 * do: a dungeon storey is a few metres, a hillside tens of them.
			 *
			 * Colour blindness is carried by lightness as much as hue, deliberately. Green and blue
			 * separate for the common red-green deficiencies, but a deuteranope sees green
			 * desaturated toward neutral — close to the neutral centre — and a tritanope confuses
			 * blue with green outright.
			 *
			 * **The invariant when retuning: keep the ramp monotonic in lightness.** Which end is
			 * the brighter one is a taste call, but the three must stay ordered, because that is the
			 * redundant channel a reader who resolves no hue at all is left with. Collapsing two of
			 * them to similar luminance costs that silently, and nothing will fail to warn you.
			 */
			sameLevelColor: { red: 0.9, green: 0.9, blue: 0.9 },
			aboveColor: { red: 0.29, green: 0.45, blue: 0.51 },
			belowColor: { red: 0.99, green: 0.55, blue: 0.27 },
		},
		interior: {
			/**
			 * Height within which a floor still counts as the anchor's own level, in metres.
			 *
			 * You stand *on* a floor rather than at its height: an eye sits a couple of metres above
			 * its own ground, and a free camera higher still. Without this band the floor underfoot
			 * reads as below, which is both wrong and the most common case. Sized under an AC storey
			 * so a genuine floor above or below never falls inside it.
			 */
			sameLevelBandMeters: 2,
			/**
			 * Height at which a floor reaches its full above or below colour, in metres.
			 *
			 * Measured from the same-level band. Far shorter than the fade span, so which side of
			 * you a passage sits on is obvious well before it dims out.
			 */
			tintSpanMeters: 5,
			/** Height over which a floor fades toward the void, in metres. */
			fadeSpanMeters: 10,
			/**
			 * How completely the most distant floor dissolves into the void, in [0, 1].
			 *
			 * Short of one: a passage far above or below still leaves a trace, because knowing
			 * something is there is most of what a dungeon map is for.
			 */
			maximumFade: 0.5,
			/**
			 * Height span normalising the anchor-relative depth test, in metres.
			 *
			 * Anything further from the anchor's level than this shares the far plane, which is
			 * harmless: by then it has faded out entirely.
			 */
			depthSpanMeters: 200,
			/**
			 * How wide a doorway is drawn across the wall it pierces, in metres.
			 *
			 * A doorway has no thickness worth drawing from above, so this is what makes it visible
			 * at all; it wants to read at town zoom without swallowing its building.
			 */
			transitionAccentThicknessMeters: 2,
		},
		blips: {
			/**
			 * Marker fill per effective `RadarColor`.
			 *
			 * Presentation, not protocol: retail's palette is a client asset, and the map owns its
			 * styling so a client shell can restyle markers without touching map semantics.
			 */
			colorsByRadarColor: {
				Default: "#d8d8e0",
				Blue: "#5b8dd6",
				Gold: "#d6b23f",
				White: "#f0f0f2",
				Purple: "#9b6dd6",
				Red: "#d24b45",
				Pink: "#dd7fb0",
				Green: "#4fb256",
				Yellow: "#e2d24a",
				Cyan: "#4fc4cc",
				BrightGreen: "#6fe86f",
			} as const,
			/** Marker radius in canvas pixels, sized to stay legible without hiding the ground. */
			radiusPixels: 3.5,
		},
		zoom: {
			/**
			 * Zoom as the world-metre diameter across the map's visible circle.
			 *
			 * Resolution-independent by construction: resizing the panel changes pixel density,
			 * never how much world is shown. One landblock is 192 m across, for intuition.
			 */
			defaultViewDiameterMeters: {
				/** Initial extent restored when first entering an EnvCell. */
				indoor: 96,
				/** Initial extent used outdoors or while residency is unknown. */
				outdoor: 192,
			},
			minimumViewDiameterMeters: 24,
			maximumViewDiameterMeters: 1536,
		},
	},

	rendering: {
		/** Fallback framebuffer color exposed when no scene presentation covers a pixel. */
		clearColor: { red: 0.15, green: 0.05, blue: 0.05, alpha: 1 },
		/**
		 * Presentation color grade, applied once to the finished scene.
		 *
		 * Deliberately ours rather than inherited: retail displays its clamped fixed-function
		 * output directly, with no grading or tone mapping anywhere in its present path. This
		 * exists to make the client look better than 1999 hardware allowed, not to match it.
		 * Setting `enabledByDefault: false` restores retail-faithful presentation exactly —
		 * the grade is bypassed rather than neutralized, so disabling it is bit-exact.
		 *
		 * These values are meant to be authored in the Explorer grading panel and pasted back
		 * here — the panel's copy button emits exactly this block.
		 */
		colorGrade: {
			enabledByDefault: true,
			parameters: {
				temperature: 0.03,
				tint: 0,
				saturation: 1.06,
				curves: {
					master: [
						{ x: 0, y: 0 },
						{ x: 0.0437, y: 0.0186 },
						{ x: 0.1517, y: 0.1648 },
						{ x: 0.7589, y: 0.8046 },
						{ x: 1, y: 1 },
					],
					red: [
						{ x: 0, y: 0 },
						{ x: 1, y: 1 },
					],
					green: [
						{ x: 0, y: 0 },
						{ x: 1, y: 1 },
					],
					blue: [
						{ x: 0, y: 0 },
						{ x: 1, y: 1 },
					],
				},
			},
		},
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
		/** Accepted entity-shadow quality and appearance defaults, kept together for later tuning. */
		entityShadows: {
			/** Hybrid PSSM outdoors plus analytic grounding indoors. */
			defaultMode: "shadow-maps" as const,
			/** Build-time analytic-caster capacity shared by every terrain and EnvCell receiver. */
			maximumGroundingCastersPerReceiver: 8,
			pssm: {
				cascadeCount: 3,
				mapResolution: 2_048,
				maximumDistance: 192,
				/** Lowest elevation used to construct shadow maps; scene sunlight remains authored. */
				minimumLightElevationDegrees: 33,
				splitLambda: 0.65,
				transitionFraction: 0.1,
				receiverDepthBias: 0.001,
				normalOffsetBias: 0.15,
				casterPolygonOffsetFactor: 1.1,
				casterPolygonOffsetUnits: 2,
				pcfRadius: 1,
				strength: 0.5,
				casterSearchPadding: 64,
			},
			grounding: {
				strength: 0.33,
				radiusScale: 0.8,
				softness: 0.4,
				dropSpread: 0.3,
				maximumDrop: 3,
				minimumUpFacing: 0.2,
				fullStrengthUpFacing: 0.75,
				contactBias: 0.05,
			},
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
		 * Retail's viewer headlamp, which is what makes an unlit interior navigable.
		 *
		 * Where it hangs is not a preference and is not here: retail attaches it to the body the
		 * viewer is driving and to the camera when there is none (`SmartBox::set_viewer`,
		 * acclient.c:137879-137897), and `game/environment/viewer-light.ts` does that hanging.
		 * What it looks like once hung is ours to shape, so it lives here.
		 */
		viewerLight: {
			/** Whether the headlamp is lit initially; the Explorer world panel toggles it live. */
			enabledByDefault: true,
			/**
			 * Authored falloff, in the same unit every light in the archive authors.
			 *
			 * Retail authors 10 (acclient.c:43910, 728925). `RUNTIME_LIGHT_RANGE_SCALE` is applied
			 * on top, beside the other light code, because reaching `falloff * 1.5` is a rule every
			 * hardware light obeys rather than anything specific to this one.
			 */
			falloff: 10,
			/**
			 * Recalibrated for the authored falloff, not retail's `0.5 * 4.5 = 2.25`.
			 *
			 * Retail's value was tuned against hardware `1/d`. The authored falloff we now use for
			 * every light is effectively inverse-square, so 2.25 would leave the headlamp roughly
			 * thirty times dimmer at ten units and useless past two. This value reproduces retail's
			 * contribution at the midpoint of the light's range, giving a saturated core out to
			 * about five units that tapers to nothing at fifteen.
			 *
			 * Interdependent with `falloff`: changing the reach without retuning this changes how
			 * bright the pool is, not just how far it goes.
			 */
			intensity: 34,
			/** `RGBColor::SetColor32(&viewer_light.color, 0xFFFFFFFF)`, acclient.c:139346. */
			color: { red: 1, green: 1, blue: 1 },
			/**
			 * How far up its own frame a carrying body lifts the light.
			 *
			 * Retail sets `viewer_light.offset` to (0, 0, 2) in AC axes while a body carries the
			 * light and to the origin while the camera does (acclient.c:137881-137896), so a
			 * carried light sits at roughly chest height rather than at the carrier's feet.
			 */
			carryHeight: 2,
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
