// Inline SVG rather than emoji or typographic glyphs. The icon buttons signal
// their state entirely through `color` — the hover lift, `.active`'s amber,
// `#rings-button.active`'s moonlight glow — and a color emoji ignores every
// one of them, so 🔗 looked identical pressed, hovered and idle; `currentColor`
// inherits all of it. The rest were monochrome glyphs (○ ▦ ⓘ ×) which did take
// the color but carry each system font's own metrics and coverage (▦ is tofu
// on a fair few), so they sat off-centre differently per platform.
//
// Paths are Lucide's (ISC licensed), inlined rather than taken as a dependency
// for six icons. The `viewBox` is theirs too — 24×24 with a 2px stroke — and
// the rendered size comes from CSS in `em`, so the responsive font-size steps
// in style.css still shrink the icons along with everything else.

const PATHS = {
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  // Not a Lucide icon: a disc inside a ring, since what this toggles *is* the
  // halo the grid draws around new/full moon days.
  halo: '<circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="9"/>',
  grid: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  pin: '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
  compass: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
} as const;

export type IconName = keyof typeof PATHS;

// Every button that uses one already carries an aria-label, so the icon itself
// is hidden from assistive tech rather than read twice.
export function icon(name: IconName): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
  );
}

// For the labelled buttons (location, compass), whose text changes with status.
// `null` leaves the label on its own — the pending/active states read fine
// without one and an icon there would just be decoration.
export function setIconLabel(button: HTMLElement, name: IconName | null, label: string) {
  const text = document.createElement("span");
  text.textContent = label;
  button.replaceChildren(text);
  if (name) button.insertAdjacentHTML("afterbegin", icon(name));
}
