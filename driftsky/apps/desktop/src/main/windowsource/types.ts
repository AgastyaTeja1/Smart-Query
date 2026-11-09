/** A window on screen in global screen coordinates (Electron DIPs), front-to-back order. */
export interface ScreenWindow {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowSource {
  readonly name: string;
  /** Front-to-back list of ordinary app windows (no menu bar, Dock, desktop, or our own). */
  list(): ScreenWindow[];
  dispose?(): void;
}

export const emptySource: WindowSource = { name: 'none', list: () => [] };
