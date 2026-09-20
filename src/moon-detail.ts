import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { computeMoonState, getPhaseName, azimuthToCompass } from "./astronomy.js";
import type { MoonState } from "./astronomy.js";
import { getColorMap, getDisplacementMap } from "./textures.js";
import { sunDirFromPhase } from "./moon-shader.js";
import { createSkyCompass } from "./sky-compass.js";
import type { SkyCompass } from "./sky-compass.js";
import type { OrientationState } from "./orientation.js";
import type { LocationState, ViewInstance } from "./types.js";

const BASE_ROTATION_Y = Math.PI * 1.54;
const BASE_ROTATION_X = Math.PI * 0.02;
const REFRESH_INTERVAL_MS = 30000;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 0, 5);
const CAMERA_DEFAULT_DISTANCE = DEFAULT_CAMERA_POSITION.length();
// Keeps the camera from crossing into the moon's surface (radius 2, plus a
// little headroom for the displacement map) when zooming in, and from
// zooming out so far the Moon shrinks to nothing in the starfield.
const MIN_ZOOM_DISTANCE = 2.5;
const MAX_ZOOM_DISTANCE = 20;

const MOON_RADIUS = 2;
const DEFAULT_FOV = 75;
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

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export interface MoonDetailViewOptions {
  date: Date | null;
  location: LocationState;
  live: boolean;
  onBack: (() => void) | null;
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
}

// The single "moon as seen from here" 3D view. `live: true` (the "Today" nav
// entry) recomputes from the real clock every 30s; otherwise it's a static
// snapshot at local noon on `date`, reached by clicking a calendar cell.
//
// `location` is a shared mutable ref ({ coords, status }) owned by main.js —
// status is "idle" | "pending" | "granted" | "denied" | "unsupported".
// Geolocation is never requested automatically; `onRequestLocation` (from
// main.js) is only called when the user clicks the "Use my location" button,
// and views read location.coords/status fresh on every refresh() call, so
// a later grant still takes effect via refreshLocation().
export function createMoonDetailView({
  date,
  location,
  live,
  onBack,
  backLabel = "← Back",
  onRequestLocation,
  orientation,
  onRequestOrientation,
  onStopOrientation,
  announce,
  getTopInset,
}: MoonDetailViewOptions): ViewInstance {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, 0.1, 1000);
  camera.position.copy(DEFAULT_CAMERA_POSITION);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(2, 60, 60),
    new THREE.MeshPhongMaterial({
      color: 0xffffff,
      map: getColorMap(),
      displacementMap: getDisplacementMap(),
      displacementScale: 0.06,
      bumpMap: getDisplacementMap(),
      bumpScale: 0.04,
      reflectivity: 0,
      shininess: 0,
    })
  );
  moon.rotation.x = BASE_ROTATION_X;
  moon.rotation.y = BASE_ROTATION_Y;
  scene.add(moon);

  const starPositions = new Float32Array(8000 * 3);
  for (let i = 0; i < 8000; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = 800;
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, sizeAttenuation: true })
  );
  scene.add(stars);

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.015);
  hemiLight.color.setHSL(0.6, 1, 0.6);
  hemiLight.groundColor.setHSL(0.095, 1, 0.75);
  scene.add(hemiLight);

  let controls: OrbitControls | null = null;
  let moonState: MoonState | null = null;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let root: HTMLElement | null = null;
  let hud: HTMLDivElement | null = null;
  let label: HTMLDivElement | null = null;
  let backButton: HTMLButtonElement | null = null;
  let resetButton: HTMLButtonElement | null = null;
  let locationButton: HTMLButtonElement | null = null;
  let compass: SkyCompass | null = null;

  // Keeps back/reset from colliding with the icon cluster when it's been
  // pushed below the nav (see the comment on getTopInset above) — a no-op
  // when getTopInset isn't supplied, leaving the CSS default `top`.
  function applyChromeInset() {
    if (!getTopInset) return;
    const top = `${getTopInset()}px`;
    if (backButton) backButton.style.top = top;
    if (resetButton) resetButton.style.top = top;
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

  function applyMoonState(state: MoonState) {
    moonState = state;
    const sunDir = sunDirFromPhase(state.phase);
    sunLight.position.copy(sunDir).multiplyScalar(100);
  }

  function refresh() {
    const at = live ? new Date() : date!;
    applyMoonState(computeMoonState(at, location.coords));
    const current = moonState!;

    const phaseLine = `${getPhaseName(current.phase)} · ${current.illuminatedPercent}% illuminated`;
    const lines = [phaseLine];
    if (current.horizon) {
      const alt = current.horizon.altitude;
      const when = live ? "now" : "at noon";
      lines.push(
        alt > 0
          ? `${alt.toFixed(0)}° above ${azimuthToCompass(current.horizon.azimuth)} horizon ${when}`
          : `below horizon ${when}`
      );
      if (current.moonrise || current.moonset) {
        // ↑/↓ rather than "Moonrise"/"Moonset" — same info, far less width,
        // which matters a lot once this is stacked 3 lines deep on a phone.
        const rise = current.moonrise ? `↑ ${TIME_FORMAT.format(current.moonrise)}` : "no rise today";
        const set = current.moonset ? `↓ ${TIME_FORMAT.format(current.moonset)}` : "no set today";
        lines.push(`${rise} · ${set}`);
      }
    } else if (location.status === "denied") {
      lines.push("Location blocked in your browser");
    } else if (location.status === "unsupported") {
      lines.push("Location not supported on this browser");
    }
    // No date line here: the nav's date label already shows it.
    if (label) label.innerHTML = lines.join("<br>");

    // Live re-refreshes every 30s — only announce on an actual date change
    // (static views) or a fresh location grant, not every routine tick.
    if (!live) announce?.(`${DATE_FORMAT.format(date!)}. ${phaseLine}.`);

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
        locationButton.textContent =
          location.status === "pending"
            ? "Locating…"
            : location.status === "denied"
              ? "📍 Try again"
              : "📍 Use my location";
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

      if (onBack) {
        backButton = document.createElement("button");
        backButton.className = "back-button";
        backButton.textContent = backLabel;
        backButton.addEventListener("click", onBack);
        root.appendChild(backButton);
      }

      resetButton = document.createElement("button");
      resetButton.className = "reset-button";
      resetButton.textContent = "Reset view";
      resetButton.hidden = true;
      resetButton.addEventListener("click", () => {
        camera.position.copy(DEFAULT_CAMERA_POSITION);
        controls!.update();
      });
      root.appendChild(resetButton);
      applyChromeInset();

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.25;
      controls.minDistance = MIN_ZOOM_DISTANCE;
      controls.maxDistance = MAX_ZOOM_DISTANCE;

      refresh();
      if (live) {
        startTicking();
        document.addEventListener("visibilitychange", handleVisibilityChange);
      }
    },

    update() {
      const current = moonState!;
      moon.rotation.y = BASE_ROTATION_Y + current.libLonRad;
      moon.rotation.x = BASE_ROTATION_X + current.libLatRad;
      moon.rotation.z = current.parallacticAngle;
      controls!.update();

      // Covers rotation and zoom in one check — any real difference from
      // the default camera position (direction or distance) means there's
      // something for "Reset view" to reset.
      const moved = camera.position.distanceTo(DEFAULT_CAMERA_POSITION) > 0.01;
      if (resetButton) resetButton.hidden = !moved;

      // Redrawn per frame; the Moon's own position moves about a quarter of
      // a degree per minute, which the 30s refresh covers.
      compass?.update(
        current.horizon
          ? { azimuth: current.horizon.azimuth, altitude: current.horizon.altitude }
          : null
      );
    },

    render(renderer) {
      renderer.render(scene, camera);
    },

    resize(width, height) {
      camera.aspect = width / height;
      camera.fov = computeFov(camera.aspect);
      camera.updateProjectionMatrix();
      applyChromeInset();
    },

    // Called by main.js when geolocation resolves after this view already
    // mounted — recomputes with the now-available coordinates.
    refreshLocation: refresh,

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
      starGeometry.dispose();
      stars.material.dispose();
    },
  };
}
