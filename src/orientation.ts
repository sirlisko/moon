// Device-compass state for the sky-compass overlay, shaped like location.js:
// a shared mutable ref the views read fresh, plus a request function that
// must be reached synchronously from a click — DeviceOrientationEvent's
// requestPermission refuses a request made from a promise or a timer.

export type OrientationStatus =
  | "idle"
  | "pending"
  | "granted"
  | "denied"
  | "unsupported"
  | "insecure";

// Where the *back* of the phone points — the direction you'd sight along
// holding the screen up between you and the sky — plus how the screen itself
// is turned about that line. The sight line alone can't say which way is up
// on screen, and the two move independently: rolling the phone to landscape
// leaves the sight line exactly where it was.
export interface DeviceDirection {
  azimuth: number; // degrees clockwise from north
  altitude: number; // degrees above the horizon
  roll: number; // degrees the screen is turned about the sight line, 0 = screen-up level
}

// An offset from the sight line as it lands on the screen: degrees right and
// up the *screen's* axes, with the true angle between the two directions.
export interface ScreenOffset {
  right: number;
  up: number;
  separation: number;
}

interface EarthVector {
  east: number;
  north: number;
  up: number;
}

export interface OrientationState {
  direction: DeviceDirection | null;
  status: OrientationStatus;
  active: boolean;
}

// Android fires this one with a north-referenced `alpha`; plain
// "deviceorientation" there is referenced to wherever the phone happened to
// be when the listener attached, which is the classic bug that makes these
// overlays point confidently at nothing. iOS is the other way round — no
// usable `alpha`, but webkitCompassHeading on the plain event — so both are
// attached and readings carrying no bearing are dropped.
const ABSOLUTE_EVENT = "deviceorientationabsolute";

// Desktops accept the listener and then never fire an event; waiting a beat
// for a reading beats sniffing the user agent.
const NO_READING_TIMEOUT_MS = 3000;

// Neither is in lib.dom. requestPermission is no longer an iOS marker —
// Chromium has it too — so don't feature-detect the platform off it.
interface CompassOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
}
type PermissionGatedConstructor = {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
};

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

// Signed shortest turn from `from` to `to`, in [-180, 180) — positive is
// clockwise, and an exact half turn resolves to the left.
export function angleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

// The W3C angles describe R = Rz(alpha)·Rx(beta)·Ry(gamma), taking device
// coordinates into the earth frame (x east, y north, z up). Device +z comes
// out of the front of the screen, so R's third column is where the screen
// faces and its negation is the sight line. Collapsed to the two pieces the
// viewfinder needs: that column, and the roll taken from R's third row.
export function deviceDirection(alpha: number, beta: number, gamma: number): DeviceDirection {
  const a = toRad(alpha);
  const b = toRad(beta);
  const g = toRad(gamma);

  const east = -(Math.cos(a) * Math.sin(g) + Math.sin(a) * Math.sin(b) * Math.cos(g));
  const north = -(Math.sin(a) * Math.sin(g) - Math.cos(a) * Math.sin(b) * Math.cos(g));
  const up = -(Math.cos(b) * Math.cos(g));

  // Roll compares the two axes' share of world up: the third row of R, which
  // is where the device's own x and y axes stand relative to the vertical.
  // Alpha drops out — turning on the spot doesn't roll the screen.
  return {
    azimuth: (toDeg(Math.atan2(east, north)) + 360) % 360,
    altitude: toDeg(Math.asin(Math.min(1, Math.max(-1, up)))),
    roll: (toDeg(Math.atan2(-Math.cos(b) * Math.sin(g), Math.sin(b))) + 360) % 360,
  };
}

const dot = (a: EarthVector, b: EarthVector) => a.east * b.east + a.north * b.north + a.up * b.up;

function unitVector(azimuth: number, altitude: number): EarthVector {
  const az = toRad(azimuth);
  const alt = toRad(altitude);
  return {
    east: Math.sin(az) * Math.cos(alt),
    north: Math.cos(az) * Math.cos(alt),
    up: Math.sin(alt),
  };
}

// Where a sky position falls on a viewfinder aimed along `view`.
//
// A difference of bearings is not an angle in the sky — at 60° up, 20° of
// azimuth is only 10° of arc — so the offset is measured as a true angular
// separation and then laid out around the sight line: `separation` is how far
// off the target is, and the direction it lies in is turned by the phone's
// roll, which is what makes the dial agree with the sky in landscape.
export function screenOffset(view: DeviceDirection, azimuth: number, altitude: number): ScreenOffset {
  const target = unitVector(azimuth, altitude);
  const sight = unitVector(view.azimuth, view.altitude);
  // The level frame around the sight line: `right` stays horizontal whatever
  // the phone is doing, `up` completes it. Both survive a sight line straight
  // up or down, where azimuth itself stops meaning anything.
  const az = toRad(view.azimuth);
  const right: EarthVector = { east: Math.cos(az), north: -Math.sin(az), up: 0 };
  const up: EarthVector = {
    east: right.north * sight.up - right.up * sight.north,
    north: right.up * sight.east - right.east * sight.up,
    up: right.east * sight.north - right.north * sight.east,
  };

  const separation = toDeg(Math.acos(Math.min(1, Math.max(-1, dot(target, sight)))));
  const bearing = Math.atan2(dot(target, right), dot(target, up)) + toRad(view.roll);
  return {
    right: separation * Math.sin(bearing),
    up: separation * Math.cos(bearing),
    separation,
  };
}

// Heading runs clockwise from north and alpha counter-clockwise, so
// 360 - heading converts iOS's reading into the angle the matrix above
// expects. Null means this event carries no compass bearing at all.
function earthReferencedAlpha(event: CompassOrientationEvent, fromAbsoluteEvent: boolean): number | null {
  if (typeof event.webkitCompassHeading === "number" && !Number.isNaN(event.webkitCompassHeading)) {
    return (360 - event.webkitCompassHeading) % 360;
  }
  if ((fromAbsoluteEvent || event.absolute) && typeof event.alpha === "number") {
    return event.alpha;
  }
  return null;
}

function orientationSupported(): boolean {
  if (typeof window.DeviceOrientationEvent === "undefined") return false;
  // Desktop Firefox and Chromium both expose the entire API — constructor,
  // handlers, even requestPermission — and then never fire an event, so none
  // of that is evidence of a compass. A coarse pointer is the closest
  // capability signal for "phone or tablet" without sniffing the user agent;
  // `any-pointer` rather than `pointer` so an iPad with a trackpad attached
  // still counts. The no-reading timeout backstops what this gets wrong.
  if (!window.matchMedia("(any-pointer: coarse)").matches) return false;
  return (
    typeof (window.DeviceOrientationEvent as unknown as PermissionGatedConstructor).requestPermission ===
      "function" ||
    `on${ABSOLUTE_EVENT}` in window ||
    "ondeviceorientation" in window
  );
}

export function createOrientationState(): {
  orientation: OrientationState;
  requestOrientation: (onChange?: () => void) => void;
  stopOrientation: () => void;
} {
  // Settled once, up front, so the overlay's toggle can stay hidden on a
  // desktop instead of appearing and then retiring 3s after the first tap.
  const orientation: OrientationState = {
    direction: null,
    status: orientationSupported() ? "idle" : "unsupported",
    active: false,
  };

  let notify: (() => void) | undefined;
  let readingTimer: ReturnType<typeof setTimeout> | null = null;
  let listening = false;

  function handleEvent(event: Event, fromAbsoluteEvent: boolean) {
    const reading = event as CompassOrientationEvent;
    const alpha = earthReferencedAlpha(reading, fromAbsoluteEvent);
    if (alpha === null || reading.beta === null || reading.gamma === null) return;

    if (readingTimer !== null) {
      clearTimeout(readingTimer);
      readingTimer = null;
    }
    orientation.direction = deviceDirection(alpha, reading.beta, reading.gamma);
    if (orientation.status !== "granted") {
      orientation.status = "granted";
      notify?.();
    }
  }

  const onAbsolute = (event: Event) => handleEvent(event, true);
  const onRelative = (event: Event) => handleEvent(event, false);

  function attach() {
    if (listening) return;
    listening = true;
    window.addEventListener(ABSOLUTE_EVENT, onAbsolute);
    window.addEventListener("deviceorientation", onRelative);
    readingTimer = setTimeout(() => {
      readingTimer = null;
      if (orientation.status === "granted") return;
      detach();
      orientation.status = "unsupported";
      orientation.active = false;
      notify?.();
    }, NO_READING_TIMEOUT_MS);
  }

  function detach() {
    if (readingTimer !== null) {
      clearTimeout(readingTimer);
      readingTimer = null;
    }
    if (!listening) return;
    listening = false;
    window.removeEventListener(ABSOLUTE_EVENT, onAbsolute);
    window.removeEventListener("deviceorientation", onRelative);
  }

  function requestOrientation(onChange?: () => void) {
    notify = onChange;
    if (orientation.active) return;

    if (!orientationSupported()) {
      orientation.status = "unsupported";
      notify?.();
      return;
    }
    // Sensors need a secure context, and on plain http the iOS prompt never
    // appears — which is exactly the dev server opened over the LAN.
    if (!window.isSecureContext) {
      orientation.status = "insecure";
      notify?.();
      return;
    }

    orientation.active = true;
    const requestPermission = (window.DeviceOrientationEvent as unknown as PermissionGatedConstructor)
      .requestPermission;
    if (typeof requestPermission !== "function") {
      orientation.status = "pending";
      attach();
      notify?.();
      return;
    }

    orientation.status = "pending";
    notify?.();
    requestPermission().then(
      (result) => {
        if (!orientation.active) return;
        if (result === "granted") {
          attach();
        } else {
          orientation.status = "denied";
          orientation.active = false;
        }
        notify?.();
      },
      () => {
        if (!orientation.active) return;
        orientation.status = "denied";
        orientation.active = false;
        notify?.();
      }
    );
  }

  // Keeps `status`: a permission granted this session shouldn't re-prompt
  // when the view is mounted again.
  function stopOrientation() {
    detach();
    orientation.active = false;
    orientation.direction = null;
  }

  return { orientation, requestOrientation, stopOrientation };
}
