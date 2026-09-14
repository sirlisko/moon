import { describe, it, expect } from "vitest";
import {
  getPhaseName,
  azimuthToCompass,
  computeParallacticAngle,
  computeMoonVisual,
  computeMoonState,
  daysInMonth,
  localNoon,
  MONTH_NAMES,
} from "./astronomy.js";
import { Observer, SiderealTime } from "astronomy-engine";

describe("getPhaseName", () => {
  it("names the eight phase buckets correctly", () => {
    expect(getPhaseName(0)).toBe("New Moon");
    expect(getPhaseName(0.98)).toBe("New Moon");
    expect(getPhaseName(0.1)).toBe("Waxing Crescent");
    expect(getPhaseName(0.25)).toBe("First Quarter");
    expect(getPhaseName(0.35)).toBe("Waxing Gibbous");
    expect(getPhaseName(0.5)).toBe("Full Moon");
    expect(getPhaseName(0.6)).toBe("Waning Gibbous");
    expect(getPhaseName(0.75)).toBe("Last Quarter");
    expect(getPhaseName(0.9)).toBe("Waning Crescent");
  });

  it("treats the bucket edges as the documented half-open ranges", () => {
    expect(getPhaseName(0.024)).toBe("New Moon");
    expect(getPhaseName(0.025)).toBe("Waxing Crescent");
    expect(getPhaseName(0.224)).toBe("Waxing Crescent");
    expect(getPhaseName(0.225)).toBe("First Quarter");
  });
});

describe("azimuthToCompass", () => {
  it("maps the 16 compass points", () => {
    expect(azimuthToCompass(0)).toBe("N");
    expect(azimuthToCompass(90)).toBe("E");
    expect(azimuthToCompass(180)).toBe("S");
    expect(azimuthToCompass(270)).toBe("W");
  });

  it("wraps around at 360", () => {
    expect(azimuthToCompass(360)).toBe("N");
    expect(azimuthToCompass(350)).toBe("N");
  });
});

describe("daysInMonth", () => {
  it("knows normal month lengths", () => {
    expect(daysInMonth(2026, 0)).toBe(31); // January
    expect(daysInMonth(2026, 3)).toBe(30); // April
  });

  it("gets February leap-year edge cases right", () => {
    expect(daysInMonth(2024, 1)).toBe(29); // divisible by 4 -> leap
    expect(daysInMonth(2026, 1)).toBe(28); // not a leap year
    expect(daysInMonth(2000, 1)).toBe(29); // divisible by 400 -> leap
    expect(daysInMonth(1900, 1)).toBe(28); // divisible by 100, not 400 -> not leap
  });
});

describe("localNoon", () => {
  it("builds a local date at 12:00:00 with the requested y/m/d", () => {
    const d = localNoon(2026, 8, 15); // September 15, 2026 (0-based month)
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(12);
    expect(d.getMinutes()).toBe(0);
  });

  it("rolls across month boundaries via day 0 / day N+1 — relied on elsewhere (e.g. new/full moon neighbor checks)", () => {
    const lastOfAugust = localNoon(2026, 8, 0); // "day 0" of September = last day of August
    expect(lastOfAugust.getMonth()).toBe(7);
    expect(lastOfAugust.getDate()).toBe(31);

    const firstOfOctober = localNoon(2026, 8, 31); // September only has 30 days
    expect(firstOfOctober.getMonth()).toBe(9);
    expect(firstOfOctober.getDate()).toBe(1);
  });
});

describe("computeMoonVisual", () => {
  it("returns a phase in [0,1) and an illuminated percent in [0,100]", () => {
    const v = computeMoonVisual(new Date("2026-09-14T12:00:00Z"));
    expect(v.phase).toBeGreaterThanOrEqual(0);
    expect(v.phase).toBeLessThan(1);
    expect(v.illuminatedPercent).toBeGreaterThanOrEqual(0);
    expect(v.illuminatedPercent).toBeLessThanOrEqual(100);
  });

  it("libration stays within its known physical range (~±8°, in radians)", () => {
    const v = computeMoonVisual(new Date("2026-09-14T12:00:00Z"));
    const limit = (10 * Math.PI) / 180;
    expect(Math.abs(v.libLonRad)).toBeLessThan(limit);
    expect(Math.abs(v.libLatRad)).toBeLessThan(limit);
  });
});

describe("computeMoonState", () => {
  it("omits observer-dependent fields when no location is given", () => {
    const s = computeMoonState(new Date("2026-09-14T12:00:00Z"), null);
    expect(s.horizon).toBeNull();
    expect(s.moonrise).toBeNull();
    expect(s.moonset).toBeNull();
    expect(s.parallacticAngle).toBe(0);
  });

  it("fills them in once observer coordinates are given", () => {
    const s = computeMoonState(new Date("2026-09-14T12:00:00Z"), { lat: 45.5, lon: -73.5 });
    expect(s.horizon).not.toBeNull();
    expect(typeof s.horizon.altitude).toBe("number");
    expect(typeof s.horizon.azimuth).toBe("number");
  });
});

describe("computeParallacticAngle", () => {
  it("is zero on the meridian (H=0) when the observer is directly under the Moon (lat === dec)", () => {
    // H=0 means the Moon's right ascension equals the local sidereal time —
    // computed the same way the function itself derives it, so this is a
    // true H=0 case rather than a guessed one. With dec === lat, the
    // "directly overhead" case, the formula's denominator collapses via
    // tan(lat)·cos(lat) = sin(lat), giving atan2(0, 0) = 0.
    const date = new Date("2026-09-14T12:00:00Z");
    const observer = new Observer(30, 0, 0);
    const lstHours = (((SiderealTime(date) + observer.longitude / 15) % 24) + 24) % 24;
    const angle = computeParallacticAngle(date, observer, lstHours, 30);
    expect(angle).toBeCloseTo(0, 6);
  });
});

describe("MONTH_NAMES", () => {
  it("has 12 names starting with January", () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe("January");
    expect(MONTH_NAMES[11]).toBe("December");
  });
});
