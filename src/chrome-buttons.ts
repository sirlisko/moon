const RINGS_STORAGE_KEY = "moon:showRings"; // off by default — a cleaner-looking grid — remembered across visits
const CALENDAR_STORAGE_KEY = "moon:calendarMode"; // on by default — remembered across visits, opt-out via the toggle

export interface ChromeButtonsOptions {
  nav: HTMLElement;
  announce?: (text: string) => void;
  onToggleRings?: (visible: boolean) => void;
  onToggleCalendarMode?: (calendarMode: boolean) => void;
}

export interface ChromeButtons {
  ringsButton: HTMLButtonElement;
  calendarModeButton: HTMLButtonElement;
  layoutChromeButtons: () => void;
  getTopInset: () => number;
  getShowRings: () => boolean;
  getCalendarMode: () => boolean;
}

export function createChromeButtons({
  nav,
  announce,
  onToggleRings,
  onToggleCalendarMode,
}: ChromeButtonsOptions): ChromeButtons {
  let showRings = localStorage.getItem(RINGS_STORAGE_KEY) === "1";
  let calendarMode = localStorage.getItem(CALENDAR_STORAGE_KEY) !== "0";

  const chromeButtons = document.createElement("div");
  chromeButtons.id = "chrome-buttons";
  document.body.appendChild(chromeButtons);

  function layoutChromeButtons() {
    chromeButtons.style.top = "";
    const navRect = nav.getBoundingClientRect();
    const chromeRect = chromeButtons.getBoundingClientRect();
    const overlaps = navRect.bottom > chromeRect.top && navRect.right + 8 > chromeRect.left;
    if (overlaps) chromeButtons.style.top = `${navRect.bottom + 12}px`;
  }
  window.addEventListener("resize", layoutChromeButtons);

  function getTopInset() {
    return Math.max(nav.getBoundingClientRect().bottom, chromeButtons.getBoundingClientRect().bottom) + 12;
  }

  const aboutButton = document.createElement("button");
  aboutButton.id = "about-button";
  aboutButton.className = "icon-button";
  aboutButton.textContent = "ⓘ";
  aboutButton.title = "About this app";
  aboutButton.setAttribute("aria-label", "About this app");
  chromeButtons.appendChild(aboutButton);

  // Hint text describes what clicking will *do* (show vs. hide), not just
  // what the button is — the glyph alone doesn't say what it controls.
  function ringsHint() {
    return showRings ? "Hide new/full moon markers" : "Show new/full moon markers";
  }

  const ringsButton = document.createElement("button");
  ringsButton.id = "rings-button";
  ringsButton.className = "icon-button";
  ringsButton.textContent = "○";
  ringsButton.title = ringsHint();
  ringsButton.setAttribute("aria-label", ringsHint());
  ringsButton.setAttribute("aria-pressed", String(showRings));
  ringsButton.classList.toggle("active", showRings);
  chromeButtons.appendChild(ringsButton);

  ringsButton.addEventListener("click", () => {
    showRings = !showRings;
    localStorage.setItem(RINGS_STORAGE_KEY, showRings ? "1" : "0");
    ringsButton.classList.toggle("active", showRings);
    ringsButton.setAttribute("aria-pressed", String(showRings));
    ringsButton.title = ringsHint();
    ringsButton.setAttribute("aria-label", ringsHint());
    onToggleRings?.(showRings);
    announce?.(showRings ? "New and full moon markers on." : "New and full moon markers off.");
  });

  // Month-view-only — swaps the continuous day-of-month strip for a
  // traditional Sun–Sat week grid. Hidden outside month view by main.js,
  // same as ringsButton is hidden outside month/year.
  function calendarModeHint() {
    return calendarMode ? "Switch to line view" : "Switch to calendar view";
  }

  const calendarModeButton = document.createElement("button");
  calendarModeButton.id = "calendar-mode-button";
  calendarModeButton.className = "icon-button";
  calendarModeButton.textContent = "▦";
  calendarModeButton.title = calendarModeHint();
  calendarModeButton.setAttribute("aria-label", calendarModeHint());
  calendarModeButton.setAttribute("aria-pressed", String(calendarMode));
  calendarModeButton.classList.toggle("active", calendarMode);
  chromeButtons.appendChild(calendarModeButton);

  calendarModeButton.addEventListener("click", () => {
    calendarMode = !calendarMode;
    localStorage.setItem(CALENDAR_STORAGE_KEY, calendarMode ? "1" : "0");
    calendarModeButton.classList.toggle("active", calendarMode);
    calendarModeButton.setAttribute("aria-pressed", String(calendarMode));
    calendarModeButton.title = calendarModeHint();
    calendarModeButton.setAttribute("aria-label", calendarModeHint());
    onToggleCalendarMode?.(calendarMode);
    announce?.(calendarMode ? "Calendar view." : "Line view.");
  });

  const shareButton = document.createElement("button");
  shareButton.id = "share-button";
  shareButton.className = "icon-button";
  shareButton.textContent = "🔗";
  shareButton.title = "Copy link to this view";
  shareButton.setAttribute("aria-label", "Copy link to this view");
  chromeButtons.appendChild(shareButton);

  shareButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      shareButton.textContent = "✓";
      shareButton.title = "Link copied";
      shareButton.setAttribute("aria-label", "Link copied");
      announce?.("Link copied to clipboard.");
    } catch {
      // Clipboard API unavailable/denied — the address bar is still
      // shareable either way, so just leave the button as-is.
    } finally {
      setTimeout(() => {
        shareButton.textContent = "🔗";
        shareButton.title = "Copy link to this view";
        shareButton.setAttribute("aria-label", "Copy link to this view");
      }, 1500);
    }
  });

  const aboutOverlay = document.createElement("div");
  aboutOverlay.id = "about-overlay";
  aboutOverlay.hidden = true;
  aboutOverlay.innerHTML = `
    <div id="about-card" role="dialog" aria-label="About this app">
      <button id="about-close" aria-label="Close">×</button>
      <h2>About this moon</h2>
      <p>
        A live 3D model of the Moon, showing its real phase and position
        as seen from your location. Plus a calendar with every day's
        moon phase, like a printed lunar calendar.
      </p>
      <p class="about-byline">
        Made by <a href="https://sirlisko.com" target="_blank" rel="noopener">Luca Lischetti (sirlisko)</a>
      </p>
      <h3>How it works</h3>
      <ul>
        <li>The phase, brightness, and slight wobble of the Moon (called libration) come from real astronomy data, not a rough guess.</li>
        <li>If you share your location, the Moon also tilts to match what you would really see looking up, and the app shows how high it is and which direction to look.</li>
        <li>Each day in the calendar uses the same math, checked at noon that day. Click a day to see it up close.</li>
        <li>Your location stays in your browser. It is never sent anywhere.</li>
      </ul>
      <h3>Credits</h3>
      <ul>
        <li>Moon images: <a href="https://svs.gsfc.nasa.gov/4720" target="_blank" rel="noopener">NASA SVS CGI Moon Kit</a>. Color and height data from NASA's Lunar Reconnaissance Orbiter.</li>
        <li>Astronomy math: <a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noopener">astronomy-engine</a> by Don Cross.</li>
        <li>3D rendering: <a href="https://threejs.org" target="_blank" rel="noopener">Three.js</a>.</li>
      </ul>
    </div>
  `;
  document.body.appendChild(aboutOverlay);

  const aboutCard = aboutOverlay.querySelector<HTMLElement>("#about-card")!;
  function openAbout() {
    aboutOverlay.hidden = false;
  }
  function closeAbout() {
    aboutOverlay.hidden = true;
  }
  aboutButton.addEventListener("click", openAbout);
  aboutOverlay.querySelector("#about-close")!.addEventListener("click", closeAbout);
  aboutOverlay.addEventListener("click", (e) => {
    if (!aboutCard.contains(e.target as Node)) closeAbout();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !aboutOverlay.hidden) closeAbout();
  });

  return {
    ringsButton,
    calendarModeButton,
    layoutChromeButtons,
    getTopInset,
    getShowRings: () => showRings,
    getCalendarMode: () => calendarMode,
  };
}
