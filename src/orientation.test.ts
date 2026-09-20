import { describe, it, expect } from "vitest";
import { deviceDirection, angleDelta, screenOffset } from "./orientation.js";

// The W3C angles are intrinsic Z-X'-Y'': alpha spins the phone about the
// vertical (counter-clockwise, so a compass heading is 360 - alpha), beta
// tips it away from flat-on-its-back (90 = upright), gamma rolls it about
// its own top-to-bottom axis.
//
// orientation.js collapses R = Rz(alpha)·Rx(beta)·Ry(gamma) down to the one
// column it needs, so these tests rebuild the matrix the long way and check
// the two agree — that pins the convention itself, not just the arithmetic.

type Matrix = number[][];

function multiply(a: Matrix, b: Matrix): Matrix {
  return [0, 1, 2].map((r) => [0, 1, 2].map((c) => [0, 1, 2].reduce((sum, k) => sum + a[r]![k]! * b[k]![c]!, 0)));
}

const rotZ = (rad: number): Matrix => [
  [Math.cos(rad), -Math.sin(rad), 0],
  [Math.sin(rad), Math.cos(rad), 0],
  [0, 0, 1],
];
const rotX = (rad: number): Matrix => [
  [1, 0, 0],
  [0, Math.cos(rad), -Math.sin(rad)],
  [0, Math.sin(rad), Math.cos(rad)],
];
const rotY = (rad: number): Matrix => [
  [Math.cos(rad), 0, Math.sin(rad)],
  [0, 1, 0],
  [-Math.sin(rad), 0, Math.cos(rad)],
];

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

function deviceToEarth(alpha: number, beta: number, gamma: number): Matrix {
  return multiply(multiply(rotZ(toRad(alpha)), rotX(toRad(beta))), rotY(toRad(gamma)));
}

// Inverts the composition, so a matrix built here can be fed back through
// deviceDirection. Undefined at beta = ±90 (gimbal lock), which is why the
// roll test below stays clear of upright.
function eulerFromMatrix(m: Matrix): [number, number, number] {
  const beta = Math.asin(Math.min(1, Math.max(-1, m[2]![1]!)));
  const gamma = Math.atan2(-m[2]![0]!, m[2]![2]!);
  const alpha = Math.atan2(-m[0]![1]!, m[1]![1]!);
  return [toDeg(alpha), toDeg(beta), toDeg(gamma)];
}

// A sky direction as a unit vector in the earth frame the matrix works in.
function skyVector(azimuth: number, altitude: number): number[] {
  return [
    Math.sin(toRad(azimuth)) * Math.cos(toRad(altitude)),
    Math.cos(toRad(azimuth)) * Math.cos(toRad(altitude)),
    Math.sin(toRad(altitude)),
  ];
}

const column = (m: Matrix, i: number): number[] => [m[0]![i]!, m[1]![i]!, m[2]![i]!];
const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

// What the viewfinder should show, read straight off the matrix: how far the
// target is from the sight line, in the direction the *screen's* own axes put
// it. The device's x and y columns are those axes, so this pins the roll
// convention the same way sightLine pins the bearing one.
function screenTruth(m: Matrix, azimuth: number, altitude: number) {
  const target = skyVector(azimuth, altitude);
  const sight = column(m, 2).map((v) => -v);
  const separation = toDeg(Math.acos(Math.min(1, Math.max(-1, dot(target, sight)))));
  const bearing = Math.atan2(dot(target, column(m, 0)), dot(target, column(m, 1)));
  return {
    right: separation * Math.sin(bearing),
    up: separation * Math.cos(bearing),
    separation,
  };
}

// The device's -z axis in earth coordinates, straight from the matrix.
function sightLine(m: Matrix): { azimuth: number; altitude: number } {
  const east = -m[0]![2]!;
  const north = -m[1]![2]!;
  const up = -m[2]![2]!;
  return {
    azimuth: (toDeg(Math.atan2(east, north)) + 360) % 360,
    altitude: toDeg(Math.asin(Math.min(1, Math.max(-1, up)))),
  };
}

describe("deviceDirection", () => {
  it("points at the ground when the phone lies flat, screen up", () => {
    expect(deviceDirection(0, 0, 0).altitude).toBeCloseTo(-90, 6);
  });

  it("points at the sky when the phone lies flat, screen down", () => {
    expect(deviceDirection(0, 180, 0).altitude).toBeCloseTo(90, 6);
  });

  it("sights along the horizon when held upright", () => {
    const { azimuth, altitude } = deviceDirection(0, 90, 0);
    expect(altitude).toBeCloseTo(0, 6);
    expect(azimuth).toBeCloseTo(0, 6);
  });

  it("swings the sight line counter-clockwise as alpha grows", () => {
    // alpha runs opposite to a compass bearing, so an upright phone sighting
    // north at alpha 0 sights west — not east — at alpha 90.
    expect(deviceDirection(90, 90, 0).azimuth).toBeCloseTo(270, 6);
    expect(deviceDirection(180, 90, 0).azimuth).toBeCloseTo(180, 6);
    expect(deviceDirection(270, 90, 0).azimuth).toBeCloseTo(90, 6);
  });

  it("reads beta past upright as tilting the sight line skyward", () => {
    expect(deviceDirection(0, 45, 0).altitude).toBeCloseTo(-45, 6);
    expect(deviceDirection(0, 135, 0).altitude).toBeCloseTo(45, 6);
  });

  it("reads no roll while the screen's top edge is the high one", () => {
    // Roll is about the sight line, so which way the phone faces can't affect
    // it — only how it's turned in the hand.
    expect(deviceDirection(0, 90, 0).roll).toBeCloseTo(0, 6);
    expect(deviceDirection(210, 45, 0).roll).toBeCloseTo(0, 6);
  });

  it("agrees with the full Z-X'-Y'' matrix across the angle ranges", () => {
    for (let alpha = 0; alpha < 360; alpha += 37) {
      for (let beta = -180; beta < 180; beta += 29) {
        for (let gamma = -90; gamma <= 90; gamma += 23) {
          const expected = sightLine(deviceToEarth(alpha, beta, gamma));
          const actual = deviceDirection(alpha, beta, gamma);
          expect(actual.altitude).toBeCloseTo(expected.altitude, 6);
          // Bearing is meaningless straight up or down, unstable beside it.
          if (Math.abs(expected.altitude) < 89.9) {
            expect(Math.abs(angleDelta(actual.azimuth, expected.azimuth))).toBeLessThan(1e-6);
          }
        }
      }
    }
  });

  it("keeps the sight line when the phone is rolled about it", () => {
    // Why the overlay needs no screen-orientation correction. A roll is a
    // rotation about the device's *z* axis, which changes all three W3C
    // angles, so it has to go through the matrix rather than just gamma.
    const attitude = deviceToEarth(30, 115, -10);
    const expected = sightLine(attitude);
    for (const roll of [-90, 90, 180]) {
      const rolled = eulerFromMatrix(multiply(attitude, rotZ(toRad(roll))));
      const actual = deviceDirection(rolled[0], rolled[1], rolled[2]);
      expect(actual.altitude).toBeCloseTo(expected.altitude, 6);
      expect(actual.azimuth).toBeCloseTo(expected.azimuth, 6);
    }
  });

  it("always returns a bearing in [0, 360) and an altitude in [-90, 90]", () => {
    for (let alpha = 0; alpha < 360; alpha += 37) {
      for (let beta = -180; beta < 180; beta += 29) {
        for (let gamma = -90; gamma <= 90; gamma += 23) {
          const { azimuth, altitude } = deviceDirection(alpha, beta, gamma);
          expect(azimuth).toBeGreaterThanOrEqual(0);
          expect(azimuth).toBeLessThan(360);
          expect(altitude).toBeGreaterThanOrEqual(-90);
          expect(altitude).toBeLessThanOrEqual(90);
        }
      }
    }
  });
});

describe("screenOffset", () => {
  const view = (alpha: number, beta: number, gamma: number) => deviceDirection(alpha, beta, gamma);

  it("puts a target on the sight line at the centre", () => {
    const sight = deviceDirection(160, 130, 0);
    const offset = screenOffset(sight, sight.azimuth, sight.altitude);
    expect(offset.separation).toBeCloseTo(0, 6);
    expect(offset.right).toBeCloseTo(0, 6);
    expect(offset.up).toBeCloseTo(0, 6);
  });

  it("measures the true angle apart, not the difference in bearings", () => {
    // 20° of azimuth is a much shorter way round the sky 60° up than it is on
    // the horizon — about 10°. Taking the bearing difference for the offset
    // pushed a high Moon off the dial and held off the aligned glow.
    const high = screenOffset({ azimuth: 0, altitude: 60, roll: 0 }, 20, 60);
    expect(high.separation).toBeCloseTo(
      toDeg(Math.acos(dot(skyVector(0, 60), skyVector(20, 60)))),
      6
    );
    expect(high.separation).toBeLessThan(11);
  });

  it("turns the offset with the phone's roll", () => {
    // Upright phone sighting north, Moon 20° above the sight line: portrait
    // puts it straight up the screen, and rolling a quarter turn to landscape
    // has to swing it round to the side.
    const portrait = screenOffset(view(0, 90, 0), 0, 20);
    expect(portrait.right).toBeCloseTo(0, 6);
    expect(portrait.up).toBeCloseTo(20, 6);

    for (const roll of [-90, 90, 180]) {
      // A thousandth off upright, since bolt upright is the gimbal lock that
      // eulerFromMatrix can't come back through — hence the loose tolerance.
      const rolled = eulerFromMatrix(multiply(deviceToEarth(0, 90.001, 0), rotZ(toRad(roll))));
      const offset = screenOffset(view(rolled[0]!, rolled[1]!, rolled[2]!), 0, 20);
      expect(offset.separation).toBeCloseTo(20, 2);
      expect(offset.right).toBeCloseTo(20 * Math.sin(toRad(roll)), 2);
      expect(offset.up).toBeCloseTo(20 * Math.cos(toRad(roll)), 2);
    }
  });

  it("agrees with the screen axes taken straight from the matrix", () => {
    for (let alpha = 0; alpha < 360; alpha += 53) {
      for (let beta = -170; beta < 180; beta += 31) {
        for (let gamma = -80; gamma <= 80; gamma += 37) {
          const attitude = deviceToEarth(alpha, beta, gamma);
          const direction = deviceDirection(alpha, beta, gamma);
          for (const [azimuth, altitude] of [
            [0, 0],
            [95, 12],
            [212, 47],
            [300, 78],
            [40, -25],
          ] as const) {
            const expected = screenTruth(attitude, azimuth, altitude);
            const actual = screenOffset(direction, azimuth, altitude);
            expect(actual.separation).toBeCloseTo(expected.separation, 6);
            expect(actual.right).toBeCloseTo(expected.right, 6);
            expect(actual.up).toBeCloseTo(expected.up, 6);
          }
        }
      }
    }
  });
});

describe("angleDelta", () => {
  it("returns the signed turn, positive clockwise", () => {
    expect(angleDelta(0, 90)).toBe(90);
    expect(angleDelta(90, 0)).toBe(-90);
  });

  it("takes the short way round north", () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
  });

  it("stays within [-180, 180), resolving the half turn to the left", () => {
    expect(angleDelta(0, 180)).toBe(-180);
    expect(angleDelta(0, 181)).toBe(-179);
    expect(angleDelta(0, 360)).toBe(0);
  });
});
