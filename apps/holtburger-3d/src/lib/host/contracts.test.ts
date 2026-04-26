import { describe, expect, it } from 'vitest';

import type {
  FrontendStateFeedDto,
  LifecycleStateDto,
  RuntimeBatchDto,
  RuntimeNotificationEnvelopeDto,
  RuntimeResidencyDto,
} from './contracts';

describe('host contracts', () => {
  it('keeps the stable runtime contract fields visible to TypeScript tests', () => {
    const lifecycleState: LifecycleStateDto = {
      phase: 'ready',
      activeModeHint: 'browser',
      sessionState: 'disconnected',
      summary: 'Ready for browser mode.',
    };
    const residency: RuntimeResidencyDto = {
      focusEntityId: 0x01020304,
      focusLandblockId: 0x01020003,
      focusCellId: 3,
      focusLocationLabel: '100.40S, 101.55W, 1.0Z',
      indoors: false,
      trackedBodyCount: 2,
    };
    const runtimeBatch: RuntimeBatchDto = {
      tick: 1,
      entities: [
        {
          entityId: 0x01020304,
          label: 'Browser Scout',
          position: { x: 12, y: -4.5, z: 1 },
          headingRadians: 0,
          appearanceId: 'gfx/02000001',
          landblockId: residency.focusLandblockId,
          cellId: residency.focusCellId,
          locationLabel: residency.focusLocationLabel,
          isLocalPlayer: true,
        },
      ],
      residency,
    };
    const viewModelFeed: FrontendStateFeedDto = {
      selectedEntityId: 0x01020304,
      interactionMode: 'inspect',
      busyState: 'idle',
    };
    const notification: RuntimeNotificationEnvelopeDto = {
      channel: 'runtime',
      topic: 'runtime.batch',
      lifecycleState,
      runtimeBatch,
      viewModelFeed,
    };

    expect(notification.lifecycleState?.phase).toBe('ready');
    expect(notification.runtimeBatch?.residency.focusLocationLabel).toBe('100.40S, 101.55W, 1.0Z');
    expect(notification.viewModelFeed?.interactionMode).toBe('inspect');
  });
});