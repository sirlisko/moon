import { angleDelta } from "./orientation.js";
import type { OrientationState } from "./orientation.js";
import { azimuthToCompass } from "./astronomy.js";
import { setIconLabel } from "./icons.js";
import type { IconName } from "./icons.js";

// A heads-up viewfinder rather than a map-style compass rose: the centre of
// the dial is wherever the back of the phone points, and the Moon marker
// sits at its offset from there. That reading holds however the phone is
// rotated in your hands — the direction the back faces doesn't change when
// the screen flips to landscape — so unlike a north-up rose this needs no
// screen-orientation correction anywhere.

// The dial shrinks on small phones (see style.css), so its working radius is
// measured rather than hard-coded; the inset keeps a rim-pinned marker
// inside the ring instead of hanging off its edge.
const MARKER_INSET_PX = 14;
const DEGREES_AT_RIM = 45;
const ALIGNED_DEGREES = 8;
// Phone magnetometers are noisy; without this the marker visibly shivers.
const SMOOTHING = 0.18;

export interface SkyTarget {
  azimuth: number;
  altitude: number;
}

export interface SkyCompassOptions {
  orientation: OrientationState;
  // Both must be reached synchronously from the toggle's click handler —
  // see the gesture note in orientation.js.
  onRequest: () => void;
  onStop: () => void;
  announce?: (text: string) => void;
}

export interface SkyCompass {
  button: HTMLButtonElement;
  panel: HTMLElement;
  // Driven from the view's animation loop rather than from sensor events, so
  // the marker moves at frame rate and smoothing is applied at a steady one.
  update(target: SkyTarget | null): void;
  syncStatus(): void;
  setAvailable(available: boolean): void;
  dispose(): void;
}

export function createSkyCompass({
  orientation,
  onRequest,
  onStop,
  announce,
}: SkyCompassOptions): SkyCompass {
  let available = false;
  let smoothAzimuth: number | null = null;
  let smoothAltitude = 0;
  let wasAligned = false;

  const button = document.createElement("button");
  button.className = "location-button sky-compass-button";
  button.hidden = true;

  const panel = document.createElement("div");
  panel.className = "sky-compass";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="sky-compass-ring">
      <div class="sky-compass-crosshair"></div>
      <div class="sky-compass-north">N</div>
      <div class="sky-compass-marker">🌕</div>
    </div>
    <div class="sky-compass-hint"></div>
    <div class="sky-compass-caveat">Hold the phone up like a camera · ±10°</div>
  `;
  const ring = panel.querySelector<HTMLElement>(".sky-compass-ring")!;
  const marker = panel.querySelector<HTMLElement>(".sky-compass-marker")!;
  const north = panel.querySelector<HTMLElement>(".sky-compass-north")!;
  const hint = panel.querySelector<HTMLElement>(".sky-compass-hint")!;

  button.addEventListener("click", () => {
    if (orientation.active) {
      onStop();
      announce?.("Compass off.");
    } else {
      smoothAzimuth = null;
      wasAligned = false;
      onRequest();
    }
    syncStatus();
  });

  function buttonLabel(): [IconName | null, string] {
    // Pending outranks active: between tapping and answering the browser's
    // motion prompt the compass is switched on but has nothing to show, and
    // "Hide compass" on a disabled button reads as a bug.
    if (orientation.status === "pending") return [null, "Starting compass…"];
    if (orientation.active) return [null, "Hide compass"];
    if (orientation.status === "denied") return ["compass", "Motion access blocked"];
    if (orientation.status === "insecure") return ["compass", "Needs a secure connection"];
    return ["compass", "Point me at the Moon"];
  }

  function syncStatus() {
    // Nothing left to try, so the control retires rather than inviting a tap
    // that can't work.
    const dead = orientation.status === "unsupported";
    button.hidden = !available || dead;
    button.disabled = orientation.status === "pending";
    setIconLabel(button, ...buttonLabel());
    button.setAttribute("aria-pressed", String(orientation.active));
    panel.hidden = !available || !orientation.active;
    if (panel.hidden) ring.classList.remove("is-aligned");
  }

  // Pins to the rim (dimmed, via the class) once it's off the dial entirely.
  function place(element: HTMLElement, offsetRight: number, offsetUp: number) {
    const radius = Math.max(1, ring.clientWidth / 2 - MARKER_INSET_PX);
    const scale = radius / DEGREES_AT_RIM;
    let x = offsetRight * scale;
    let y = -offsetUp * scale;
    const distance = Math.hypot(x, y);
    const beyondRim = distance > radius;
    if (beyondRim && distance > 0) {
      x = (x / distance) * radius;
      y = (y / distance) * radius;
    }
    element.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px))`;
    element.classList.toggle("is-beyond-rim", beyondRim);
  }

  function update(target: SkyTarget | null) {
    if (panel.hidden) return;

    const direction = orientation.direction;
    if (!direction || !target) {
      hint.textContent = direction ? "" : "Waving the phone in a figure-8 helps it calibrate";
      return;
    }

    // Smoothed the short way round, so the dial doesn't spin most of a turn
    // when the reading crosses north.
    if (smoothAzimuth === null) {
      smoothAzimuth = direction.azimuth;
      smoothAltitude = direction.altitude;
    } else {
      smoothAzimuth = (smoothAzimuth + angleDelta(smoothAzimuth, direction.azimuth) * SMOOTHING + 360) % 360;
      smoothAltitude += (direction.altitude - smoothAltitude) * SMOOTHING;
    }

    // Vertical offsets are measured against the phone's own pitch, so they
    // only mean anything when there's something to sight along. Under the
    // horizon the dial drops to a pure bearing compass rather than telling
    // you to tilt — the tilt figure would be a correction to how you happen
    // to be holding the phone, not a direction to look.
    const bearingOnly = target.altitude < 0;
    const rightOfCentre = angleDelta(smoothAzimuth, target.azimuth);
    const aboveCentre = bearingOnly ? 0 : target.altitude - smoothAltitude;
    place(marker, rightOfCentre, aboveCentre);
    place(north, angleDelta(smoothAzimuth, 0), bearingOnly ? 0 : -smoothAltitude);
    ring.classList.toggle("is-bearing-only", bearingOnly);

    const separation = bearingOnly ? Math.abs(rightOfCentre) : Math.hypot(rightOfCentre, aboveCentre);
    const aligned = separation <= ALIGNED_DEGREES;
    ring.classList.toggle("is-aligned", aligned);

    const turn = `${Math.abs(rightOfCentre).toFixed(0)}° ${rightOfCentre >= 0 ? "right" : "left"}`;
    if (bearingOnly) {
      hint.textContent = aligned ? "That way · below the horizon" : `${turn} · below the horizon`;
    } else if (aligned) {
      hint.textContent = "The Moon is right there";
    } else {
      const tilt = `${Math.abs(aboveCentre).toFixed(0)}° ${aboveCentre >= 0 ? "up" : "down"}`;
      hint.textContent = `${turn} · ${tilt}`;
    }

    // The crossing only: the hint text changes every frame and would make a
    // live region unusable.
    if (aligned !== wasAligned) {
      wasAligned = aligned;
      if (aligned) {
        announce?.(bearingOnly ? "Facing the Moon, below the horizon." : "Pointing at the Moon.");
      } else {
        const where = azimuthToCompass(target.azimuth);
        announce?.(
          bearingOnly
            ? `Moon is ${where}, ${Math.abs(target.altitude).toFixed(0)} degrees below the horizon.`
            : `Moon is ${where}, ${target.altitude.toFixed(0)} degrees up.`
        );
      }
    }
  }

  // The dial needs a sky position to aim at, so the view calls this as
  // location resolves (or doesn't).
  function setAvailable(next: boolean) {
    available = next;
    if (!available && orientation.active) onStop();
    syncStatus();
  }

  return {
    button,
    panel,
    update,
    syncStatus,
    setAvailable,
    dispose() {
      if (orientation.active) onStop();
      button.remove();
      panel.remove();
    },
  };
}
