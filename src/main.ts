import "./style.css";

import * as THREE from "three";
import { MONTH_NAMES } from "./astronomy.js";
import { createMoonDetailView } from "./moon-detail.js";
import { createMoonGridView } from "./moon-grid.js";
import { getColorMap, getDisplacementMap, onColorMapReady, onTextureLoad } from "./textures.js";
import { createLocationState } from "./location.js";
import { createOrientationState } from "./orientation.js";
import { syncUrl, setViewFromUrl } from "./url-state.js";
import { createChromeButtons } from "./chrome-buttons.js";
import { createDatePicker } from "./date-picker.js";
import type { AppState, AppView, GridPan, MoonOrigin, ViewInstance } from "./types.js";

const canvas = document.querySelector<HTMLCanvasElement>("#bg")!;
const renderer = createRenderer();
// Past 2× the extra pixels are invisible at arm's length but still cost fill
// rate — a 3× phone would be drawing 2.25× the pixels of a 2× one.
const MAX_PIXEL_RATIO = 2;
function applyRendererSize() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(window.innerWidth, window.innerHeight);
}
applyRendererSize();
renderer.outputColorSpace = THREE.SRGBColorSpace;

function createRenderer(): THREE.WebGLRenderer {
  try {
    return new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (error) {
    showWebGLUnavailable();
    throw error;
  }
}

// Without WebGL the app has nothing to draw; the page intro (visually hidden
// for crawlers) is the only content left, so it becomes the page.
function showWebGLUnavailable() {
  const intro = document.querySelector<HTMLElement>("#page-intro")!;
  const note = document.createElement("p");
  note.className = "webgl-note";
  note.textContent =
    "This app draws the Moon with WebGL, which your browser has turned off or doesn't support. Try another browser, or turn on hardware acceleration.";
  intro.appendChild(note);
  document.body.classList.add("no-webgl");
}

// Set by anything outside a view that changes what's on screen (a new view,
// a resize, a texture arriving); the views report their own changes from
// update().
let needsRender = true;
onTextureLoad(() => {
  needsRender = true;
});

// Appended to the body further down, after the nav and icon cluster, so tab
// order follows the visual order rather than starting on the HUD button.
const viewContainer = document.createElement("div");
viewContainer.id = "view-overlay";

// Kick the color map off immediately, in parallel with everything
// else, rather than waiting for whichever view happens to mount first —
// and cover the gap with a loading indicator instead of a flash of
// default-gray moon on a slow connection.
getColorMap();
// The displacement map is only used by the detail view, so it used to start
// downloading at the exact moment a day was opened — i.e. during the flight
// out of the calendar cell, which is the one moment that needs a steady frame
// rate. Kicked off here instead; the loading overlay below still waits only
// on the (visually dominant) color map.
getDisplacementMap();
const loadingOverlay = document.createElement("div");
loadingOverlay.id = "loading-overlay";
loadingOverlay.textContent = "Loading the Moon…";
document.body.appendChild(loadingOverlay);
onColorMapReady(() => {
  loadingOverlay.classList.add("loading-overlay-hidden");
  setTimeout(() => loadingOverlay.remove(), 400);
});

// The grid is plain WebGL canvas — invisible to screen readers on its own.
// This visually-hidden live region, shared by every view, is how keyboard
// navigation (moon-grid.js) and date changes (moon-detail.js) get announced.
const liveRegion = document.createElement("div");
liveRegion.className = "sr-only";
liveRegion.setAttribute("role", "status");
liveRegion.setAttribute("aria-live", "polite");
document.body.appendChild(liveRegion);
function announce(text: string) {
  liveRegion.textContent = text;
}

const { location, requestLocation, restoreLocation } = createLocationState();
const { orientation, requestOrientation, stopOrientation } = createOrientationState();

// The title index.html ships, captured before any view overwrites it. The
// today view is what "/" serves, so that's the one a search engine indexes —
// putting the date there instead would replace the page's only keyword-bearing
// title with a string nobody searches for. The nav bar shows the date anyway.
const LANDING_TITLE = document.title;

const NAV_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const now = new Date();
const state: AppState = {
  view: "today",
  year: now.getFullYear(),
  month: now.getMonth(),
  detailDate: null,
  detailTime: null,
  returnTo: null,
};

let activeView: ViewInstance | null = null;
// Set by goToDetail when the user picked a moon off the calendar, and read
// (once) by the next setView — that's the screen circle the detail view
// flies its moon out of. Deliberately not part of AppState: it describes one
// navigation gesture, not restorable app state, so a URL restore or a date
// step lands with a plain cut.
let pendingOrigin: MoonOrigin | null = null;
// Where the grid we left was panned when a detail view was opened from it,
// tagged with which grid that was. Restoring it means "back" returns to the
// part of the calendar the user was actually looking at — and it's what makes
// the detail view's return flight land on the very cell it flew out of.
let returnPan: (GridPan & { view: AppView; year: number; month: number }) | null = null;

const nav = document.createElement("nav");
nav.id = "app-nav";
nav.innerHTML = `
  <button data-view="today">Today</button>
  <button data-view="month">Month</button>
  <button data-view="year">Year</button>
  <span id="grid-nav" hidden>
    <button id="grid-prev" aria-label="Previous">‹</button>
    <button id="grid-label" type="button" title="Jump to a date"></button>
    <button id="grid-next" aria-label="Next">›</button>
  </span>
`;
document.body.appendChild(nav);

const navButtons = nav.querySelectorAll<HTMLButtonElement>("button[data-view]");
const gridNav = nav.querySelector<HTMLElement>("#grid-nav")!;
const gridLabel = nav.querySelector<HTMLButtonElement>("#grid-label")!;
const gridPrev = nav.querySelector<HTMLButtonElement>("#grid-prev")!;
const gridNext = nav.querySelector<HTMLButtonElement>("#grid-next")!;
const datePicker = createDatePicker();

// The Today label is set when the view mounts; a tab left open overnight
// would otherwise keep yesterday's date beside today's moon.
setInterval(() => {
  if (state.view === "today") gridLabel.textContent = NAV_DATE_FORMAT.format(new Date());
}, 60_000);

gridLabel.addEventListener("click", () => {
  if (state.view === "month") {
    datePicker.open({
      anchor: gridLabel,
      mode: "month",
      year: state.year,
      month: state.month,
      onSelect: ({ year, month }) => {
        state.year = year;
        state.month = month;
        setView("month");
      },
    });
  } else if (state.view === "year") {
    datePicker.open({
      anchor: gridLabel,
      mode: "year",
      year: state.year,
      month: 0,
      onSelect: ({ year }) => {
        state.year = year;
        setView("year");
      },
    });
  } else {
    const current = state.view === "detail" ? state.detailDate! : new Date();
    datePicker.open({
      anchor: gridLabel,
      mode: "day",
      year: current.getFullYear(),
      month: current.getMonth(),
      day: current.getDate(),
      onSelect: ({ year, month, day }) => goToDetail(new Date(year, month, day!)),
    });
  }
});

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.view as AppView;
    if (kind === "month" || kind === "year") {
      // Carry the date on screen into the grid rather than jumping to the
      // present; only "Today" has no browsed date of its own to carry.
      if (state.view === "detail" && state.detailDate) {
        state.year = state.detailDate.getFullYear();
        state.month = state.detailDate.getMonth();
      } else if (state.view === "today") {
        const today = new Date();
        state.year = today.getFullYear();
        state.month = today.getMonth();
      }
    }
    setView(kind);
  });
});

gridPrev.addEventListener("click", () => stepNav(-1));
gridNext.addEventListener("click", () => stepNav(1));

function stepNav(delta: number) {
  if (state.view === "month") {
    state.month += delta;
    if (state.month < 0) { state.month = 11; state.year -= 1; }
    if (state.month > 11) { state.month = 0; state.year += 1; }
  } else if (state.view === "year") {
    state.year += delta;
  } else if (state.view === "today") {
    // Stepping away from "today" leaves live mode — it becomes a normal
    // detail view for that date, with "Today" itself as the way back. It
    // keeps the time of day, so the step reads as "same time tomorrow".
    const next = new Date();
    next.setDate(next.getDate() + delta);
    goToDetail(next, null, next.getHours() * 60 + next.getMinutes());
    return;
  } else if (state.view === "detail") {
    const next = new Date(state.detailDate!);
    next.setDate(next.getDate() + delta);
    state.detailDate = next;
    // "Back" names a calendar, not the day we arrived from: once a step has
    // carried us into another month (or year), that's the calendar the day
    // on screen lives in, and the one back has to return to.
    if (state.returnTo && state.returnTo.view !== "today") {
      state.returnTo = {
        view: state.returnTo.view,
        year: next.getFullYear(),
        month: next.getMonth(),
      };
    }
    // The view already on screen can ease across to the new day itself;
    // rebuilding it would cut between two skies. Only its chrome (the date
    // label, and the icon cluster the label's width can displace) and the
    // URL still need updating — the tail of setView, minus the view swap.
    if (activeView?.setDate) {
      activeView.setDate(next, state.detailTime);
      activeView.setBackLabel?.(backLabel());
      syncDetailLabel();
      chrome.layoutChromeButtons();
      activeView.resize(window.innerWidth, window.innerHeight);
      syncUrl(state);
      return;
    }
  }
  setView(state.view);
}

function syncDetailLabel() {
  gridLabel.textContent = NAV_DATE_FORMAT.format(state.detailDate!);
  document.title = `${gridLabel.textContent} Moon Phase`;
}

function backLabel(): string {
  const r = state.returnTo;
  if (!r) return "← Back";
  if (r.view === "today") return "← Back to today";
  if (r.view === "year") return `← Back to ${r.year}`;
  return `← Back to ${MONTH_NAMES[r.month]} ${r.year}`;
}

function goToDetail(date: Date, origin: MoonOrigin | null = null, time: number | null = null) {
  pendingOrigin = origin;
  const pan = activeView?.getPan?.() ?? null;
  returnPan = pan ? { ...pan, view: state.view, year: state.year, month: state.month } : null;
  state.returnTo = { view: state.view, year: state.year, month: state.month };
  state.detailDate = date;
  state.detailTime = time;
  setView("detail");
}

const chrome = createChromeButtons({
  nav,
  announce,
  onToggleRings: (visible) => activeView?.setRingsVisible?.(visible),
  // Calendar/line is a structural layout change (not a live toggle like
  // rings), and only ever visible while month view is active — safe to
  // just rebuild the current view.
  onToggleCalendarMode: () => setView(state.view),
});

document.body.appendChild(viewContainer);

function setView(kind: AppView) {
  const from = pendingOrigin;
  pendingOrigin = null;
  if (activeView) {
    activeView.dispose();
    activeView = null;
  }
  needsRender = true;
  viewContainer.innerHTML = "";
  state.view = kind;

  navButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === kind));
  // A detail view matches none of Today/Month/Year — there the date is
  // what's current, so the label carries the active treatment instead.
  gridLabel.classList.toggle("active", kind === "detail");
  // The rings toggle only means anything on the grid — showing it on
  // Today/detail (where there's nothing to toggle) is just confusing.
  chrome.ringsButton.hidden = kind !== "month" && kind !== "year";
  // Calendar/line only means anything for a single month — year view
  // always uses the strip layout regardless of the stored preference.
  chrome.calendarModeButton.hidden = kind !== "month";

  if (kind === "today") {
    gridNav.hidden = false;
    const today = new Date();
    gridLabel.textContent = NAV_DATE_FORMAT.format(today);
    document.title = LANDING_TITLE;
    activeView = createMoonDetailView({
      date: null,
      location,
      live: true,
      onBack: null,
      onRequestLocation: () => requestLocation(() => activeView?.refreshLocation?.()),
      orientation,
      onRequestOrientation: () => requestOrientation(() => activeView?.refreshOrientation?.()),
      onStopOrientation: stopOrientation,
      announce,
      getTopInset: chrome.getTopInset,
    });
  } else if (kind === "month" || kind === "year") {
    gridNav.hidden = false;
    gridLabel.textContent =
      kind === "month" ? `${MONTH_NAMES[state.month]} ${state.year}` : `${state.year}`;
    document.title = `${gridLabel.textContent} Moon Phases`;
    const months = kind === "month" ? [state.month] : [...Array(12).keys()];
    activeView = createMoonGridView({
      year: state.year,
      months,
      onSelectDate: goToDetail,
      announce,
      showRings: chrome.getShowRings(),
      getTopInset: chrome.getTopInset,
      calendarMode: kind === "month" && chrome.getCalendarMode(),
      initialPan:
        returnPan && returnPan.view === kind && returnPan.year === state.year && returnPan.month === state.month
          ? { x: returnPan.x, y: returnPan.y }
          : null,
    });
  } else if (kind === "detail") {
    gridNav.hidden = false;
    syncDetailLabel();
    activeView = createMoonDetailView({
      date: state.detailDate,
      time: state.detailTime,
      onTimeChange: (time) => {
        state.detailTime = time;
        syncUrl(state);
      },
      location,
      live: false,
      from,
      onBack: () => {
        // returnTo is the one record of where back goes — a day step can have
        // moved it to another month since this view mounted, so the grid
        // coordinates come from there rather than from whatever state.year /
        // state.month were left holding.
        const r = state.returnTo!;
        if (r.view !== "today") {
          state.year = r.year;
          state.month = r.month;
        }
        setView(r.view);
      },
      backLabel: backLabel(),
      onRequestLocation: () => requestLocation(() => activeView?.refreshLocation?.()),
      announce,
      getTopInset: chrome.getTopInset,
      getIconRow: chrome.getIconRow,
    });
  }

  activeView!.mount(viewContainer, renderer);
  // Nav width (grid-nav shown/hidden) and the icon cluster's own width
  // (rings button shown/hidden) both just changed — re-measure and
  // reposition before the view's own resize() reads their boxes (the grid
  // uses them to keep content from scrolling underneath either element).
  chrome.layoutChromeButtons();
  activeView!.resize(window.innerWidth, window.innerHeight);
  syncUrl(state);
}

function animate() {
  requestAnimationFrame(animate);
  if (!activeView) return;
  const changed = activeView.update();
  if (changed || needsRender) {
    activeView.render(renderer);
    needsRender = false;
  }
}

setViewFromUrl(state, setView);
animate();
// Only asks the browser when it has already said yes on an earlier visit, so
// a returning visitor isn't made to tap "Use my location" every time.
restoreLocation(() => activeView?.refreshLocation?.());

window.addEventListener("resize", () => {
  applyRendererSize();
  activeView?.resize(window.innerWidth, window.innerHeight);
  needsRender = true;
});

// ←/→ step a day on the moon views, as the nav arrows do. The grid keeps its
// own arrow keys (focus movement), and so does any focused control.
window.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (state.view !== "today" && state.view !== "detail") return;
  if (datePicker.isOpen()) return;
  if ((e.target as Element).closest("input, textarea, select, [role=dialog]")) return;
  e.preventDefault();
  stepNav(e.key === "ArrowLeft" ? -1 : 1);
});
