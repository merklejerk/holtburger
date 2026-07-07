import type { RenderPassPlan, RendererSnapshot } from "../renderer/types";
import type { StaticDomain } from "../static/contracts";
import type { OpenWorldStreamingDiagnosticsSnapshot } from "../systems/open-world-streaming/diagnostics/contracts";
import type { TextureFilteringMode } from "../textures/sampling-policy";

export interface RuntimeDiagnosticsReport {
	readonly kind: "runtime-diagnostics-report";
	readonly runtime: RuntimeDiagnosticsRuntimeSummary;
	readonly domains: readonly RuntimeDiagnosticsDomainReport[];
}

interface RuntimeDiagnosticsRuntimeSummary {
	readonly status: "idle" | "static-active" | "disposed";
	readonly textureFilteringMode: TextureFilteringMode;
	readonly sceneInterest: string | null;
}

type RuntimeDiagnosticsDomainReport =
	| OpenWorldStreamingDiagnosticsReport
	| RendererDiagnosticsReport;

interface OpenWorldStreamingDiagnosticsReport {
	readonly kind: "open-world-streaming";
	readonly summary: OpenWorldStreamingDiagnosticsSnapshot;
}

interface RendererDiagnosticsReport {
	readonly kind: "renderer";
	readonly summary: RendererDiagnosticsSummary;
}

export interface RendererDiagnosticsSummary {
	readonly backend: RendererSnapshot["backend"];
	readonly canvasHeight: number;
	readonly canvasWidth: number;
	readonly debugOverlayPrimitives: number;
	readonly directEnvCellDrawCalls: number;
	readonly dynamicInstances: number;
	readonly dynamicVisualResourceTextureUses: number;
	readonly dynamicVisualResources: number;
	readonly error: string | null;
	readonly frameCount: number;
	readonly frameHandlerMs: number;
	readonly isRunning: boolean;
	readonly outdoorGeneratedSceneryStaticObjectBakedDirectDrawCalls: number;
	readonly outdoorGeneratedSceneryStaticObjectBakedDirectDrawCallsByPass: RendererSnapshot["outdoorGeneratedSceneryStaticObjectBakedDirectDrawCallsByPass"];
	readonly outdoorGeneratedSceneryStaticObjectRenderInstances: number;
	readonly outdoorGeneratedSceneryStaticObjectResources: number;
	readonly outdoorGeneratedSceneryStaticObjectUploadedBufferBytes: number;
	readonly outdoorGeneratedSceneryStaticObjectVisualResources: number;
	readonly renderedTriangles: number;
	readonly renderPassKind: RenderPassPlan["kind"];
	readonly skippedDynamicSubmissions: number;
	readonly staticDrawUnits: number;
	readonly staticObjectBakedDirectDrawCalls: number;
	readonly staticObjectDirectRenderInstanceDrawCalls: number;
	readonly staticObjectFarTransparentDirectRenderInstanceDrawCalls: number;
	readonly staticObjectFarTransparentInstancedRenderInstanceDrawCalls: number;
	readonly staticObjectFarTransparentInstancedRenderInstances: number;
	readonly staticObjectInstancedRenderInstanceDrawCalls: number;
	readonly staticObjectInstancedRenderInstances: number;
	readonly staticObjectNearTransparentDirectRenderInstanceDrawCalls: number;
	readonly staticObjectRenderInstances: number;
	readonly staticObjectResources: number;
	readonly staticObjectUploadedBufferBytes: number;
	readonly staticObjectUploadSummary: StaticObjectUploadSummaryDiagnostics;
	readonly staticObjectVisualResources: number;
	readonly terrainDrawUnits: number;
}

interface StaticObjectUploadSummaryDiagnostics {
	readonly largestUpload: StaticObjectUploadSampleDiagnostics | null;
	readonly recentUploadCount: number;
	readonly totalDrawUnits: number;
	readonly totalUploadedBufferBytes: number;
	readonly totalUploadMs: number;
}

interface StaticObjectUploadSampleDiagnostics {
	readonly domain: StaticDomain;
	readonly drawUnitCount: number;
	readonly landblockId: string;
	readonly uploadedBufferBytes: number;
	readonly uploadMs: number;
}
