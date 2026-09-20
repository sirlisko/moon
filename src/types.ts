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
  refreshLocation?(): void;
  refreshOrientation?(): void;
}
