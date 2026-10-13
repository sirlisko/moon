import type { LocationState } from "./types.js";

export function createLocationState(): {
  location: LocationState;
  requestLocation: (onChange?: () => void) => void;
  restoreLocation: (onChange?: () => void) => void;
} {
  const location: LocationState = { coords: null, status: "idle" };

  function requestLocation(onChange?: () => void) {
    if (location.status === "pending" || location.status === "granted") return;
    if (!navigator.geolocation) {
      location.status = "unsupported";
      onChange?.();
      return;
    }
    location.status = "pending";
    onChange?.();
    navigator.geolocation.getCurrentPosition(
      (position) => {
        location.coords = { lat: position.coords.latitude, lon: position.coords.longitude };
        location.status = "granted";
        onChange?.();
      },
      (error) => {
        location.status = error.code === error.PERMISSION_DENIED ? "denied" : "unavailable";
        onChange?.();
      },
      { timeout: 15000 }
    );
  }

  // Re-requests only when the browser already holds a grant from an earlier
  // visit, so it never raises a prompt the user didn't ask for. Browsers
  // without the Permissions API just keep the "Use my location" button.
  function restoreLocation(onChange?: () => void) {
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((result) => {
        if (result.state === "granted") requestLocation(onChange);
      })
      .catch(() => {});
  }

  return { location, requestLocation, restoreLocation };
}

// iPadOS reports itself as a Mac, so a touchscreen is the tell.
function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// iOS browsers other than Safari start at "Never" in iOS Settings and fail
// without ever prompting, so that's where to send iOS users.
export function locationBlockedMessage(): string {
  return isIOS()
    ? "Location blocked — allow this browser in iOS Settings → Privacy → Location Services"
    : "Location blocked — check browser and device settings";
}
