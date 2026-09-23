import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  computeMoonState,
  computeMoonVisual,
  getPhaseName,
  azimuthToCompass,
  localNoon,
  moonTransit,
  nextPrincipalPhase,
} from "./astronomy.js";
import type { MoonState, MoonVisual } from "./astronomy.js";
import { getColorMap, getDisplacementMap } from "./textures.js";
import { sunDirFromPhase, earthshineFromPhase, earthshineColor, SUN_INTENSITY } from "./moon-shader.js";
import { setIconLabel } from "./icons.js";
import { createSkyCompass } from "./sky-compass.js";
import type { SkyCompass } from "./sky-compass.js";
import type { OrientationState } from "./orientation.js";
import type { LocationState, MoonOrigin, ViewInstance } from "./types.js";

const BASE_ROTATION_Y = Math.PI * 1.54;
const BASE_ROTATION_X = Math.PI * 0.02;
const REFRESH_INTERVAL_MS = 30000;
const MOON_RADIUS = 2;
// The real Moon is ~110 of its own radii away, so what we see from Earth is
// all but an orthographic projection: a full hemisphere, with the thin
// crescents sitting right on the limb. A camera parked a couple of radii out
// (this was 2.5) sees a noticeably *smaller* cap than that — only where
// n·z > radius/distance — and a waning crescent a few percent illuminated
// falls entirely outside it, which rendered days like 2026-09-09 pure black
// while the (orthographic) calendar cell for the same day correctly showed a
// sliver. 25 radii is near-orthographic enough to keep crescents down to a
// fraction of a percent, without the depth-precision of a truly vast scene.
const CAMERA_DEFAULT_DISTANCE = MOON_RADIUS * 25;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 0, CAMERA_DEFAULT_DISTANCE);
// The displacement map is applied with no bias, so it only ever pushes the
// surface outward: the silhouette the moon actually draws is this much wider
// than the sphere's nominal radius. A grid cell carries no displacement and so
// has no such margin, which is why the flight solves its landing scale against
// the drawn radius rather than the nominal one — against the nominal one the
// moon arrives 3% larger than the cell it came from and snaps a frame later,
// when the grid takes over.
const DISPLACEMENT_SCALE = 0.06;
const SILHOUETTE_RADIUS = MOON_RADIUS + DISPLACEMENT_SCALE;
// Fraction of the viewport half-height the Moon's silhouette covers at that
// distance — the framing the old 75° FOV at 5 units gave, kept as the thing
// that's actually meant to stay fixed now that the distance has changed.
const MOON_FILL = 0.52;
const DEFAULT_FOV = THREE.MathUtils.radToDeg(
  2 * Math.atan(MOON_RADIUS / (MOON_FILL * CAMERA_DEFAULT_DISTANCE))
);
// Zoom range, as multiples of the default distance: the same 2× in / 4× out
// as before. Nothing can reach the surface from here, but the clamp still
// keeps zoom from overshooting into "Moon fills everything" / "Moon is a
// dot in the starfield".
const MIN_ZOOM_DISTANCE = CAMERA_DEFAULT_DISTANCE / 2;
const MAX_ZOOM_DISTANCE = CAMERA_DEFAULT_DISTANCE * 4;
// What counts as "the user has moved the camera" — for the Reset view button
// and for refusing a return flight. Relative, since the distances are.
const CAMERA_MOVED_EPSILON = CAMERA_DEFAULT_DISTANCE * 0.002;
// How much bigger the Moon's angular size is allowed to get relative to the
// (shrunk, on a narrow screen) horizontal field of view before we widen the
// FOV to compensate — 1.0 would mean "touching the edges exactly."
const FOV_FIT_MARGIN = 1.15;

// A fixed vertical FOV (three.js's `fov` is always vertical) looks fine on
// a landscape/desktop screen, but on a tall narrow phone the *horizontal*
// FOV it implies shrinks enough to crop the Moon at the sides — even at
// the default, non-zoomed camera distance. Widen the FOV just enough to
// keep the Moon fully in frame at that default distance; zooming itself is
// unaffected since it changes camera distance, not FOV.
function computeFov(aspect: number): number {
  if (aspect >= 1) return DEFAULT_FOV;
  const halfVFovRad = THREE.MathUtils.degToRad(DEFAULT_FOV / 2);
  const currentHalfHFovRad = Math.atan(Math.tan(halfVFovRad) * aspect);
  const moonHalfAngleRad = Math.asin(MOON_RADIUS / CAMERA_DEFAULT_DISTANCE) * FOV_FIT_MARGIN;
  if (currentHalfHFovRad >= moonHalfAngleRad) return DEFAULT_FOV;
  const neededHalfVFovRad = Math.atan(Math.tan(moonHalfAngleRad) / aspect);
  return THREE.MathUtils.radToDeg(neededHalfVFovRad) * 2;
}

// The flight from the calendar cell the user clicked into this view's own
// framing. The grid hands over the cell's on-screen circle (MoonOrigin) and
// the moon starts there, so the two views read as one continuous object
// instead of a cut; the fades bring in everything the grid had no
// counterpart for (stars, HUD, back button).
const TRANSITION_MS = 520;
// Least room left between the back button and the icon cluster when the two
// share a row.
const BACK_ICON_GAP_PX = 12;
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Stepping a day with the nav arrows keeps this view mounted and eases the
// sky from one day to the next (the terminator sweeps across, the tilt
// follows) rather than cutting — see setDate below.
const STEP_MS = 450;
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
// Phase is a 0..1 cycle fraction, so a step across new moon (0.99 → 0.01)
// has to take the short way round rather than sweeping back over the whole
// cycle; the same goes for the parallactic angle in radians.
function blendCycle(from: number, to: number, t: number, period: number): number {
  let delta = (to - from) % period;
  if (delta > period / 2) delta -= period;
  if (delta < -period / 2) delta += period;
  return from + delta * t;
}

// The parallactic angle rolls the Moon's whole appearance about the line of
// sight — the terminator turns with the surface — so it can't be a
// `moon.rotation.z`: three.js composes an XYZ Euler as Rx·Ry·Rz, which
// applies the z term in the *moon's* frame, and under BASE_ROTATION_Y (~277°)
// that axis lands within a couple of degrees of world -x. Setting rotation.z
// therefore pitched the sphere about the horizontal screen axis, spinning the
// surface north/south under a terminator that stayed put — 41° of it for a
// mid-latitude observer. The roll is applied in world space instead, to the
// moon's orientation and to the sun direction alike.
const VIEW_AXIS = new THREE.Vector3(0, 0, 1);

// A near-orthographic camera means a narrow FOV, which means only ~0.3% of
// the sky is in frame at once — a few thousand stars spread over the whole
// sphere left about a dozen on screen, more dust specks than a sky. This many
// keeps roughly the on-screen density the old wide-angle view had.
const STAR_COUNT = 200000;
const STAR_SPHERE_RADIUS = 800;

// Built once and shared by every detail view, like the textures: the
// positions are identical every time (see the seeding below), it costs a
// noticeable moment to generate, and nothing ever mutates it.
//
// Split into a grid of sky patches rather than one giant point cloud, so
// three.js's per-object frustum culling can skip the ~98% of the sky that a
// narrow FOV leaves off screen — otherwise every one of these stars runs
// through the vertex shader on every frame to be clipped, which measurably
// costs frames (2.6× the frame time of the old sparse field, even before a
// weaker GPU is involved). Only the handful of patches actually in view draw.
const STAR_PATCHES_AZIMUTH = 12;
const STAR_PATCHES_POLAR = 8;
let sharedStarPatches: THREE.BufferGeometry[] | null = null;
function getStarPatches(): THREE.BufferGeometry[] {
  if (sharedStarPatches) return sharedStarPatches;
  // Seeded rather than Math.random(): stepping off "Today" rebuilds the view,
  // and a freshly scrambled sky under an otherwise-unchanged moon is a jump
  // cut all by itself. Same stars every time, so only the moon moves.
  let seed = 0x9e3779b9;
  function random(): number {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const patches: number[][] = Array.from(
    { length: STAR_PATCHES_AZIMUTH * STAR_PATCHES_POLAR },
    () => []
  );
  for (let i = 0; i < STAR_COUNT; i++) {
    // cos(phi) uniform in [-1, 1] keeps the distribution even over the
    // sphere rather than bunching at the poles.
    const cosPhi = 2 * random() - 1;
    const theta = random() * Math.PI * 2;
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    const a = Math.min(STAR_PATCHES_AZIMUTH - 1, Math.floor((theta / (Math.PI * 2)) * STAR_PATCHES_AZIMUTH));
    const pol = Math.min(STAR_PATCHES_POLAR - 1, Math.floor(((cosPhi + 1) / 2) * STAR_PATCHES_POLAR));
    patches[a * STAR_PATCHES_POLAR + pol]!.push(
      STAR_SPHERE_RADIUS * sinPhi * Math.cos(theta),
      STAR_SPHERE_RADIUS * sinPhi * Math.sin(theta),
      STAR_SPHERE_RADIUS * cosPhi
    );
  }
  sharedStarPatches = patches
    .filter((coords) => coords.length > 0)
    .map((coords) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(coords), 3));
      return geometry;
    });
  return sharedStarPatches;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const PHASE_DAY_FORMAT = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

// The time slider's resolution, in minutes. Transit times are rounded to it
// too, so the thumb and the time shown always agree.
const TIME_STEP = 5;
// Without a location there's no "highest point" to aim for, and the Moon
// barely changes over a day anyway — an evening is when people look up.
const FALLBACK_TIME = 21 * 60;

function calendarDaysBetween(a: Date, b: Date): number {
  const dayA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const dayB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((dayB - dayA) / 86_400_000);
}

function describeNextPhase(from: Date, live: boolean): string {
  const next = nextPrincipalPhase(from);
  const name = next.kind === "full" ? "Full moon" : "New moon";
  const days = calendarDaysBetween(from, next.time);
  if (days === 0) return `${name} at ${TIME_FORMAT.format(next.time)}`;
  if (days === 1 && live) return `${name} tomorrow`;
  return `${name} in ${days} day${days === 1 ? "" : "s"} · ${PHASE_DAY_FORMAT.format(next.time)}`;
}

export interface MoonDetailViewOptions {
  date: Date | null;
  // Minutes after local midnight to show `date` at, as picked on the time
  // slider; null picks for the user (see momentFor). Ignored when live.
  time?: number | null;
  onTimeChange?: (time: number) => void;
  location: LocationState;
  live: boolean;
  onBack: (() => void) | null;
  // Where this moon already is on screen (a grid cell the user just picked);
  // when set, the view flies it from there into place on mount. Absent for
  // any other route in (nav, URL restore, date picker), which just cut.
  from?: MoonOrigin | null;
  // Names where onBack actually goes (worded by main.js); unused without it.
  backLabel?: string;
  onRequestLocation?: () => void;
  // Wired like `location` above, and live-only: aiming a phone at where the
  // Moon stood at noon on some other date would be pointing at nothing.
  orientation?: OrientationState;
  onRequestOrientation?: () => void;
  onStopOrientation?: () => void;
  announce?: (text: string) => void;
  // Live pixel measurement (from chrome-buttons.js) of the safe top offset
  // below the nav pill and icon cluster — both back-button and reset-button
  // sit top-right/top-left and were previously pinned to a fixed CSS `top`
  // that assumed the icon cluster never moves, so a narrow screen wide
  // enough to push the icon cluster below the nav (see chrome-buttons.js's
  // own layoutChromeButtons) made "Reset view" collide with it.
  getTopInset?: () => number;
  // The icon cluster's own row, when it has one (see chrome-buttons.js).
  getIconRow?: () => DOMRect | null;
}

// The single "moon as seen from here" 3D view. `live: true` (the "Today" nav
// entry) recomputes from the real clock every 30s; otherwise it's a static
// snapshot of `date` at a time of day the user can scrub, reached by
// clicking a calendar cell.
//
// `location` is a shared mutable ref ({ coords, status }) owned by main.js —
// status is "idle" | "pending" | "granted" | "denied" | "unsupported".
// Geolocation is never requested automatically; `onRequestLocation` (from
// main.js) is only called when the user clicks the "Use my location" button,
// and views read location.coords/status fresh on every refresh() call, so
// a later grant still takes effect via refreshLocation().
export function createMoonDetailView({
  date,
  time = null,
  onTimeChange,
  location,
  live,
  onBack,
  from = null,
  backLabel = "← Back",
  onRequestLocation,
  orientation,
  onRequestOrientation,
  onStopOrientation,
  announce,
  getTopInset,
  getIconRow,
}: MoonDetailViewOptions): ViewInstance {
  const scene = new THREE.Scene();
  // Far plane clears the star sphere (radius 800) even at maximum zoom-out;
  // near plane is well inside the closest the camera can get.
  const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 1, 3000);
  camera.position.copy(DEFAULT_CAMERA_POSITION);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(2, 60, 60),
    new THREE.MeshPhongMaterial({
      color: 0xffffff,
      map: getColorMap(),
      displacementMap: getDisplacementMap(),
      displacementScale: DISPLACEMENT_SCALE,
      bumpMap: getDisplacementMap(),
      bumpScale: 0.04,
      reflectivity: 0,
      shininess: 0,
    })
  );
  moon.rotation.x = BASE_ROTATION_X;
  moon.rotation.y = BASE_ROTATION_Y;
  scene.add(moon);

  // transparent purely so the star field can fade in behind the arriving
  // moon — the grid it came from has no stars of its own.
  const starsMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.7,
    sizeAttenuation: true,
    transparent: true,
  });
  const stars = new THREE.Group();
  for (const patch of getStarPatches()) stars.add(new THREE.Points(patch, starsMaterial));
  scene.add(stars);

  const sunLight = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
  scene.add(sunLight);

  // Earthshine, replacing what was a dim HemisphereLight: light from the
  // Earth, which from the Moon sits in the viewer's own direction — fixed at
  // +z rather than following the orbiting camera, since that's where Earth
  // is in this scene. Its intensity tracks the phase (earthshineFromPhase,
  // set per frame in update()), and the grid's cell shader applies the same
  // term, so the night side of a given day matches in both views.
  const earthLight = new THREE.DirectionalLight(earthshineColor(), 0);
  earthLight.position.set(0, 0, 100);
  scene.add(earthLight);

  let controls: OrbitControls | null = null;
  let moonState: MoonState | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let root: HTMLElement | null = null;
  let hud: HTMLDivElement | null = null;
  let label: HTMLDivElement | null = null;
  let backButton: HTMLButtonElement | null = null;
  let resetButton: HTMLButtonElement | null = null;
  let locationButton: HTMLButtonElement | null = null;
  let timeInput: HTMLInputElement | null = null;
  let pickedTime = time;
  // Whether anything drawn has changed since update() last reported, beyond
  // what update() can see running itself (a flight, a step, the camera).
  let dirty = true;
  let compass: SkyCompass | null = null;
  // Viewport size, needed to turn the incoming pixel circle into world
  // units; only known from resize(), which main.js calls right after mount.
  let viewWidth = 0;
  let viewHeight = 0;
  // The grid cell this view was opened from, if any: the moon flies out of
  // that circle on mount and back into it on "back". Null for every other
  // route in (nav, URL restore, date picker) and under reduced motion.
  // Cleared by setDate: once the nav arrows have stepped to another day, the
  // moon on screen is no longer the one that flew out of that circle, and the
  // day it *is* now sits in some other cell whose position this view doesn't
  // know — so "back" goes back to being a plain cut.
  let cell: MoonOrigin | null =
    from && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? from : null;
  // The day as its grid cell drew it — at noon, while this view may be showing
  // it at night — so the flight can ease from one to the other.
  let cellVisual: MoonVisual | null = cell && date
    ? computeMoonVisual(localNoon(date.getFullYear(), date.getMonth(), date.getDate()))
    : null;
  // The flight currently running, if any. "in" = arriving from the cell,
  // "out" = shrinking back onto it, after which onBack() hands over.
  // `primed` marks that the start pose has actually been presented once:
  // timing only begins on the frame after that (see advanceFlight).
  let flight: { dir: "in" | "out"; start: number | null; primed: boolean } | null = cell
    ? { dir: "in", start: null, primed: false }
    : null;
  // Viewport the cell circle was measured in. A later resize relaid the grid
  // we'd fly back to, so the stored circle no longer points at that cell —
  // the return flight is dropped rather than aimed at the wrong day.
  let cellViewWidth = 0;
  let cellViewHeight = 0;
  // Where the day currently on screen is coming *from* while a nav-arrow
  // step eases across; null whenever the sky is simply the state it says.
  let stepFrom: MoonState | null = null;
  let stepStart = 0;
  // Rebuilt every frame in update(); kept here so the loop allocates nothing.
  const roll = new THREE.Quaternion();
  const moonEuler = new THREE.Euler();

  // The world-space offset and scale that make the moon project onto exactly
  // the screen circle `origin` describes. Solved on the z = 0 plane the moon
  // already sits on, so the flight is a pure slide-and-grow within that
  // plane — no depth change, hence no lighting or perspective surprises.
  function startPose(origin: MoonOrigin): { x: number; y: number; scale: number } | null {
    if (!viewWidth || !viewHeight) return null;
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAMERA_DEFAULT_DISTANCE;
    const halfWidth = halfHeight * camera.aspect;
    return {
      x: ((origin.x / viewWidth) * 2 - 1) * halfWidth,
      y: -((origin.y / viewHeight) * 2 - 1) * halfHeight,
      scale: ((origin.radius / (viewHeight / 2)) * halfHeight) / SILHOUETTE_RADIUS,
    };
  }

  // How far into this view's own framing the moon is: 0 = sitting on the grid
  // cell, 1 = fully in place — which is also what this returns whenever
  // there's no flight to run, so callers need no special case. A flight
  // starts on its first frame rather than when armed, because the pose
  // depends on the camera aspect/fov that resize() settles after mount.
  function advanceFlight(): number {
    if (!flight || !cell) return 1;
    const pose = startPose(cell);
    if (!pose) {
      // No laid-out viewport to solve against — never the case in practice,
      // since main.js resizes straight after mount. Treat the flight as
      // already over rather than parking the moon off-frame, or, on the way
      // out, swallowing the back press entirely.
      const outbound = flight.dir === "out";
      settleFlight(1);
      if (outbound) queueMicrotask(() => onBack?.());
      return 1;
    }
    if (!flight.primed) {
      // Present the start pose and begin timing on the *next* frame. Mounting
      // this view costs the first render a shader compile and a texture
      // upload — a couple of hundred milliseconds — and counting that as
      // elapsed animation time made the moon skip ~85% of the way in its
      // first visible step instead of flying there.
      flight.primed = true;
      const from = flight.dir === "in" ? 0 : 1;
      applyFlightPose(pose, from);
      return from;
    }
    if (flight.start === null) flight.start = performance.now();
    const t = Math.min(1, (performance.now() - flight.start) / TRANSITION_MS);
    // Arriving eases out: it answers a click, so it starts at full tilt and
    // settles into place. Leaving eases in *and* out — the moon is at rest on
    // screen when "back" is pressed, and an ease-out there let it leap away
    // at maximum speed in the first frame, which read as a jolt.
    const eased = flight.dir === "in" ? easeOutCubic(t) : easeInOutCubic(t);
    const arrived = flight.dir === "in" ? eased : 1 - eased;
    applyFlightPose(pose, arrived);
    if (t >= 1) {
      const outbound = flight.dir === "out";
      settleFlight(arrived);
      // Deferred a task: this runs inside the animation loop's update(), and
      // onBack() disposes this very view — let the frame it's in finish
      // rendering the handover pose first.
      if (outbound) queueMicrotask(() => onBack?.());
    }
    return arrived;
  }

  // 0 = the moon sits on the grid cell, 1 = it's in this view's own framing;
  // everything the grid has no counterpart for fades with it.
  function applyFlightPose(pose: { x: number; y: number; scale: number }, arrived: number) {
    moon.position.set(pose.x * (1 - arrived), pose.y * (1 - arrived), 0);
    moon.scale.setScalar(1 + (pose.scale - 1) * (1 - arrived));
    starsMaterial.opacity = arrived;
    if (hud) hud.style.opacity = `${arrived}`;
    if (backButton) backButton.style.opacity = `${arrived}`;
  }

  function settleFlight(arrived: number) {
    flight = null;
    if (arrived < 1) return; // left on the cell, about to be disposed
    moon.position.set(0, 0, 0);
    moon.scale.setScalar(1);
    starsMaterial.opacity = 1;
    if (hud) hud.style.opacity = "";
    if (backButton) backButton.style.opacity = "";
    // Held off until now: a flight moves the moon, not the camera, so an
    // orbit mid-flight would fight it.
    if (controls) controls.enabled = true;
  }

  // Reverse of the arrival: shrink back onto the cell, then let onBack() mount
  // the grid, where that same cell is drawn exactly where the moon stopped
  // (main.js restores the grid's pan for that reason). Returns false — so
  // "back" is an immediate cut, as it always was — when there's no cell to
  // return to, a flight is already running, the viewport has been resized
  // since (the grid will have relaid out), or the user has orbited/zoomed,
  // which the pose math has no way to fly back from.
  function startReturnFlight(): boolean {
    if (!cell || flight) return false;
    if (viewWidth !== cellViewWidth || viewHeight !== cellViewHeight) return false;
    if (camera.position.distanceTo(DEFAULT_CAMERA_POSITION) > CAMERA_MOVED_EPSILON) return false;
    if (controls) controls.enabled = false;
    flight = { dir: "out", start: null, primed: false };
    return true;
  }

  // Keeps back/reset from colliding with the icon cluster when it's been
  // pushed below the nav (see the comment on getTopInset above) — a no-op
  // when getTopInset isn't supplied, leaving the CSS default `top`.
  function applyChromeInset() {
    if (!getTopInset) return;
    const top = `${getTopInset()}px`;
    if (resetButton) resetButton.style.top = top;
    if (!backButton) return;
    backButton.style.top = top;
    // On a phone the icons drop to a row of their own; back shares it, level
    // with them, rather than stacking a third row — unless its label is long
    // enough to run into them.
    const row = getIconRow?.();
    if (!row) return;
    const back = backButton.getBoundingClientRect();
    if (back.right + BACK_ICON_GAP_PX <= row.left) {
      backButton.style.top = `${row.top + (row.height - back.height) / 2}px`;
    }
  }

  // Nothing to recompute while the tab is hidden; the catch-up refresh on
  // the way back keeps the Moon from sitting at a stale time until the tick.
  function startTicking() {
    if (intervalId === null) intervalId = setInterval(refresh, REFRESH_INTERVAL_MS);
  }
  function stopTicking() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
  function handleVisibilityChange() {
    if (document.hidden) {
      stopTicking();
    } else {
      refresh();
      startTicking();
    }
  }

  // The moment a non-live view shows: the picked time if there is one, else
  // the Moon's highest point that day, else an evening.
  function momentFor(day: Date): { at: Date; highest: boolean } {
    const atMinutes = (minutes: number) =>
      new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
    if (pickedTime !== null) return { at: atMinutes(pickedTime), highest: false };
    const transit = location.coords ? moonTransit(day, location.coords) : null;
    if (!transit) return { at: atMinutes(FALLBACK_TIME), highest: false };
    const minutes = transit.getHours() * 60 + transit.getMinutes();
    const rounded = Math.min(24 * 60 - TIME_STEP, Math.round(minutes / TIME_STEP) * TIME_STEP);
    return { at: atMinutes(rounded), highest: true };
  }

  function refresh({ announceDate = true }: { announceDate?: boolean } = {}) {
    const moment = live ? { at: new Date(), highest: false } : momentFor(date!);
    const at = moment.at;
    moonState = computeMoonState(at, location.coords);
    const current = moonState;
    dirty = true;

    const timeText = TIME_FORMAT.format(at);
    if (timeInput) {
      timeInput.value = String(at.getHours() * 60 + at.getMinutes());
      timeInput.setAttribute("aria-valuetext", moment.highest ? `${timeText}, Moon at its highest` : timeText);
    }

    const phaseLine = `${getPhaseName(current.phase)} · ${current.illuminatedPercent}% illuminated`;
    const lines = [phaseLine, describeNextPhase(at, live)];
    // The line naming the time shown goes last, right above the slider that
    // sets it — the slider has no readout of its own.
    const highest = moment.highest ? " · highest" : "";
    if (current.horizon) {
      if (current.moonrise || current.moonset) {
        // ↑/↓ rather than "Moonrise"/"Moonset" — same info, far less width,
        // which matters a lot once this is stacked 3 lines deep on a phone.
        const day = live ? "today" : "that day";
        const rise = current.moonrise ? `↑ ${TIME_FORMAT.format(current.moonrise)}` : `no rise ${day}`;
        const set = current.moonset ? `↓ ${TIME_FORMAT.format(current.moonset)}` : `no set ${day}`;
        lines.push(`${rise} · ${set}`);
      }
      const alt = current.horizon.altitude;
      const when = live ? "now" : `at ${timeText}${highest}`;
      lines.push(
        alt > 0
          ? `${alt.toFixed(0)}° above ${azimuthToCompass(current.horizon.azimuth)} horizon ${when}`
          : `below horizon ${when}`
      );
    } else {
      if (location.status === "denied") lines.push("Location blocked in your browser");
      else if (location.status === "unsupported") lines.push("Location not supported on this browser");
      if (!live) lines.push(`At ${timeText}`);
    }
    // No date line here: the nav's date label already shows it.
    if (label) label.innerHTML = lines.join("<br>");

    // Live re-refreshes every 30s — only announce on an actual date change
    // (static views) or a fresh location grant, not every routine tick.
    if (!live && announceDate) announce?.(`${DATE_FORMAT.format(date!)}. ${phaseLine}.`);

    if (locationButton) {
      // "denied" still offers a retry (requestLocation asks again, and the
      // browser may answer from its own remembered choice); "unsupported"
      // is the one state with nothing left to try.
      const canAsk =
        location.status === "idle" || location.status === "pending" || location.status === "denied";
      const needsButton = !current.horizon && canAsk;
      locationButton.hidden = !needsButton;
      if (needsButton) {
        locationButton.disabled = location.status === "pending";
        if (location.status === "pending") {
          setIconLabel(locationButton, null, "Locating…");
        } else {
          setIconLabel(locationButton, "pin", location.status === "denied" ? "Try again" : "Use my location");
        }
      }
    }

    // The compass needs a sky position to aim at — the same condition that
    // produced `horizon` above.
    compass?.setAvailable(Boolean(current.horizon));
  }

  return {
    mount(container, renderer) {
      root = container;

      // Stacked in a bottom-anchored flex column so the button and label
      // never overlap regardless of how many lines the label wraps to.
      hud = document.createElement("div");
      hud.className = "moon-hud";
      root.appendChild(hud);

      locationButton = document.createElement("button");
      locationButton.className = "location-button";
      locationButton.hidden = true;
      locationButton.addEventListener("click", () => onRequestLocation?.());
      hud.appendChild(locationButton);

      if (live && orientation) {
        compass = createSkyCompass({
          orientation,
          onRequest: () => onRequestOrientation?.(),
          onStop: () => onStopOrientation?.(),
          announce,
        });
        hud.appendChild(compass.panel);
        hud.appendChild(compass.button);
      }

      label = document.createElement("div");
      label.className = "moon-label";
      hud.appendChild(label);

      if (!live) {
        const timeControl = document.createElement("label");
        timeControl.className = "time-control";
        timeInput = document.createElement("input");
        timeInput.type = "range";
        timeInput.min = "0";
        timeInput.max = String(24 * 60 - TIME_STEP);
        timeInput.step = String(TIME_STEP);
        timeInput.setAttribute("aria-label", "Time of day");
        timeControl.append(timeInput);
        hud.appendChild(timeControl);
        // The date hasn't changed, and the slider announces its own value.
        timeInput.addEventListener("input", () => {
          pickedTime = Number(timeInput!.value);
          refresh({ announceDate: false });
          onTimeChange?.(pickedTime);
        });
      }

      if (onBack) {
        backButton = document.createElement("button");
        backButton.className = "back-button";
        backButton.textContent = backLabel;
        // The return flight calls onBack itself once the moon is back on its
        // cell; a refusal (see startReturnFlight) means go straight back.
        backButton.addEventListener("click", () => {
          if (!startReturnFlight()) onBack();
        });
        root.appendChild(backButton);
      }

      resetButton = document.createElement("button");
      resetButton.className = "reset-button";
      resetButton.textContent = "Reset view";
      resetButton.hidden = true;
      resetButton.addEventListener("click", () => {
        camera.position.copy(DEFAULT_CAMERA_POSITION);
        controls!.update();
        dirty = true;
      });
      root.appendChild(resetButton);
      applyChromeInset();

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.25;
      controls.minDistance = MIN_ZOOM_DISTANCE;
      controls.maxDistance = MAX_ZOOM_DISTANCE;
      // Not update()'s return value: pointer handlers apply a drag inside
      // their own update() call, so the per-frame one can report no change.
      controls.addEventListener("change", () => {
        dirty = true;
      });

      if (flight) {
        controls.enabled = false;
        starsMaterial.opacity = 0;
        hud.style.opacity = "0";
        if (backButton) backButton.style.opacity = "0";
      }

      refresh();
      if (live) {
        startTicking();
        document.addEventListener("visibilitychange", handleVisibilityChange);
      }
    },

    update() {
      const current = moonState!;
      // Read before advancing: the frame a flight or step ends still has to
      // draw its final pose.
      const animating = flight !== null || stepFrom !== null;
      const arrived = advanceFlight();

      // Mid-step, the sky shown is somewhere between the day we were on and
      // the day stepped to; with no step running these are just `current`.
      const step = stepFrom ? easeInOutCubic(Math.min(1, (performance.now() - stepStart) / STEP_MS)) : 1;
      let phase = stepFrom ? blendCycle(stepFrom.phase, current.phase, step, 1) : current.phase;
      let libLon = stepFrom ? THREE.MathUtils.lerp(stepFrom.libLonRad, current.libLonRad, step) : current.libLonRad;
      let libLat = stepFrom ? THREE.MathUtils.lerp(stepFrom.libLatRad, current.libLatRad, step) : current.libLatRad;
      // Mid-flight, the moon is somewhere between its grid cell (that day at
      // noon) and this view's own moment, so it starts out lit and turned
      // exactly as the cell that was clicked, whatever the time shown here.
      if (cellVisual && arrived < 1) {
        phase = blendCycle(cellVisual.phase, phase, arrived, 1);
        libLon = THREE.MathUtils.lerp(cellVisual.libLonRad, libLon, arrived);
        libLat = THREE.MathUtils.lerp(cellVisual.libLatRad, libLat, arrived);
      }
      const tilt = stepFrom
        ? blendCycle(stepFrom.parallacticAngle, current.parallacticAngle, step, Math.PI * 2)
        : current.parallacticAngle;
      if (step >= 1) stepFrom = null;

      // Negated: the parallactic angle is the position angle of the zenith
      // measured from the celestial pole counter-clockwise, and the moon is
      // drawn pole-up, so putting the zenith upright turns the disc the other
      // way — a waxing crescent low in the west ends up smiling at a sun that
      // has already set, rather than lit from the side.
      roll.setFromAxisAngle(VIEW_AXIS, -tilt * arrived);

      // The one place the lighting is applied, so a blended phase and a plain
      // one can't diverge. The sun is rolled with the moon so the terminator
      // turns with the surface; earthshine sits on the view axis itself and
      // the roll leaves it where it is.
      sunLight.position.copy(sunDirFromPhase(phase)).applyQuaternion(roll).multiplyScalar(100);
      earthLight.intensity = earthshineFromPhase(phase);

      // Libration starts from the cell's own (see cellVisual above) rather
      // than from zero, which made the moon visibly tip as it flew. The
      // parallactic roll has no counterpart in the grid — it depends on the
      // observer's horizon, which a calendar cell knows nothing about — so
      // that one eases in from zero over the flight, and is simply 0 until
      // location is granted.
      moonEuler.set(BASE_ROTATION_X + libLat, BASE_ROTATION_Y + libLon, 0);
      moon.quaternion.setFromEuler(moonEuler).premultiply(roll);
      controls!.update();

      // Covers rotation and zoom in one check — any real difference from
      // the default camera position (direction or distance) means there's
      // something for "Reset view" to reset.
      const moved = camera.position.distanceTo(DEFAULT_CAMERA_POSITION) > CAMERA_MOVED_EPSILON;
      if (resetButton) resetButton.hidden = !moved;

      // Redrawn per frame; the Moon's own position moves about a quarter of
      // a degree per minute, which the 30s refresh covers.
      compass?.update(
        current.horizon
          ? { azimuth: current.horizon.azimuth, altitude: current.horizon.altitude }
          : null
      );

      const changed = animating || dirty;
      dirty = false;
      return changed;
    },

    render(renderer) {
      renderer.render(scene, camera);
    },

    resize(width, height) {
      viewWidth = width;
      viewHeight = height;
      // First layout after mount — the viewport the incoming cell circle was
      // measured in (main.js resizes straight after mount).
      if (!cellViewWidth) {
        cellViewWidth = width;
        cellViewHeight = height;
      }
      camera.aspect = width / height;
      camera.fov = computeFov(camera.aspect);
      camera.updateProjectionMatrix();
      applyChromeInset();
    },

    // Called by main.js when the nav arrows step a day while this view stays
    // mounted: recompute for the new date and ease across to it (see STEP_MS)
    // instead of tearing the view down and building another one, which cut
    // between two skies — and rebuilt the star field underneath.
    setDate(next: Date, nextTime: number | null) {
      // Any flight in progress was aimed at the day we're leaving: land it
      // (rather than abandoning the moon mid-slide) and give up the cell.
      if (flight) settleFlight(1);
      cell = null;
      cellVisual = null;
      date = next;
      pickedTime = nextTime;
      const previous = moonState;
      refresh();
      stepFrom = previous && !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? previous : null;
      stepStart = performance.now();
    },

    // Called by main.js when a day step moves where "back" would land — the
    // button names its destination, so the name has to follow it.
    setBackLabel(text: string) {
      if (backButton) backButton.textContent = text;
    },

    // Called by main.js when geolocation resolves after this view already
    // mounted — recomputes with the now-available coordinates.
    refreshLocation: () => refresh(),

    // Called by main.js when the motion-permission prompt is answered.
    refreshOrientation: () => compass?.syncStatus(),

    dispose() {
      stopTicking();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (controls) controls.dispose();
      compass?.dispose();
      if (hud) hud.remove();
      if (backButton) backButton.remove();
      if (resetButton) resetButton.remove();
      moon.geometry.dispose();
      moon.material.dispose();
      // The star geometry is shared across views (getStarPatches) — only
      // this view's material is ours to dispose.
      starsMaterial.dispose();
    },
  };
}
