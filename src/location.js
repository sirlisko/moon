export function createLocationState() {
  const location = { coords: null, status: "idle" }; // idle | pending | granted | denied | unsupported

  function requestLocation(onChange) {
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
