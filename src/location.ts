import type { LocationState } from "./types.js";

export function createLocationState(): {
  location: LocationState;
  requestLocation: (onChange?: () => void) => void;
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

  return { location, requestLocation };
}
