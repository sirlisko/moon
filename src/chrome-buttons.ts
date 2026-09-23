import { icon } from "./icons.js";
import type { IconName } from "./icons.js";

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

// Storage access throws when the browser blocks site data; the toggles still
// work then, they just aren't remembered.
function readSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function createChromeButtons({
  nav,
  announce,
  onToggleRings,
  onToggleCalendarMode,
}: ChromeButtonsOptions): ChromeButtons {
  let showRings = readSetting(RINGS_STORAGE_KEY) === "1";
  let calendarMode = readSetting(CALENDAR_STORAGE_KEY) !== "0";

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
    return Math.max(nav.getBoundingClientRect().bottom, chromeButtons.getBoundingClientRect().bottom) + 20;
  }

  const aboutButton = document.createElement("button");
  aboutButton.id = "about-button";
  aboutButton.className = "icon-button";
  aboutButton.innerHTML = icon("info");
  aboutButton.title = "About this app";
  aboutButton.setAttribute("aria-label", "About this app");
  chromeButtons.appendChild(aboutButton);

  // Hint text describes what clicking will *do* (show vs. hide), not just
  // what the button is — the icon alone doesn't say what it controls.
  function ringsHint() {
    return showRings ? "Hide new/full moon markers" : "Show new/full moon markers";
  }

  const ringsButton = document.createElement("button");
  ringsButton.id = "rings-button";
  ringsButton.className = "icon-button";
  ringsButton.innerHTML = icon("halo");
  ringsButton.title = ringsHint();
  ringsButton.setAttribute("aria-label", ringsHint());
  ringsButton.setAttribute("aria-pressed", String(showRings));
  ringsButton.classList.toggle("active", showRings);
  chromeButtons.appendChild(ringsButton);

  ringsButton.addEventListener("click", () => {
    showRings = !showRings;
    writeSetting(RINGS_STORAGE_KEY, showRings ? "1" : "0");
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
  calendarModeButton.innerHTML = icon("grid");
  calendarModeButton.title = calendarModeHint();
  calendarModeButton.setAttribute("aria-label", calendarModeHint());
  calendarModeButton.setAttribute("aria-pressed", String(calendarMode));
  calendarModeButton.classList.toggle("active", calendarMode);
  chromeButtons.appendChild(calendarModeButton);

  calendarModeButton.addEventListener("click", () => {
    calendarMode = !calendarMode;
    writeSetting(CALENDAR_STORAGE_KEY, calendarMode ? "1" : "0");
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
  shareButton.innerHTML = icon("link");
  shareButton.title = "Copy link to this view";
  shareButton.setAttribute("aria-label", "Copy link to this view");
  chromeButtons.appendChild(shareButton);

  // The async Clipboard API is unavailable over plain http and can be
  // blocked by permissions policy — hence the legacy fallback.
  async function copyLink(): Promise<boolean> {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch { /* fall through */ }
    try {
      const scratch = document.createElement("textarea");
      scratch.value = url;
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      const copied = document.execCommand("copy");
      scratch.remove();
      return copied;
    } catch {
      return false;
    }
  }

  function setShareState(name: IconName, label: string) {
    shareButton.innerHTML = icon(name);
    shareButton.title = label;
    shareButton.setAttribute("aria-label", label);
  }

  let shareResetTimer: ReturnType<typeof setTimeout> | null = null;
  shareButton.addEventListener("click", async () => {
    const copied = await copyLink();
    if (copied) {
      setShareState("check", "Link copied");
      announce?.("Link copied to clipboard.");
    } else {
      setShareState("close", "Couldn't copy — the link is in your address bar");
      announce?.("Couldn't copy the link. It's in your address bar.");
    }
    if (shareResetTimer) clearTimeout(shareResetTimer);
    shareResetTimer = setTimeout(() => setShareState("link", "Copy link to this view"), 2200);
  });

  // Markup lives in index.html rather than here: the app is a WebGL canvas,
  // so this copy is most of the text a crawler can read on the page.
  const aboutOverlay = document.querySelector<HTMLElement>("#about-overlay")!;
  const aboutCard = aboutOverlay.querySelector<HTMLElement>("#about-card")!;
  const aboutCloseButton = aboutOverlay.querySelector<HTMLElement>("#about-close")!;
  aboutCloseButton.innerHTML = icon("close");

  let focusBeforeAbout: HTMLElement | null = null;

  function aboutFocusables(): HTMLElement[] {
    return Array.from(aboutCard.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"));
  }

  function openAbout() {
    if (!aboutOverlay.hidden) return;
    focusBeforeAbout = document.activeElement as HTMLElement | null;
    aboutOverlay.hidden = false;
    aboutCard.focus();
  }

  function closeAbout() {
    if (aboutOverlay.hidden) return;
    aboutOverlay.hidden = true;
    focusBeforeAbout?.focus();
    focusBeforeAbout = null;
  }

  aboutOverlay.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const focusables = aboutFocusables();
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (!first || !last) return;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === aboutCard)) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && active === last) {
      first.focus();
      e.preventDefault();
    }
  });
  aboutButton.addEventListener("click", openAbout);
  aboutCloseButton.addEventListener("click", closeAbout);
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
