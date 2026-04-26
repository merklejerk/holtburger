import { availableModes, type AppModeId } from './modes';

export interface AppShellState {
  title: string;
  summary: string;
  activeMode: AppModeId;
}

export const appShellState: AppShellState = {
  title: 'Mode-first app shell is wired for boundary-driven growth.',
  summary:
    'The frontend now owns top-level mode routing, page composition, and browser-flow policy on top of Rust lifecycle facts and authoritative runtime feeds.',
  activeMode: 'browser',
};

export { availableModes };