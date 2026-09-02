import type { HexRgbColor, HexRgbaColor } from "./frontend-color";
import type { MapBlipCategory } from "./game/map/map-blip-category";
import type { AmbientOcclusionParameters } from "./game/renderer/ambient-occlusion-policy";
import type { ColorGradeParameters } from "./game/renderer/color-grade-policy";
import type {
	IndoorGroundingSettings,
	EntityShadowMode,
	OutdoorShadowCasterBudget,
	OutdoorPssmSettings,
	OutdoorShadowProjectionSettings,
	OutdoorDirectionalShadowSettings,
} from "./game/renderer/entity-shadow-policy";
import type {
	NameplateAppearance,
	NameplateSettings,
} from "./game/renderer/nameplate-policy";
import type { PortalWarpDriveTuning } from "./game/renderer/portal-warp-drive-tuning";
import type { FrameSettings } from "./game/renderer/renderer";

/** Runtime audio policy selected by each frontend composition root. */
export interface FrontendAudioTuning {
	/** Cadence for listener-relative weighting and live voice placement. */
	readonly controlUpdateIntervalSeconds: number;
	/** Maximum number of simultaneously authored voices. */
	readonly maximumSimultaneousVoices: number;
	/** Web Audio smoothing constant for live gain and pan updates. */
	readonly placementSmoothingSeconds: number;
	/** Exponent applied to each voice's linear gain. */
	readonly loudnessCurveExponent: number;
	/** Maximum delay before a warmed sound is too stale to replay. */
	readonly maximumWarmupReplaySeconds: number;
}

/** UI diagnostic cadence and display bounds owned by one frontend mode. */
export interface FrontendUiDiagnosticsTuning {
	/** Smoothing window used by an on-screen frame-time readout. */
	readonly frameMetricsEmaWindowMs: number;
	/** UI publication cadence for a frame rate sampled by the render loop. */
	readonly frameRateDisplayIntervalMs: number;
	/** Largest numeric frame rate rendered by a compact readout. */
	readonly maximumDisplayedFramesPerSecond: number;
}

/** Shared portal-transition appearance selected alongside mode-owned timing. */
export interface FrontendPortalTransitionTuning {
	/** Fullscreen transition effect controls consumed by the renderer. */
	readonly visual: PortalWarpDriveTuning;
}

/** Initial finished-scene grading choice shared or overridden by a frontend mode. */
export interface FrontendColorGradeTuning {
	/** Whether new frontend frame settings enable grading. */
	readonly enabledByDefault: boolean;
	/** Complete authored grading look. */
	readonly parameters: ColorGradeParameters;
}

/** Nameplate policy as authored in tuning, before hex colors become runtime channels. */
interface FrontendNameplateTuning extends Omit<
	NameplateSettings,
	"appearance"
> {
	/** Canvas appearance with tuning-friendly hexadecimal colors. */
	readonly appearance: Omit<
		NameplateAppearance,
		"fillColors" | "outlineColor"
	> & {
		/** Fill selected for each semantic nameplate category. */
		readonly fillColors: Readonly<
			Record<keyof NameplateAppearance["fillColors"], HexRgbaColor>
		>;
		/** Straight-alpha outline surrounding both text lines. */
		readonly outlineColor: HexRgbaColor;
	};
}

/** Authored semantic colors used by map surfaces and their strokes. */
type MapSurfaceColor =
	| "void"
	| "blocker"
	| "blockerStroke"
	| "road"
	| "impassable"
	| "transitionAccent";

/** Three anchor-relative elevation stops shared by indoor and outdoor maps. */
type MapHeightColor = "sameLevelColor" | "aboveColor" | "belowColor";

/** Complete shared overhead-map appearance and view policy. */
interface FrontendMapTuning {
	/** Directional relief-light presentation. */
	readonly hillshade: {
		/** Direction toward the relief light in scene axes. */
		readonly sunDirection: {
			/** East-west component. */
			readonly x: number;
			/** Vertical component. */
			readonly y: number;
			/** South-north component. */
			readonly z: number;
		};
		/** Fraction of terrain color surviving outside the relief light. */
		readonly ambientLevel: number;
		/** Vertical exaggeration applied to shading only. */
		readonly reliefExaggeration: number;
	};
	/** Surface colors plus their associated stroke and pattern controls. */
	readonly colors: Readonly<Record<MapSurfaceColor, HexRgbColor>> & {
		/** Building-footprint outline width in screen pixels. */
		readonly blockerStrokePixels: number;
		/** Strength of the road fill tint. */
		readonly roadTintStrength: number;
		/** Road casing width in screen pixels. */
		readonly roadCasingPixels: number;
		/** Strength of the road casing ink. */
		readonly roadCasingStrength: number;
		/** Screen-space period of impassable hatch stripes. */
		readonly impassableHatchPeriodPixels: number;
		/** Opacity of impassable hatch stripes. */
		readonly impassableHatchStrength: number;
		/** Vertical distance between outdoor contour lines. */
		readonly contourIntervalMeters: number;
		/** Strength of contour-line color. */
		readonly contourStrength: number;
		/** Minimum per-pixel climb required to draw a contour. */
		readonly contourMinimumClimbPerPixelMeters: number;
		/** Height span over which contours reach the ramp endpoints. */
		readonly contourHeightSpanMeters: number;
	};
	/** Shared three-stop anchor-relative elevation palette. */
	readonly heightRamp: Readonly<Record<MapHeightColor, HexRgbColor>>;
	/** Interior elevation tint, fade, depth, and transition controls. */
	readonly interior: {
		/** Height around the anchor treated as the same floor. */
		readonly sameLevelBandMeters: number;
		/** Height over which floor tint reaches a ramp endpoint. */
		readonly tintSpanMeters: number;
		/** Height over which a floor fades toward the void. */
		readonly fadeSpanMeters: number;
		/** Largest fraction faded from a distant floor. */
		readonly maximumFade: number;
		/** Height span used to normalize anchor-relative depth. */
		readonly depthSpanMeters: number;
		/** Map-space doorway thickness. */
		readonly transitionAccentThicknessMeters: number;
	};
	/** Map marker palette and screen-space size. */
	readonly blips: {
		/** Marker fill and opacity selected by producer-resolved map category or controlled status. */
		readonly fillColors: Readonly<Record<MapBlipCategory, HexRgbaColor>>;
		/** Largest fractional brightness change in [0, 1] used to show relative elevation. */
		readonly maximumElevationBrightnessAdjustment: number;
		/** Marker radius in canvas pixels. */
		readonly radiusPixels: number;
	};
	/** Visible world extent bounds for indoor and outdoor maps. */
	readonly zoom: {
		/** Initial visible diameter selected by environment kind. */
		readonly defaultViewDiameterMeters: {
			/** Initial indoor-map diameter. */
			readonly indoor: number;
			/** Initial outdoor-map diameter. */
			readonly outdoor: number;
		};
		/** Closest permitted map zoom. */
		readonly minimumViewDiameterMeters: number;
		/** Furthest permitted map zoom. */
		readonly maximumViewDiameterMeters: number;
	};
}

/** Shared interaction policy for the HUD minimap widget. */
interface FrontendMinimapTuning {
	/** Bounded, distance-sampled controlled-entity history. */
	readonly breadcrumbs: {
		/** Base breadcrumb colour before age opacity and elevation brightness are applied. */
		readonly color: HexRgbColor;
		/** Dark outer edge that preserves contrast against pale map surfaces. */
		readonly haloColor: HexRgbColor;
		/** Screen-space width extending the halo beyond the core circle. */
		readonly haloWidthPixels: number;
		/** Maximum recency-ordered positions retained by one mounted minimap. */
		readonly maximumSamples: number;
		/** Consecutive 3D displacement that begins a fresh trail. */
		readonly maximumContinuousStepMeters: number;
		/** Opacity assigned to the oldest retained age band. */
		readonly oldestOpacity: number;
		/** Opacity assigned to the newest retained age band. */
		readonly newestOpacity: number;
		/** Screen-space radius of each breadcrumb circle. */
		readonly radiusPixels: number;
		/** Horizontal recording deadband and 3D occupied-space radius. */
		readonly spacingMeters: {
			/** Spacing while the subject occupies an environment cell. */
			readonly indoor: number;
			/** Spacing outdoors or while residency is unknown. */
			readonly outdoor: number;
		};
	};
	/** Transient minimap navigation behavior. */
	readonly navigation: {
		/** Subject displacement that returns a panned minimap to follow mode. */
		readonly automaticReanchorDistanceMeters: number;
	};
}

/** Resource and runtime controls for shared ambient-occlusion presentation. */
interface FrontendAmbientOcclusionTuning extends AmbientOcclusionParameters {
	/** Whether new frontend frame settings enable AO. */
	readonly enabledByDefault: boolean;
	/** Linear scratch-target resolution multiplier. */
	readonly resolutionScale: number;
	/** Number of deterministic shader kernel taps. */
	readonly sampleCount: number;
	/** Camera interval over which AO becomes neutral. */
	readonly distanceFade: {
		/** Furthest distance retaining full AO strength. */
		readonly fullStrengthUntil: number;
		/** Distance where AO becomes completely disabled. */
		readonly disabledAt: number;
	};
}

/** Build-time and runtime entity-shadow defaults authored as one policy. */
interface FrontendEntityShadowTuning {
	/** Shadow mode installed into new frame settings. */
	readonly defaultMode: EntityShadowMode;
	/** Build-time analytic-caster capacity per receiver. */
	readonly maximumAnalyticShadowCastersPerReceiver: number;
	/** Complete-root N/M defaults retained together for manual calibration. */
	readonly casterBudget: OutdoorShadowCasterBudget;
	/** Outdoor parallel-split shadow-map policy. */
	readonly pssm: OutdoorPssmSettings;
	/** Shared bounded projection policy for mapped and analytic outdoor shadows. */
	readonly projection: OutdoorShadowProjectionSettings;
	/** Analytic actor-grounding policy. */
	readonly indoorGrounding: IndoorGroundingSettings;
	/** Terrain-only directional analytic fallback appearance. */
	readonly outdoorDirectional: OutdoorDirectionalShadowSettings;
}

/** Initial frame choices flattened for convenient tuning authoring. */
type FrontendFrameDefaultsTuning = Pick<
	FrameSettings,
	| "distanceFogEnabled"
	| "weatherEnabled"
	| "staticLightsEnabled"
	| "envCellRenderMode"
> &
	FrameSettings["quality"];

/** Shared renderer appearance, resource budgets, and initial display choices. */
interface FrontendRenderingTuning {
	/** Fallback framebuffer color when no scene covers a pixel. */
	readonly clearColor: HexRgbaColor;
	/** Initial nameplate workload and Canvas appearance. */
	readonly nameplates: FrontendNameplateTuning;
	/** Initial finished-scene color grade. */
	readonly colorGrade: FrontendColorGradeTuning;
	/** Shared ambient-occlusion defaults and resource controls. */
	readonly ambientOcclusion: FrontendAmbientOcclusionTuning;
	/** Shared entity-shadow quality and appearance defaults. */
	readonly entityShadows: FrontendEntityShadowTuning;
	/** Global authored-weather opacity policy. */
	readonly weather: {
		/** Multiplier applied to authored weather-object opacity. */
		readonly opacityScale: number;
	};
	/** Sky-attached particle opacity and simulation rate. */
	readonly skyParticles: {
		/** Multiplier applied to authored sky-particle opacity. */
		readonly opacityScale: number;
		/** Multiplier applied to sky-particle simulation time. */
		readonly speedMultiplier: number;
	};
	/** Initial dynamic frame choices shared by both frontends. */
	readonly frameDefaults: FrontendFrameDefaultsTuning;
	/** Retail-style camera or carrier headlamp presentation. */
	readonly viewerLight: {
		/** Whether new frontend frame settings enable the light. */
		readonly enabledByDefault: boolean;
		/** Authored light reach before the shared runtime scale. */
		readonly falloff: number;
		/** Light contribution before distance attenuation. */
		readonly intensity: number;
		/** Viewer-light emission color. */
		readonly color: HexRgbColor;
		/** Carrier-local height above the body origin. */
		readonly carryHeight: number;
	};
	/** Presentation policy for outdoor authored lamps. */
	readonly outdoorAuthoredLights: {
		/** Scale applied to authored light intensity. */
		readonly intensityScale: number;
		/** Terrain brightness receiving full lamp response. */
		readonly fullResponseBrightness: number;
		/** Terrain brightness receiving minimum lamp response. */
		readonly minimumResponseBrightness: number;
		/** Lamp fraction retained in full daylight. */
		readonly minimumResponse: number;
	};
	/** Camera interval over which terrain detail textures fade. */
	readonly terrainDetailFade: {
		/** Distance where detail fading begins. */
		readonly near: number;
		/** Distance where detail is fully faded. */
		readonly far: number;
	};
	/** Fog coverage that selects the far-terrain approximation. */
	readonly farTerrainFogCoverage: number;
	/** Distance inside which transparent objects receive exact ordering. */
	readonly transparentObjects: {
		/** Radius receiving exact camera-depth ordering. */
		readonly nearDistance: number;
	};
}

/** Exhaustive contract for values shared by the browser frontend compositions. */
export interface FrontendTuning {
	/** Sampling policy for animated roots omitted by the previous frame. */
	readonly animationPresentation: {
		/** Maximum interval between offscreen animation samples. */
		readonly offscreenSampleIntervalSeconds: number;
	};
	/** Shared authored-audio behavior. */
	readonly audio: FrontendAudioTuning;
	/** Renderer and runtime diagnostic retention budgets. */
	readonly diagnostics: {
		/** GPU query frames allowed to await device results. */
		readonly maximumPendingGpuFrames: number;
		/** CPU frame samples retained for tail percentiles. */
		readonly percentileCpuFrameTail: number;
		/** Recent authored-effect observations retained for diagnostics. */
		readonly maximumRecentEffectObservations: number;
	};
	/** Shared fullscreen portal-transition presentation. */
	readonly portalTransition: FrontendPortalTransitionTuning;
	/** Shared overhead-map presentation and view bounds. */
	readonly map: FrontendMapTuning;
	/** Shared HUD minimap interaction policy. */
	readonly minimap: FrontendMinimapTuning;
	/** Renderer presentation defaults and quality policy. */
	readonly rendering: FrontendRenderingTuning;
	/** Bounded workload and resource-allocation controls. */
	readonly workloads: {
		/** Static-object atlas dimensions and compaction work budget. */
		readonly staticObjectTextureAtlas: {
			/** Pages rebuilt during one incremental compaction pass. */
			readonly maximumCompactionRebuildPages: number;
			/** Fixed edge length of each resident atlas page. */
			readonly pageSize: number;
		};
	};
}
