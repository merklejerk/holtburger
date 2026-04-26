import { availableModes, type AppModeId } from './modes';

export interface AppShellState {
  title: string;
  summary: string;
  activeMode: AppModeId;
}

export const appShellState: AppShellState = {
  title: 'Mode-first app shell is wired for boundary-driven growth.',
  summary:
    'The frontend owns top-level mode state and page composition, while Rust will own lifecycle facts and authoritative runtime feeds.',
  activeMode: 'browser',
};

export { availableModes };

export const selectedModeLabel =
  availableModes.find((mode) => mode.id === appShellState.activeMode)?.label ?? 'Unknown Mode';