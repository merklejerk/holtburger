import { describe, expect, it } from 'vitest';

import {
  createBrowserModeState,
  parseBrowserLocationInput,
  previewBrowserLocation,
  selectRuntimeResidencyDestination,
  updateBrowserDraft,
} from './browser-mode';
import type { RuntimeResidencyDto } from '../lib/host/contracts';

const runtimeResidency: RuntimeResidencyDto = {
  focusEntityId: 0x01020304,
  focusLandblockId: 0x01020003,
  focusCellId: 3,
  focusLocationLabel: '100.40S, 101.55W, 1.0Z',
  indoors: false,
  trackedBodyCount: 2,
};

describe('browser-mode location policy', () => {
  it('parses AC-style coordinate input into a stable selection label', () => {
    expect(parseBrowserLocationInput('100.4s, 101.55w, 1z')).toEqual({
      label: '100.40S, 101.55W, 1.0Z',
      northSouth: 100.4,
      northSouthHemisphere: 'S',
      eastWest: 101.55,
      eastWestHemisphere: 'W',
      elevation: 1,
      source: 'manual',
    });
  });

  it('returns a validation message for invalid location input', () => {
    const state = previewBrowserLocation(updateBrowserDraft(createBrowserModeState(), 'holtburg plaza'));

    expect(state.validationMessage).toMatch(/AC-style location format/);
    expect(state.destination).toBeNull();
    expect(state.page).toBe('location-entry');
  });

  it('can promote the live runtime residency into the selected browser destination', () => {
    const state = selectRuntimeResidencyDestination(createBrowserModeState(), runtimeResidency);

    expect(state.destination?.source).toBe('runtime-residency');
    expect(state.destination?.label).toBe(runtimeResidency.focusLocationLabel);
    expect(state.page).toBe('destination-preview');
  });
});