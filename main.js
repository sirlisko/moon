import "./style.css";

import * as THREE from "three";
import { MONTH_NAMES } from "./astronomy.js";
import { createMoonDetailView } from "./moon-detail.js";
import { createMoonGridView } from "./moon-grid.js";

const canvas = document.querySelector("#bg");
const renderer = new THREE.WebGLRenderer({ canvas });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;

const viewContainer = document.createElement("div");
viewContainer.id = "view-overlay";
document.body.appendChild(viewContainer);

// Shared, mutable — geolocation is only requested when the user clicks
// "Use my location" (see requestLocation below), never automatically.
// Views read location.coords/status fresh each refresh, so a later grant
// still applies to whichever view is active at the time.
const location = { coords: null, status: "idle" }; // idle | pending | granted | denied | unsupported

function requestLocation() {
  if (location.status === "pending" || location.status === "granted") return;
  if (!navigator.geolocation) {
    location.status = "unsupported";
    activeView?.refreshLocation?.();
    return;
  }
  location.status = "pending";
  activeView?.refreshLocation?.();
  navigator.geolocation.getCurrentPosition(
    (position) => {
      location.coords = { lat: position.coords.latitude, lon: position.coords.longitude };
      location.status = "granted";
      activeView?.refreshLocation?.();
    },
    () => {
      location.status = "denied";
      activeView?.refreshLocation?.();
    }
  );
}

const NAV_DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const now = new Date();
const state = {
  view: "today", // "today" | "month" | "year" | "detail"
  year: now.getFullYear(),
  month: now.getMonth(),
  detailDate: null,
  returnTo: null,
};

let activeView = null;

const nav = document.createElement("nav");
nav.id = "app-nav";
nav.innerHTML = `
  <button data-view="today">Today</button>
  <button data-view="month">Month</button>
  <button data-view="year">Year</button>
  <span id="grid-nav" hidden>
    <button id="grid-prev" aria-label="Previous">‹</button>
    <span id="grid-label"></span>
    <button id="grid-next" aria-label="Next">›</button>
  </span>
`;
document.body.appendChild(nav);

const navButtons = nav.querySelectorAll("button[data-view]");
const gridNav = nav.querySelector("#grid-nav");
const gridLabel = nav.querySelector("#grid-label");
const gridPrev = nav.querySelector("#grid-prev");
const gridNext = nav.querySelector("#grid-next");

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const kind = btn.dataset.view;
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

function stepNav(delta) {
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
    const next = new Date(state.detailDate);
    next.setDate(next.getDate() + delta);
    state.detailDate = next;
  }
  setView(state.view);
}

function goToDetail(date) {
  state.returnTo = { view: state.view, year: state.year, month: state.month };
  state.detailDate = date;
  setView("detail");
}

function setView(kind) {
  if (activeView) {
    activeView.dispose();
    activeView = null;
  }
  viewContainer.innerHTML = "";
  state.view = kind;

  navButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.view === kind));

  if (kind === "today") {
    gridNav.hidden = false;
    gridLabel.textContent = NAV_DATE_FORMAT.format(new Date());
    activeView = createMoonDetailView({
      date: null,
      location,
      live: true,
      onBack: null,
      onRequestLocation: requestLocation,
    });
  } else if (kind === "month" || kind === "year") {
    gridNav.hidden = false;
    gridLabel.textContent =
      kind === "month" ? `${MONTH_NAMES[state.month]} ${state.year}` : `${state.year}`;
    const months = kind === "month" ? [state.month] : [...Array(12).keys()];
    activeView = createMoonGridView({ year: state.year, months, onSelectDate: goToDetail });
  } else if (kind === "detail") {
    gridNav.hidden = false;
    gridLabel.textContent = NAV_DATE_FORMAT.format(state.detailDate);
    activeView = createMoonDetailView({
      date: state.detailDate,
      location,
      live: false,
      onBack: () => setView(state.returnTo.view),
      onRequestLocation: requestLocation,
    });
  }

  activeView.mount(viewContainer, renderer);
  activeView.resize(window.innerWidth, window.innerHeight);
}

const aboutButton = document.createElement("button");
aboutButton.id = "about-button";
aboutButton.textContent = "ⓘ About";
aboutButton.setAttribute("aria-label", "About this app");
document.body.appendChild(aboutButton);

const aboutOverlay = document.createElement("div");
aboutOverlay.id = "about-overlay";
aboutOverlay.hidden = true;
aboutOverlay.innerHTML = `
  <div id="about-card" role="dialog" aria-label="About this app">
    <button id="about-close" aria-label="Close">×</button>
    <h2>About this moon</h2>
    <p>
      A real-time 3D render of the Moon as it actually looks from your
      location — plus a calendar of every day's phase, laid out like a
      printed lunar poster.
    </p>
    <p class="about-byline">
      Made by Luca Lischetti — <a href="https://sirlisko.com" target="_blank" rel="noopener">sirlisko</a>
    </p>
    <h3>How it works</h3>
    <ul>
      <li>Phase, illumination, and libration (the Moon's slight wobble) come from real ephemeris calculations, not an approximation of the ~29.5-day cycle.</li>
      <li>Sharing your location adds the parallactic angle — the tilt caused by where you're standing on Earth — so the crescent's orientation matches what you'd actually see looking up, plus its real altitude/azimuth in your sky.</li>
      <li>Calendar cells use the same phase math, evaluated once per day at local noon; clicking one opens the full detail view for that date.</li>
      <li>Nothing you enter leaves your browser — location is used only to compute the render, never sent anywhere.</li>
    </ul>
    <h3>Credits</h3>
    <ul>
      <li>Lunar imagery: <a href="https://svs.gsfc.nasa.gov/4720" target="_blank" rel="noopener">NASA SVS CGI Moon Kit</a> — color from LRO/LROC's Hapke-normalized WAC mosaic, elevation from LOLA.</li>
      <li>Astronomical calculations: <a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noopener">astronomy-engine</a> by Don Cross.</li>
      <li>Rendering: <a href="https://threejs.org" target="_blank" rel="noopener">Three.js</a>.</li>
    </ul>
  </div>
`;
document.body.appendChild(aboutOverlay);

const aboutCard = aboutOverlay.querySelector("#about-card");
function openAbout() {
  aboutOverlay.hidden = false;
}
function closeAbout() {
  aboutOverlay.hidden = true;
}
aboutButton.addEventListener("click", openAbout);
aboutOverlay.querySelector("#about-close").addEventListener("click", closeAbout);
aboutOverlay.addEventListener("click", (e) => {
  if (!aboutCard.contains(e.target)) closeAbout();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !aboutOverlay.hidden) closeAbout();
});

function animate() {
  requestAnimationFrame(animate);
  activeView?.update();
  activeView?.render(renderer);
}

setView("today");
animate();

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  activeView?.resize(window.innerWidth, window.innerHeight);
});
