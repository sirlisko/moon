import { MONTH_NAMES } from "./astronomy.js";

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const YEARS_PER_PAGE = 12;

export type DatePickerMode = "day" | "month" | "year";

export interface DatePickerSelection {
  year: number;
  month: number;
  day?: number;
}

export interface OpenDatePickerOptions {
  anchor: HTMLElement;
  mode: DatePickerMode;
  year: number;
  month: number;
  day?: number;
  onSelect: (selection: DatePickerSelection) => void;
}

export interface DatePicker {
  open: (options: OpenDatePickerOptions) => void;
  close: () => void;
  isOpen: () => boolean;
}

function sameYMD(a: Date, y: number, m: number, d: number): boolean {
  return a.getFullYear() === y && a.getMonth() === m && a.getDate() === d;
}

export function createDatePicker(): DatePicker {
  const panel = document.createElement("div");
  panel.id = "date-picker";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Choose a date");
  panel.innerHTML = `
    <div class="date-picker-header">
      <button type="button" class="date-picker-nav" data-dir="-1" aria-label="Previous">‹</button>
      <span class="date-picker-title"></span>
      <button type="button" class="date-picker-nav" data-dir="1" aria-label="Next">›</button>
    </div>
    <div class="date-picker-grid"></div>
    <button type="button" class="date-picker-today" hidden>Today</button>
  `;
  document.body.appendChild(panel);

  const title = panel.querySelector<HTMLElement>(".date-picker-title")!;
  const grid = panel.querySelector<HTMLElement>(".date-picker-grid")!;
  const todayBtn = panel.querySelector<HTMLButtonElement>(".date-picker-today")!;
  const navButtons = panel.querySelectorAll<HTMLButtonElement>(".date-picker-nav");

  let mode: DatePickerMode = "day";
  let anchorEl: HTMLElement | null = null;
  let onSelect: ((selection: DatePickerSelection) => void) | null = null;

  // The unit each header prev/next click steps by — a month in day mode, a
  // year in month mode, a page of years in year mode.
  let displayYear = 0;
  let displayMonth = 0; // day/month mode
  let pageStart = 0; // year mode
  let selectedYear = 0;
  let selectedMonth = 0;
  let selectedDay: number | undefined;

  function makeCell(label: string, isToday: boolean, isSelected: boolean, isOutside: boolean, onClick: () => void) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.className = "date-picker-cell";
    if (isToday) btn.classList.add("is-today");
    if (isSelected) btn.classList.add("is-selected");
    if (isOutside) btn.classList.add("date-picker-cell-outside");
    btn.addEventListener("click", onClick);
    return btn;
  }

  function render() {
    const today = new Date();
    grid.innerHTML = "";

    if (mode === "day") {
      title.textContent = `${MONTH_NAMES[displayMonth]} ${displayYear}`;
      grid.className = "date-picker-grid date-picker-grid-day";

      const weekdays = document.createElement("div");
      weekdays.className = "date-picker-weekdays";
      WEEKDAY_NAMES.forEach((name) => {
        const s = document.createElement("span");
        s.textContent = name;
        weekdays.appendChild(s);
      });
      grid.appendChild(weekdays);

      const days = document.createElement("div");
      days.className = "date-picker-days";
      const firstDow = new Date(displayYear, displayMonth, 1).getDay();
      let focusTarget: HTMLButtonElement | null = null;
      for (let i = 0; i < 42; i++) {
        const cellDate = new Date(displayYear, displayMonth, 1 - firstDow + i);
        const isOutside = cellDate.getMonth() !== displayMonth;
        const isToday = sameYMD(cellDate, today.getFullYear(), today.getMonth(), today.getDate());
        const isSelected =
          selectedDay !== undefined && sameYMD(cellDate, selectedYear, selectedMonth, selectedDay);
        const cell = makeCell(String(cellDate.getDate()), isToday, isSelected, isOutside, () => {
          onSelect?.({ year: cellDate.getFullYear(), month: cellDate.getMonth(), day: cellDate.getDate() });
          close();
        });
        if (isSelected || (!focusTarget && isToday)) focusTarget = cell;
        days.appendChild(cell);
      }
      grid.appendChild(days);
      (focusTarget ?? days.querySelector<HTMLButtonElement>(".date-picker-cell:not(.date-picker-cell-outside)"))?.focus();
    } else if (mode === "month") {
      title.textContent = `${displayYear}`;
      grid.className = "date-picker-grid date-picker-grid-month";
      let focusTarget: HTMLButtonElement | null = null;
      MONTH_NAMES.forEach((name, i) => {
        const isToday = displayYear === today.getFullYear() && i === today.getMonth();
        const isSelected = displayYear === selectedYear && i === selectedMonth;
        const cell = makeCell(name.slice(0, 3), isToday, isSelected, false, () => {
          onSelect?.({ year: displayYear, month: i });
          close();
        });
        if (isSelected || (!focusTarget && isToday)) focusTarget = cell;
        grid.appendChild(cell);
      });
      (focusTarget ?? grid.querySelector<HTMLButtonElement>(".date-picker-cell"))?.focus();
    } else {
      title.textContent = `${pageStart}–${pageStart + YEARS_PER_PAGE - 1}`;
      grid.className = "date-picker-grid date-picker-grid-year";
      let focusTarget: HTMLButtonElement | null = null;
      for (let y = pageStart; y < pageStart + YEARS_PER_PAGE; y++) {
        const isToday = y === today.getFullYear();
        const isSelected = y === selectedYear;
        const cell = makeCell(String(y), isToday, isSelected, false, () => {
          onSelect?.({ year: y, month: 0 });
          close();
        });
        if (isSelected || (!focusTarget && isToday)) focusTarget = cell;
        grid.appendChild(cell);
      }
      (focusTarget ?? grid.querySelector<HTMLButtonElement>(".date-picker-cell"))?.focus();
    }
  }

  function step(dir: number) {
    if (mode === "day") {
      const next = new Date(displayYear, displayMonth + dir, 1);
      displayYear = next.getFullYear();
      displayMonth = next.getMonth();
    } else if (mode === "month") {
      displayYear += dir;
    } else {
      pageStart += dir * YEARS_PER_PAGE;
    }
    render();
  }

  navButtons.forEach((btn) => {
    btn.addEventListener("click", () => step(Number(btn.dataset.dir)));
  });

  todayBtn.addEventListener("click", () => {
    const today = new Date();
    onSelect?.({ year: today.getFullYear(), month: today.getMonth(), day: today.getDate() });
    close();
  });

  function reposition() {
    if (!anchorEl) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const margin = 8;
    let left = anchorRect.left + anchorRect.width / 2 - panelRect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - panelRect.width - margin));
    let top = anchorRect.bottom + 10;
    if (top + panelRect.height > window.innerHeight - margin) {
      top = Math.max(margin, anchorRect.top - panelRect.height - 10);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  function handleDocClick(e: MouseEvent) {
    if (!panel.contains(e.target as Node) && e.target !== anchorEl) close();
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    document.removeEventListener("click", handleDocClick, true);
    document.removeEventListener("keydown", handleKeydown);
    window.removeEventListener("resize", reposition);
    anchorEl?.focus();
    anchorEl = null;
    onSelect = null;
  }

  function open(options: OpenDatePickerOptions) {
    mode = options.mode;
    anchorEl = options.anchor;
    onSelect = options.onSelect;
    selectedYear = options.year;
    selectedMonth = options.month;
    selectedDay = options.day;
    displayYear = options.year;
    displayMonth = options.month;
    pageStart = options.year - Math.floor(YEARS_PER_PAGE / 2);
    todayBtn.hidden = mode !== "day";

    panel.hidden = false;
    render();
    reposition();

    // Deferred so the click that opened the picker doesn't immediately
    // bubble into handleDocClick and close it again.
    setTimeout(() => {
      document.addEventListener("click", handleDocClick, true);
      document.addEventListener("keydown", handleKeydown);
      window.addEventListener("resize", reposition);
    }, 0);
  }

  return { open, close, isOpen: () => !panel.hidden };
}
