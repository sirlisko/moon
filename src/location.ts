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
      () => {
        location.status = "denied";
        onChange?.();
      }
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
