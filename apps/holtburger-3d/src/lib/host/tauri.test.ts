import { describe, expect, it } from 'vitest';

import { readHostBoundarySnapshot } from './tauri';

describe('readHostBoundarySnapshot', () => {
  it('returns the browser-preview fallback shape outside the Tauri runtime', async () => {
    const snapshot = await readHostBoundarySnapshot();

    expect(snapshot.source).toBe('browser-preview');
    expect(snapshot.lifecycleState.activeModeHint).toBe('browser');
    expect(snapshot.runtimeBatch.tick).toBeGreaterThan(0);
    expect(snapshot.runtimeBatch.residency.focusLocationLabel).toMatch(/Z$/);
    expect(snapshot.viewModelFeed.interactionMode).toBe('inspect');
    expect(snapshot.overview.runtimeNotificationEvent).toBe('runtime:notification');
  });
});