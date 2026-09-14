import {
  Body,
  Illumination,
  MoonPhase,
  Libration,
  Observer,
  Equator,
  Horizon,
  SiderealTime,
  SearchRiseSet,
  HorizontalCoordinates,
} from "astronomy-engine";

export interface ObserverCoords {
  lat: number;
  lon: number;
}

export interface MoonVisual {
  phase: number;
  illuminatedPercent: number;
  libLonRad: number;
  libLatRad: number;
}

export interface MoonState extends MoonVisual {
  parallacticAngle: number;
  horizon: HorizontalCoordinates | null;
  moonrise: Date | null;
  moonset: Date | null;
}

export function getPhaseName(phase: number): string {
  if (phase < 0.025 || phase >= 0.975) return "New Moon";
  if (phase < 0.225) return "Waxing Crescent";
  if (phase < 0.275) return "First Quarter";
  if (phase < 0.475) return "Waxing Gibbous";
  if (phase < 0.525) return "Full Moon";
  if (phase < 0.725) return "Waning Gibbous";
  if (phase < 0.775) return "Last Quarter";
  return "Waning Crescent";
}

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];
export function azimuthToCompass(deg: number): string {
  return COMPASS[Math.round(deg / 22.5) % 16]!;
}

// Angle between the sky's zenith direction and the Moon's north pole, as seen
// by the observer — this is what actually tilts the crescent/terminator to
// match how the Moon looks in the local sky, and depends on latitude + time.
export function computeParallacticAngle(
  date: Date,
  observer: Observer,
  ra: number,
  dec: number
): number {
  const gastHours = SiderealTime(date);
  const lstHours = ((gastHours + observer.longitude / 15) % 24 + 24) % 24;
  const hourAngleDeg = (lstHours - ra) * 15;
  const H = hourAngleDeg * (Math.PI / 180);
  const lat = observer.latitude * (Math.PI / 180);
  const decRad = dec * (Math.PI / 180);
  return Math.atan2(
    Math.sin(H),
    Math.tan(lat) * Math.cos(decRad) - Math.sin(decRad) * Math.cos(H)
  );
}

// Phase, illumination, and libration for a given moment — observer-independent,
// cheap enough to call for every cell in a full-year calendar grid.
export function computeMoonVisual(date: Date): MoonVisual {
  const illum = Illumination(Body.Moon, date);
  const phase = MoonPhase(date) / 360; // 0 = new, 0.5 = full, 1 = next new
  const lib = Libration(date);
  return {
    phase,
    illuminatedPercent: Math.round(illum.phase_fraction * 100),
    libLonRad: lib.elon * (Math.PI / 180),
    libLatRad: lib.elat * (Math.PI / 180),
  };
}

function localMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
}

interface RiseSet {
  moonrise: Date | null;
  moonset: Date | null;
}

// Moonrise/moonset within date's calendar day (local time) — either can be
// null: moonrise drifts ~50 minutes later each day, so some calendar days
// have no rise (or no set) event at all. Searches a 1-day window from local
// midnight, not the whole synodic month, so this stays cheap.
function computeRiseSet(date: Date, observer: Observer): RiseSet {
  const start = localMidnight(date);
  const riseTime = SearchRiseSet(Body.Moon, observer, +1, start, 1);
  const setTime = SearchRiseSet(Body.Moon, observer, -1, start, 1);
  return {
    moonrise: riseTime ? riseTime.date : null,
    moonset: setTime ? setTime.date : null,
  };
}

// Adds observer-dependent data (horizon position, parallactic angle,
// rise/set times) on top of computeMoonVisual — only needed for the
// single-moon detail view.
export function computeMoonState(
  date: Date,
  observerCoords: ObserverCoords | null
): MoonState {
  const visual = computeMoonVisual(date);

  let parallacticAngle = 0;
  let horizon: HorizontalCoordinates | null = null;
  let moonrise: Date | null = null;
  let moonset: Date | null = null;
  if (observerCoords) {
    const observer = new Observer(observerCoords.lat, observerCoords.lon, 0);
    const eq = Equator(Body.Moon, date, observer, true, true);
    horizon = Horizon(date, observer, eq.ra, eq.dec, "normal");
    parallacticAngle = computeParallacticAngle(date, observer, eq.ra, eq.dec);
    ({ moonrise, moonset } = computeRiseSet(date, observer));
  }

  return { ...visual, parallacticAngle, horizon, moonrise, moonset };
}

export function daysInMonth(year: number, month0: number): number {
  return new Date(year, month0 + 1, 0).getDate();
}

// Local calendar date/time, built from numeric fields (never UTC-string
// parsing) to avoid off-by-one-day bugs across timezones.
export function localNoon(year: number, month0: number, day: number): Date {
  return new Date(year, month0, day, 12, 0, 0);
}

export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
