import type {
  AssetLookupRequestDto,
  AssetLookupResponseDto,
  FrontendStateFeedDto,
  HostBoundaryOverviewDto,
  HostBoundarySnapshot,
  LifecycleStateDto,
  RuntimeBatchDto,
  RuntimeNotificationEnvelopeDto,
} from './contracts';

const RUNTIME_NOTIFICATION_EVENT = 'runtime:notification';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: object;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__ !== 'undefined';
}

function fallbackLifecycleState(): LifecycleStateDto {
  return {
    phase: 'ready',
    activeModeHint: 'browser',
    sessionState: 'unavailable',
    summary: 'Browser preview fallback mirrors the host boundary shape until the Tauri runtime is active.',
  };
}

function fallbackRuntimeBatch(): RuntimeBatchDto {
  return {
    tick: 1,
    entities: [
      {
        entityId: 0x01020304,
        label: 'Browser Scout',
        position: { x: 12, y: -4.5, z: 1 },
        headingRadians: 0,
        appearanceId: 'gfx/02000001',
        landblockId: 0x01020003,
        cellId: 3,
        locationLabel: '100.40S, 101.55W, 1.0Z',
        isLocalPlayer: true,
      },
      {
        entityId: 0x01020305,
        label: 'Survey Drudge',
        position: { x: 18, y: -1, z: 0 },
        headingRadians: Math.PI / 2,
        appearanceId: 'gfx/02000002',
        landblockId: 0x0102001b,
        cellId: 27,
        locationLabel: '100.41S, 101.52W, 0.0Z',
        isLocalPlayer: false,
      },
    ],
    residency: {
      focusEntityId: 0x01020304,
      focusLandblockId: 0x01020003,
      focusCellId: 3,
      focusLocationLabel: '100.40S, 101.55W, 1.0Z',
      indoors: false,
      trackedBodyCount: 2,
    },
  };
}

function fallbackViewModelFeed(): FrontendStateFeedDto {
  return {
    selectedEntityId: 0x01020304,
    interactionMode: 'inspect',
    busyState: 'idle',
  };
}

function fallbackOverview(): HostBoundaryOverviewDto {
  return {
    runtimeChannel: 'runtime',
    runtimeNotificationEvent: 'runtime:notification',
    runtimeLifecycleTopic: 'lifecycle.state',
    runtimeBatchCommand: 'get_runtime_batch',
    assetLookupCommand: 'lookup_asset',
    notes: [
      'Browser preview is using app-local fallback data.',
      'Launch under Tauri to exercise the real host commands and startup lifecycle event.',
    ],
  };
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function readHostBoundarySnapshot(): Promise<HostBoundarySnapshot> {
  const assetRequest: AssetLookupRequestDto = {
    requestId: 'browser-preview-snapshot',
    assetId: 'gfx/02000001',
    priority: 'bootstrap',
  };

  if (!isTauriRuntime()) {
    return {
      source: 'browser-preview',
      lifecycleState: fallbackLifecycleState(),
      runtimeBatch: fallbackRuntimeBatch(),
      viewModelFeed: fallbackViewModelFeed(),
      assetResponse: {
        requestId: assetRequest.requestId,
        assetId: assetRequest.assetId,
        payloadKind: 'json',
        payload: {
          kind: 'diagnostic-asset-metadata',
          notes: ['Fallback payload for browser-only preview.'],
        },
      },
      overview: fallbackOverview(),
    };
  }

  const [lifecycleState, runtimeBatch, viewModelFeed, assetResponse, overview] = await Promise.all([
    invokeCommand<LifecycleStateDto>('get_lifecycle_state'),
    invokeCommand<RuntimeBatchDto>('get_runtime_batch'),
    invokeCommand<FrontendStateFeedDto>('get_view_model_feed'),
    invokeCommand<AssetLookupResponseDto>('lookup_asset', { request: assetRequest }),
    invokeCommand<HostBoundaryOverviewDto>('get_host_boundary_overview'),
  ]);

  return {
    source: 'tauri',
    lifecycleState,
    runtimeBatch,
    viewModelFeed,
    assetResponse,
    overview,
  };
}

export async function listenForRuntimeLifecycle(
  onNotification: (notification: RuntimeNotificationEnvelopeDto) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<RuntimeNotificationEnvelopeDto>(
    RUNTIME_NOTIFICATION_EVENT,
    (event) => onNotification(event.payload),
  );

  return () => {
    unlisten();
  };
}