export type LifecyclePhase = 'booting' | 'ready' | 'disconnected';
export type ModeHint = 'browser' | 'client';
export type SessionState = 'unavailable' | 'disconnected' | 'connected';
export type InteractionMode = 'none' | 'inspect';
export type BusyState = 'idle' | 'loading';
export type AssetPriority = 'bootstrap' | 'streaming' | 'prefetch';
export type AssetPayloadKind = 'bytes' | 'json';

export interface Vec3Dto {
  x: number;
  y: number;
  z: number;
}

export interface LifecycleStateDto {
  phase: LifecyclePhase;
  activeModeHint: ModeHint | null;
  sessionState: SessionState;
  summary: string;
}

export interface RuntimeEntitySnapshotDto {
  entityId: number;
  label: string;
  position: Vec3Dto;
  headingRadians: number;
  appearanceId: string;
  landblockId: number;
  cellId: number | null;
  locationLabel: string;
  isLocalPlayer: boolean;
}

export interface RuntimeResidencyDto {
  focusEntityId: number | null;
  focusLandblockId: number;
  focusCellId: number | null;
  focusLocationLabel: string;
  indoors: boolean;
  trackedBodyCount: number;
}

export interface RuntimeBatchDto {
  tick: number;
  entities: RuntimeEntitySnapshotDto[];
  residency: RuntimeResidencyDto;
}

export interface FrontendStateFeedDto {
  selectedEntityId: number | null;
  interactionMode: InteractionMode;
  busyState: BusyState;
}

export interface AssetLookupRequestDto {
  requestId: string;
  assetId: string;
  priority: AssetPriority;
}

export interface AssetLookupResponseDto {
  requestId: string;
  assetId: string;
  payloadKind: AssetPayloadKind;
  payload: unknown;
}

export interface RuntimeNotificationEnvelopeDto {
  channel: string;
  topic: string;
  lifecycleState: LifecycleStateDto | null;
  runtimeBatch: RuntimeBatchDto | null;
  viewModelFeed: FrontendStateFeedDto | null;
}

export interface HostBoundaryOverviewDto {
  runtimeChannel: string;
  runtimeNotificationEvent: string;
  runtimeLifecycleTopic: string;
  runtimeBatchCommand: string;
  assetLookupCommand: string;
  notes: string[];
}

export interface HostBoundarySnapshot {
  source: 'browser-preview' | 'tauri';
  lifecycleState: LifecycleStateDto;
  runtimeBatch: RuntimeBatchDto;
  viewModelFeed: FrontendStateFeedDto;
  assetResponse: AssetLookupResponseDto;
  overview: HostBoundaryOverviewDto;
}