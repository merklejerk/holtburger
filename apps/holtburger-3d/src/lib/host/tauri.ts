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

const RUNTIME_LIFECYCLE_EVENT = 'runtime:lifecycle-state';

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
        position: { x: 12, y: -4.5, z: 1 },
        headingRadians: 0,
        appearanceId: 'stub/world-anchor',
      },
      {
        entityId: 0x01020305,
        position: { x: 18, y: -1, z: 0 },
        headingRadians: Math.PI / 2,
        appearanceId: 'stub/browser-probe',
      },
    ],
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
    assetId: 'stub/world-anchor',
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
          kind: 'stub-asset-metadata',
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
  onLifecycle: (notification: RuntimeNotificationEnvelopeDto) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => {};
  }

  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<RuntimeNotificationEnvelopeDto>(
    RUNTIME_LIFECYCLE_EVENT,
    (event) => onLifecycle(event.payload),
  );

  return () => {
    unlisten();
  };
}