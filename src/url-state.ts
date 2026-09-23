import { localNoon } from "./astronomy.js";
import type { AppState, AppView } from "./types.js";

function formatISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// "HH:MM" → minutes after midnight, or null for anything else.
function parseTime(value: string | null): number | null {
  const match = value?.match(/^(\d{2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? h * 60 + m : null;
}

// Keeps the URL a shareable/bookmarkable reflection of `state`. Uses
// `window.location` explicitly — a bare `location` would resolve to
// main.js's geolocation state object instead, wherever this is called from.
export function syncUrl(state: AppState): void {
  const params = new URLSearchParams();
  if (state.view === "month") {
    params.set("view", "month");
    params.set("year", String(state.year));
    params.set("month", String(state.month + 1));
  } else if (state.view === "year") {
    params.set("view", "year");
    params.set("year", String(state.year));
  } else if (state.view === "detail" && state.detailDate) {
    params.set("view", "detail");
    params.set("date", formatISODate(state.detailDate));
    if (state.detailTime !== null) params.set("time", formatTime(state.detailTime));
  }
  // "today" needs no params — it's the default landing state.
  // ":" is legal in a query string; left encoded, a shared time reads "06%3A30".
  const qs = params.toString().replace(/%3A/g, ":");
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

// Restores state from a shared/bookmarked URL on load, mutating `state` in
// place and calling `setView` for whichever view it resolves to, falling
// back to "today" for anything missing or malformed.
export function setViewFromUrl(state: AppState, setView: (view: AppView) => void): void {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const dateParam = params.get("date");

  if (view === "detail" && dateParam) {
    const [y, m, d] = dateParam.split("-").map(Number);
    if (y && m && d && m >= 1 && m <= 12 && d >= 1) {
      state.detailDate = localNoon(y, m - 1, d);
      state.detailTime = parseTime(params.get("time"));
      // No natural "came from" grid for a direct link — send it to that
      // date's month view. onBack only reads state.returnTo.view and
      // relies on state.year/month already being right (true for normal
      // in-app navigation, since they're otherwise untouched while in
      // "detail" — so they must be set explicitly here too).
      state.year = y;
      state.month = m - 1;
      state.returnTo = { view: "month", year: y, month: m - 1 };
      setView("detail");
      return;
    }
  } else if (view === "month") {
    const y = Number(params.get("year"));
    const m = Number(params.get("month"));
    if (y && m >= 1 && m <= 12) {
      state.year = y;
      state.month = m - 1;
      setView("month");
      return;
    }
  } else if (view === "year") {
    const y = Number(params.get("year"));
    if (y) {
      state.year = y;
      setView("year");
      return;
    }
  }
  setView("today");
}
