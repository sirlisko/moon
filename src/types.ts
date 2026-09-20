import type * as THREE from "three";
import type { ObserverCoords } from "./astronomy.js";

export type LocationStatus = "idle" | "pending" | "granted" | "denied" | "unsupported";

// Shared, mutable ref owned by main.js — views read coords/status fresh on
// every refresh rather than being pushed an update (see location.js).
export interface LocationState {
  coords: ObserverCoords | null;
  status: LocationStatus;
}

export type AppView = "today" | "month" | "year" | "detail";

// Where a moon already sits on screen at the moment it's selected, in CSS
// pixels relative to the viewport (the canvas is full-bleed, so viewport
// coordinates and canvas coordinates are the same thing). Handed from the
// grid to the detail view via main.js so the detail view can start its moon
// on exactly the circle the grid cell occupied and fly it into place,
// rather than cutting between two unrelated framings.
export interface MoonOrigin {
  x: number;
  y: number;
  radius: number;
}

// A grid's pan offset (the orthographic frustum's center, world units).
export interface GridPan {
  x: number;
  y: number;
}

export interface ReturnTo {
  view: AppView;
  year: number;
  month: number;
}

export interface AppState {
  view: AppView;
  year: number;
  month: number;
  detailDate: Date | null;
  returnTo: ReturnTo | null;
}

// The common contract every view (moon-detail.js, moon-grid.js) returns to
// main.js — exactly one is ever mounted at a time.
export interface ViewInstance {
  mount(container: HTMLElement, renderer: THREE.WebGLRenderer): void;
  update(): void;
  render(renderer: THREE.WebGLRenderer): void;
  resize(width: number, height: number): void;
  dispose(): void;
  setRingsVisible?(visible: boolean): void;
  // Grid only: where the view is currently panned, so coming back to the
  // same grid can resume there instead of jumping to day 1 — which is also
  // what lets the detail view's return flight land on the cell it came from.
  // Null when the grid fits on screen and isn't pannable at all.
  getPan?(): GridPan | null;
  // Detail view only: show another date without being torn down, easing
  // across to it — how the nav arrows step a day (see moon-detail.js).
  setDate?(date: Date): void;
  // Detail view only: rename the back button, for when a day step has moved
  // where it goes (see stepNav in main.js).
  setBackLabel?(text: string): void;
  refreshLocation?(): void;
  refreshOrientation?(): void;
}
