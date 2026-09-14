import "./style.css";

import * as THREE from "three";
import { MONTH_NAMES } from "./astronomy.js";
import { createMoonDetailView } from "./moon-detail.js";
import { createMoonGridView } from "./moon-grid.js";
import { getColorMap, onColorMapReady } from "./textures.js";
import { createLocationState } from "./location.js";
import { syncUrl, setViewFromUrl } from "./url-state.js";
import { createChromeButtons } from "./chrome-buttons.js";
import { createDatePicker } from "./date-picker.js";
import type { AppState, AppView, ViewInstance } from "./types.js";

const canvas = document.querySelector<HTMLCanvasElement>("#bg")!;
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const viewContainer = document.createElement("div");
viewContainer.id = "view-overlay";
document.body.appendChild(viewContainer);

// Kick the color map off immediately, in parallel with everything
// else, rather than waiting for whichever view happens to mount first —
// and cover the gap with a loading indicator instead of a flash of
// default-gray moon on a slow connection.
getColorMap();
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

const { location, requestLocation } = createLocationState();

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
  returnTo: null,
};

let activeView: ViewInstance | null = null;

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
    const today = new Date();
    if (kind === "month" || kind === "year") {
      state.year = today.getFullYear();
      state.month = today.getMonth();
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
    // detail view for that date, with "Today" itself as the way back.
    const next = new Date();
    next.setDate(next.getDate() + delta);
    goToDetail(next);
    return;
  } else if (state.view === "detail") {
    const next = new Date(state.detailDate!);
    next.setDate(next.getDate() + delta);
    state.detailDate = next;
  }
  setView(state.view);
}

function goToDetail(date: Date) {
  state.returnTo = { view: state.view, year: state.year, month: state.month };
  state.detailDate = date;
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

function setView(kind: AppView) {
  if (activeView) {
    activeView.dispose();
    activeView = null;
  }
  viewContainer.innerHTML = "";
  state.view = kind;

  navButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === kind));
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
    document.title = `Today, ${gridLabel.textContent} · Moon`;
    activeView = createMoonDetailView({
      date: null,
      location,
      live: true,
      onBack: null,
      onRequestLocation: () => requestLocation(() => activeView?.refreshLocation?.()),
      announce,
      getTopInset: chrome.getTopInset,
    });
  } else if (kind === "month" || kind === "year") {
    gridNav.hidden = false;
    gridLabel.textContent =
      kind === "month" ? `${MONTH_NAMES[state.month]} ${state.year}` : `${state.year}`;
    document.title = `${gridLabel.textContent} · Moon`;
    const months = kind === "month" ? [state.month] : [...Array(12).keys()];
    activeView = createMoonGridView({
      year: state.year,
      months,
      onSelectDate: goToDetail,
      announce,
      showRings: chrome.getShowRings(),
      getTopInset: chrome.getTopInset,
      calendarMode: kind === "month" && chrome.getCalendarMode(),
    });
  } else if (kind === "detail") {
    gridNav.hidden = false;
    gridLabel.textContent = NAV_DATE_FORMAT.format(state.detailDate!);
    document.title = `${gridLabel.textContent} · Moon`;
    activeView = createMoonDetailView({
      date: state.detailDate,
      location,
      live: false,
      onBack: () => setView(state.returnTo!.view),
      onRequestLocation: () => requestLocation(() => activeView?.refreshLocation?.()),
      announce,
      getTopInset: chrome.getTopInset,
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
  activeView?.update();
  activeView?.render(renderer);
}

setViewFromUrl(state, setView);
animate();

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  activeView?.resize(window.innerWidth, window.innerHeight);
});
