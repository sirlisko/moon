import * as THREE from "three";
import { computeMoonVisual, daysInMonth, localNoon, getPhaseName, MONTH_NAMES } from "./astronomy.js";
import { getColorMap } from "./textures.js";
import { createMoonCellMaterial } from "./moon-shader.js";
import type { ViewInstance } from "./types.js";

const SPACING = 2.4;
const CELL_RADIUS = 0.85;
const LEFT_GUTTER = 3.2; // world units reserved for the row-label axis (month names or day numbers)
const TOP_GUTTER = 1.4; // world units reserved for the column-header axis (day numbers or month names)
// Calendar mode has no row labels (weeks aren't named) — just a small
// symmetric margin either side of the 7-day-wide grid.
const CAL_LEFT_GUTTER = 0.4;
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// Calendar mode's per-cell day number sits smaller and in the corner, clear
// of the sphere — a fraction of the header labels' normal world-space size.
const CAL_DAY_NUMBER_SCALE = 0.5;
const CAL_DAY_NUMBER_OFFSET = CELL_RADIUS * 0.95;
// The Sun–Mon–… weekday header is a single row, not a whole column/row
// label like month names — full label size reads oversized next to it.
const CAL_WEEKDAY_SCALE = 0.55;
const FRUSTUM_PADDING = 1.04;
const BASE_ROTATION_Y = Math.PI * 1.54;
const BASE_ROTATION_X = Math.PI * 0.02;

// Below this pixel diameter a cell stops being legible/tappable — rather
// than keep shrinking to fit the whole grid on screen (unusable on a narrow
// phone), we hold cells at this size and let the view become pannable. Kept
// low enough that ordinary desktop/laptop windows still show the whole grid
// at once (fingers need a bigger target than a mouse cursor does, but this
// still comfortably fits a touch tap).
const MIN_CELL_PX = 26;
// A pointer has to move this many CSS pixels before a gesture counts as a
// pan/drag instead of a tap-to-select.
const DRAG_THRESHOLD_PX = 6;

const LABEL_OPACITY = 0.55;
const LABEL_HOVER_OPACITY = 1;
const LABEL_HOVER_SCALE = 1.2;
const LABEL_COLOR = new THREE.Color(0xffffff);
const LABEL_HOVER_COLOR = new THREE.Color(0xffb020);
const CELL_ACTIVE_SCALE = 1.15;
// New/full moon ring halo, relative to the cell's own diameter. Kept small
// and faint — a quiet hint, not a badge competing with the moon itself.
const RING_SCALE = 1.22;

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "long", day: "numeric" });

interface CellRef {
  day: number;
  row: number;
}

interface Cell extends CellRef {
  mesh: THREE.Mesh;
}

interface SpriteEntry {
  sprite: THREE.Sprite;
}

interface MonthLabelEntry extends SpriteEntry {
  row: number;
}

interface DayLabelEntry extends SpriteEntry {
  day: number;
}

interface RingEntry extends CellRef {
  sprite: THREE.Sprite;
}

interface SpriteScale {
  x: number;
  y: number;
}

// Shared across every grid mount — a year view and a month view both reuse
// the same low-poly sphere; never disposed, only per-cell materials are.
let sharedCellGeometry: THREE.SphereGeometry | null = null;
function getCellGeometry(): THREE.SphereGeometry {
  if (!sharedCellGeometry) {
    sharedCellGeometry = new THREE.SphereGeometry(CELL_RADIUS, 20, 14);
  }
  return sharedCellGeometry;
}

// A thin ring texture marking new/full moon days — one shared material for
// every marked cell across every grid mount, never disposed.
let sharedRingMaterial: THREE.SpriteMaterial | null = null;
function getRingMaterial(): THREE.SpriteMaterial {
  if (!sharedRingMaterial) {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    const lineWidth = size * 0.035;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - lineWidth, 0, Math.PI * 2);
    ctx.stroke();

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    sharedRingMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      opacity: 0.32,
      color: 0xffffff,
    });
  }
  return sharedRingMaterial;
}

// Rasterizes text once at a fixed resolution, solid white — dimming and
// hover-highlighting are done live via material.opacity/color (see
// setLabelHighlighted) rather than by re-rendering the texture. The
// sprite's on-screen size is likewise controlled entirely via .scale (set
// later, per layout) rather than by the texture's pixel size.
function createTextSprite(text: string, { fontPx = 64 }: { fontPx?: number } = {}): THREE.Sprite {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  const width = Math.ceil(ctx.measureText(text).width) + fontPx * 0.4;
  const height = fontPx * 1.4;
  canvas.width = width;
  canvas.height = height;
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, fontPx * 0.2, height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    opacity: LABEL_OPACITY,
    color: LABEL_COLOR,
  });
  const sprite = new THREE.Sprite(material);
  const worldHeight = 0.7;
  sprite.userData.baseScale = { x: (width / height) * worldHeight, y: worldHeight } satisfies SpriteScale;
  return sprite;
}

function setLabelHighlighted(sprite: THREE.Sprite | undefined, highlighted: boolean): void {
  if (!sprite) return;
  const material = sprite.material as THREE.SpriteMaterial;
  material.opacity = highlighted ? LABEL_HOVER_OPACITY : LABEL_OPACITY;
  material.color.copy(highlighted ? LABEL_HOVER_COLOR : LABEL_COLOR);
  const base: SpriteScale = sprite.userData.currentScale || sprite.userData.baseScale;
  const boost = highlighted ? LABEL_HOVER_SCALE : 1;
  sprite.scale.set(base.x * boost, base.y * boost, 1);
}

// "Contain" fit — the whole grid visible, no cropping, letterboxed to match
// the container's aspect ratio exactly (so spheres stay circular).
function fitFrustum(
  contentWidth: number,
  contentHeight: number,
  containerAspect: number
): { width: number; height: number } {
  const contentAspect = contentWidth / contentHeight;
  let width, height;
  if (containerAspect > contentAspect) {
    height = contentHeight;
    width = contentHeight * containerAspect;
  } else {
    width = contentWidth;
    height = contentWidth / containerAspect;
  }
  return { width: width * FRUSTUM_PADDING, height: height * FRUSTUM_PADDING };
}

// Distance from a 0..1 phase fraction to the nearest new moon (0 or 1) / full
// moon (0.5) — used to find each lunar cycle's single closest calendar day.
function distToNew(phase: number): number {
  return Math.min(phase, 1 - phase);
}
function distToFull(phase: number): number {
  return Math.abs(phase - 0.5);
}

export interface MoonGridViewOptions {
  year: number;
  months: number[];
  onSelectDate: (date: Date) => void;
  announce?: (text: string) => void;
  showRings?: boolean;
  getTopInset?: () => number;
  // Lays the single month out as a traditional Sun–Sat week grid instead of
  // one continuous day-of-month strip. Only meaningful for a single month
  // (months.length === 1) — the year view always uses the strip layout.
  calendarMode?: boolean;
}

// months: array of 0-based month indices — [m] for a single month, [0..11]
// for a full year. Same grid builder either way; year view is just "more
// months." On a portrait/narrow viewport the grid transposes — days run
// vertically and months become columns — since scrolling vertically is the
// natural mobile gesture, vs. the horizontal "poster" layout on desktop.
export function createMoonGridView({
  year,
  months,
  onSelectDate,
  announce,
  showRings = false,
  getTopInset = () => 0,
  calendarMode = false,
}: MoonGridViewOptions): ViewInstance {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.z = 10;

  // Calendar mode replaces the day-of-month strip with a real Sun–Sat week
  // grid, so it only makes sense for a single month.
  const isCalendar = calendarMode && months.length === 1;
  const leadDays = isCalendar ? localNoon(year, months[0]!, 1).getDay() : 0;
  function calendarCol(day: number): number {
    return (leadDays + day - 1) % 7;
  }
  function calendarWeekRow(day: number): number {
    return Math.floor((leadDays + day - 1) / 7);
  }
  const calendarWeeks = isCalendar ? calendarWeekRow(daysInMonth(year, months[0]!)) + 1 : 0;
  function calendarPosFor(day: number): { x: number; y: number } {
    return {
      x: CAL_LEFT_GUTTER + calendarCol(day) * SPACING + SPACING / 2,
      y: -TOP_GUTTER - calendarWeekRow(day) * SPACING - SPACING / 2,
    };
  }

  const cols = 31; // days
  const rows = months.length; // months

  const cells: Cell[] = [];
  const monthLabels: MonthLabelEntry[] = [];
  const dayLabels: DayLabelEntry[] = [];
  const weekdayLabels: { sprite: THREE.Sprite; col: number }[] = [];
  const ringSprites: RingEntry[] = [];
  const disposables: Array<{ dispose(): void }> = [];

  months.forEach((month0, row) => {
    if (!isCalendar) {
      const label = createTextSprite(MONTH_NAMES[month0]!, { fontPx: 56 });
      scene.add(label);
      monthLabels.push({ sprite: label, row });
      disposables.push(label.material.map!, label.material);
    }

    const n = daysInMonth(year, month0);
    for (let day = 1; day <= n; day++) {
      const date = localNoon(year, month0, day);
      const visual = computeMoonVisual(date);
      const prevPhase = computeMoonVisual(localNoon(year, month0, day - 1)).phase;
      const nextPhase = computeMoonVisual(localNoon(year, month0, day + 1)).phase;
      const isNewMoon = distToNew(visual.phase) < distToNew(prevPhase) && distToNew(visual.phase) < distToNew(nextPhase);
      const isFullMoon = distToFull(visual.phase) < distToFull(prevPhase) && distToFull(visual.phase) < distToFull(nextPhase);

      const material = createMoonCellMaterial(getColorMap(), visual.phase);
      const mesh = new THREE.Mesh(getCellGeometry(), material);
      mesh.rotation.x = BASE_ROTATION_X;
      mesh.rotation.y = BASE_ROTATION_Y;
      mesh.userData.date = date;
      mesh.userData.day = day;
      mesh.userData.row = row;
      mesh.userData.phaseName = getPhaseName(visual.phase);
      mesh.userData.illuminatedPercent = visual.illuminatedPercent;
      mesh.userData.isNewMoon = isNewMoon;
      mesh.userData.isFullMoon = isFullMoon;
      scene.add(mesh);
      cells.push({ mesh, day, row });
      disposables.push(material);

      if (isNewMoon || isFullMoon) {
        const ring = new THREE.Sprite(getRingMaterial());
        ring.visible = showRings;
        scene.add(ring);
        ringSprites.push({ sprite: ring, day, row });
      }
    }
  });

  if (isCalendar) {
    WEEKDAY_NAMES.forEach((name, col) => {
      const label = createTextSprite(name, { fontPx: 40 });
      scene.add(label);
      weekdayLabels.push({ sprite: label, col });
      disposables.push(label.material.map!, label.material);
    });
    // One small day-number label per cell (rather than a header row, as in
    // line mode) — reuses dayLabels/dayLabelByDay so the existing
    // hover/focus highlight (setActiveCell) picks it up for free.
    const n = daysInMonth(year, months[0]!);
    for (let day = 1; day <= n; day++) {
      const label = createTextSprite(String(day), { fontPx: 32 });
      scene.add(label);
      dayLabels.push({ sprite: label, day });
      disposables.push(label.material.map!, label.material);
    }
  } else {
    for (let day = 1; day <= cols; day++) {
      const label = createTextSprite(String(day), { fontPx: 40 });
      scene.add(label);
      dayLabels.push({ sprite: label, day });
      disposables.push(label.material.map!, label.material);
    }
  }

  const cellMeshes = cells.map((c) => c.mesh);
  const cellMeshByKey = new Map(cells.map((c) => [cellKey(c), c.mesh]));
  const monthLabelByRow = new Map(monthLabels.map((m) => [m.row, m.sprite]));
  const dayLabelByDay = new Map(dayLabels.map((d) => [d.day, d.sprite]));
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let canvas: HTMLCanvasElement | null = null;

  function cellKey(c: CellRef | null): string | null {
    return c ? `${c.day}-${c.row}` : null;
  }

  // The single "active cell" concept driving the visual crosshair — set by
  // mouse hover OR keyboard focus, whichever last moved. Highlights the
  // month/day labels (setLabelHighlighted) and scales the cell mesh itself,
  // so sighted keyboard users can see where they are too, not just via
  // screen-reader announcements.
  let activeCell: CellRef | null = null;
  function setActiveCell(cell: CellRef | null) {
    if (cellKey(cell) === cellKey(activeCell)) return;
    if (activeCell) {
      setLabelHighlighted(monthLabelByRow.get(activeCell.row), false);
      setLabelHighlighted(dayLabelByDay.get(activeCell.day), false);
      cellMeshByKey.get(cellKey(activeCell)!)?.scale.setScalar(cellScale);
    }
    if (cell) {
      setLabelHighlighted(monthLabelByRow.get(cell.row), true);
      setLabelHighlighted(dayLabelByDay.get(cell.day), true);
      cellMeshByKey.get(cellKey(cell)!)?.scale.setScalar(cellScale * CELL_ACTIVE_SCALE);
    }
    activeCell = cell;
    if (canvas) canvas.style.cursor = cell ? "pointer" : "";
  }

  function hoverAt(clientX: number, clientY: number) {
    const rect = canvas!.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(cellMeshes, false)[0];
    setActiveCell(hit ? { day: hit.object.userData.day, row: hit.object.userData.row } : null);
  }

  // Layout state, recomputed in resize() since orientation is only known then.
  let transposed = false;
  let cellScale = 1;
  let contentWidth = 0;
  let contentHeight = 0;
  let centerX = 0;
  let centerY = 0;

  // "Primary" axis = days (31, the long axis) — X when horizontal, Y when
  // transposed. "Secondary" axis = months (1 or 12) — the other one.
  function posFor(primaryIndex: number, secondaryIndex: number): { x: number; y: number } {
    return transposed
      ? {
          x: LEFT_GUTTER + secondaryIndex * SPACING + SPACING / 2,
          y: -TOP_GUTTER - primaryIndex * SPACING - SPACING / 2,
        }
      : {
          x: LEFT_GUTTER + primaryIndex * SPACING + SPACING / 2,
          y: -TOP_GUTTER - secondaryIndex * SPACING - SPACING / 2,
        };
  }

  // Position of a cell for the currently active layout mode — used by both
  // applyLayout and ensureVisible (keyboard auto-pan), which need the same
  // day→world mapping regardless of which layout is active.
  function cellPosFor(day: number, row: number): { x: number; y: number } {
    return isCalendar ? calendarPosFor(day) : posFor(day - 1, row);
  }

  function applyLayout() {
    if (isCalendar) applyCalendarLayout();
    else applyLineLayout();
  }

  function applyCalendarLayout() {
    contentWidth = CAL_LEFT_GUTTER * 2 + 7 * SPACING;
    contentHeight = TOP_GUTTER + calendarWeeks * SPACING;
    centerX = contentWidth / 2;
    centerY = -contentHeight / 2;

    for (const { mesh, day, row } of cells) {
      const { x, y } = calendarPosFor(day);
      mesh.position.set(x, y, 0);
      const isActive = activeCell !== null && activeCell.day === day && activeCell.row === row;
      mesh.scale.setScalar(cellScale * (isActive ? CELL_ACTIVE_SCALE : 1));
    }

    for (const { sprite, day } of ringSprites) {
      const { x, y } = calendarPosFor(day);
      sprite.position.set(x, y, -0.05);
      const s = CELL_RADIUS * 2 * RING_SCALE * cellScale;
      sprite.scale.set(s, s, 1);
    }

    for (const { sprite, col } of weekdayLabels) {
      // Kept within [-contentHeight, 0] (unlike the line-mode headers, which
      // poke slightly above y=0) — resize()'s fit-margin math assumes
      // content tops out at y=0, and calendar mode's near-square aspect
      // ratio has much less spare letterboxing slack to hide that gap in
      // than the very wide day-strip layouts do.
      sprite.position.set(CAL_LEFT_GUTTER + col * SPACING + SPACING / 2, -TOP_GUTTER * 0.35, 0);
      const base: SpriteScale = sprite.userData.baseScale;
      sprite.userData.currentScale = {
        x: base.x * cellScale * CAL_WEEKDAY_SCALE,
        y: base.y * cellScale * CAL_WEEKDAY_SCALE,
      } satisfies SpriteScale;
      sprite.scale.set(sprite.userData.currentScale.x, sprite.userData.currentScale.y, 1);
    }

    // Day number in each cell's top-left corner — offset far enough from
    // center to clear the sphere (radius CELL_RADIUS) without crowding the
    // neighboring cell (half-spacing SPACING/2).
    for (const { sprite, day } of dayLabels) {
      const { x, y } = calendarPosFor(day);
      const offset = CAL_DAY_NUMBER_OFFSET * cellScale;
      sprite.position.set(x - offset, y + offset, 0.01);
      const base: SpriteScale = sprite.userData.baseScale;
      sprite.userData.currentScale = {
        x: base.x * cellScale * CAL_DAY_NUMBER_SCALE,
        y: base.y * cellScale * CAL_DAY_NUMBER_SCALE,
      } satisfies SpriteScale;
      sprite.scale.set(sprite.userData.currentScale.x, sprite.userData.currentScale.y, 1);
    }
  }

  function applyLineLayout() {
    const primaryCount = cols;
    const secondaryCount = rows;
    contentWidth = LEFT_GUTTER + (transposed ? secondaryCount : primaryCount) * SPACING;
    contentHeight = TOP_GUTTER + (transposed ? primaryCount : secondaryCount) * SPACING;
    centerX = contentWidth / 2;
    centerY = -contentHeight / 2;

    for (const { mesh, day, row } of cells) {
      const { x, y } = posFor(day - 1, row);
      mesh.position.set(x, y, 0);
      const isActive = activeCell !== null && activeCell.day === day && activeCell.row === row;
      mesh.scale.setScalar(cellScale * (isActive ? CELL_ACTIVE_SCALE : 1));
    }

    for (const { sprite, day, row } of ringSprites) {
      const { x, y } = posFor(day - 1, row);
      sprite.position.set(x, y, -0.05);
      const s = CELL_RADIUS * 2 * RING_SCALE * cellScale;
      sprite.scale.set(s, s, 1);
    }

    // Month labels sit in the secondary-axis gutter: a left-hand row label
    // normally, a top column header once transposed.
    for (const { sprite, row } of monthLabels) {
      const { x, y } = transposed
        ? { x: LEFT_GUTTER + row * SPACING + SPACING / 2, y: TOP_GUTTER * 0.3 }
        : { x: LEFT_GUTTER * 0.42, y: -TOP_GUTTER - row * SPACING - SPACING / 2 };
      sprite.position.set(x, y, 0);
      const base: SpriteScale = sprite.userData.baseScale;
      sprite.userData.currentScale = { x: base.x * cellScale, y: base.y * cellScale } satisfies SpriteScale;
      sprite.scale.set(sprite.userData.currentScale.x, sprite.userData.currentScale.y, 1);
    }

    // Day labels sit in the primary-axis header: a top header normally,
    // a left-hand row label once transposed.
    for (const { sprite, day } of dayLabels) {
      const { x, y } = transposed
        ? { x: LEFT_GUTTER * 0.42, y: -TOP_GUTTER - (day - 1) * SPACING - SPACING / 2 }
        : { x: LEFT_GUTTER + (day - 1) * SPACING + SPACING / 2, y: SPACING * 0.15 };
      sprite.position.set(x, y, 0);
      const base: SpriteScale = sprite.userData.baseScale;
      sprite.userData.currentScale = { x: base.x * cellScale, y: base.y * cellScale } satisfies SpriteScale;
      sprite.scale.set(sprite.userData.currentScale.x, sprite.userData.currentScale.y, 1);
    }
  }

  // Pan state — only relevant once resize() determines the grid can't fit
  // at a legible/tappable cell size. frustumW/H is the current zoom level
  // (world units visible), panX/panY is the frustum's center.
  let panEnabled = false;
  let panInitialized = false;
  let frustumW = 1;
  let frustumH = 1;
  let panX = 0;
  let panY = 0;
  // How much world space, at the current zoom, corresponds to the fixed
  // nav/icon cluster floating over the canvas — recomputed every resize()
  // from getTopInset() (a live pixel measurement owned by main.js). Baked
  // into panBounds()'s maxY so panning can never scroll content underneath
  // that overlay, on any screen size or zoom level.
  let topInsetWorld = 0;

  function panBounds() {
    const minX = frustumW >= contentWidth ? centerX : frustumW / 2;
    const maxX = frustumW >= contentWidth ? centerX : contentWidth - frustumW / 2;
    const maxY = frustumH >= contentHeight ? centerY : -frustumH / 2 + topInsetWorld;
    const minY = frustumH >= contentHeight ? centerY : -contentHeight + frustumH / 2;
    return { minX, maxX, minY, maxY };
  }

  function clampPan() {
    const b = panBounds();
    panX = Math.min(b.maxX, Math.max(b.minX, panX));
    panY = Math.min(b.maxY, Math.max(b.minY, panY));
  }

  function applyCamera() {
    camera.left = panX - frustumW / 2;
    camera.right = panX + frustumW / 2;
    camera.top = panY + frustumH / 2;
    camera.bottom = panY - frustumH / 2;
    camera.updateProjectionMatrix();
  }

  // Pans just enough to bring a cell (plus a small margin) back within the
  // current viewport — used when keyboard focus moves outside the pan window.
  function ensureVisible(cell: CellRef) {
    if (!panEnabled) return;
    const { x, y } = cellPosFor(cell.day, cell.row);
    const margin = SPACING * 0.6;
    let moved = false;
    if (x - margin < panX - frustumW / 2) {
      panX = x - margin + frustumW / 2;
      moved = true;
    } else if (x + margin > panX + frustumW / 2) {
      panX = x + margin - frustumW / 2;
      moved = true;
    }
    if (y + margin > panY + frustumH / 2) {
      panY = y + margin - frustumH / 2;
      moved = true;
    } else if (y - margin < panY - frustumH / 2) {
      panY = y - margin + frustumH / 2;
      moved = true;
    }
    if (moved) {
      clampPan();
      applyCamera();
    }
  }

  function selectAt(clientX: number, clientY: number) {
    const rect = canvas!.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(cellMeshes, false)[0];
    if (hit) onSelectDate(hit.object.userData.date);
  }

  let dragPointerId: number | null = null;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartPanX = 0;
  let dragStartPanY = 0;
  let dragMoved = 0;
  let pxPerWorldUnit = 1;

  function handlePointerDown(event: PointerEvent) {
    dragPointerId = event.pointerId;
    dragStartClientX = event.clientX;
    dragStartClientY = event.clientY;
    dragStartPanX = panX;
    dragStartPanY = panY;
    dragMoved = 0;
    canvas!.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (dragPointerId === null) {
      // No pointer captured — this is a hover move (mouse only; touch
      // never fires pointermove without an active/dragging pointer).
      hoverAt(event.clientX, event.clientY);
      return;
    }
    if (event.pointerId !== dragPointerId) return;
    const deltaClientX = event.clientX - dragStartClientX;
    const deltaClientY = event.clientY - dragStartClientY;
    dragMoved = Math.max(dragMoved, Math.hypot(deltaClientX, deltaClientY));
    if (!panEnabled) return;
    // Content follows the pointer, like scrolling a map.
    panX = dragStartPanX - deltaClientX / pxPerWorldUnit;
    panY = dragStartPanY + deltaClientY / pxPerWorldUnit;
    clampPan();
    applyCamera();
  }

  function handlePointerUp(event: PointerEvent) {
    if (event.pointerId !== dragPointerId) return;
    dragPointerId = null;
    if (dragMoved < DRAG_THRESHOLD_PX) {
      selectAt(event.clientX, event.clientY);
    }
  }

  function handlePointerLeave() {
    setActiveCell(null);
  }

  // Keyboard navigation — the canvas is a plain <canvas>, invisible to
  // screen readers and unreachable by Tab without an explicit tabIndex/role,
  // so arrow-key focus movement + an aria-live announcement (via `announce`,
  // owned by main.js) stand in for what would otherwise be a focusable grid
  // of real elements.
  let focusedCell: CellRef | null = null;

  function defaultFocusCell(): CellRef {
    const now = new Date();
    if (year === now.getFullYear()) {
      const row = months.indexOf(now.getMonth());
      if (row !== -1) return { day: now.getDate(), row };
    }
    return { day: 1, row: 0 };
  }

  function announceFocused() {
    if (!focusedCell) return;
    const mesh = cellMeshByKey.get(cellKey(focusedCell)!);
    if (!mesh) return;
    let text = `${DATE_FORMAT.format(mesh.userData.date)}. ${mesh.userData.phaseName}. ${mesh.userData.illuminatedPercent}% illuminated.`;
    if (mesh.userData.isNewMoon) text += " New moon.";
    if (mesh.userData.isFullMoon) text += " Full moon.";
    announce?.(text);
  }

  function moveFocus(deltaCol: number, deltaRow: number) {
    const current = focusedCell || defaultFocusCell();
    let day: number;
    let row: number;
    if (isCalendar) {
      // The week grid is just the day-of-month axis wrapped every 7 — moving
      // down a row is +7 days, so screen deltas translate straight to it.
      row = current.row;
      day = current.day + deltaCol + deltaRow * 7;
      const maxDay = daysInMonth(year, months[row]!);
      day = Math.min(maxDay, Math.max(1, day));
    } else {
      // deltaCol/deltaRow are screen-space (Right/Down = +1); translate
      // through the current orientation so arrow keys match what's on screen.
      day = current.day + (transposed ? deltaRow : deltaCol);
      row = current.row + (transposed ? deltaCol : deltaRow);
      row = Math.min(rows - 1, Math.max(0, row));
      const maxDay = daysInMonth(year, months[row]!);
      day = Math.min(maxDay, Math.max(1, day));
    }
    focusedCell = { day, row };
    setActiveCell(focusedCell);
    ensureVisible(focusedCell);
    announceFocused();
  }

  function handleKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case "ArrowLeft":
        moveFocus(-1, 0);
        event.preventDefault();
        break;
      case "ArrowRight":
        moveFocus(1, 0);
        event.preventDefault();
        break;
      case "ArrowUp":
        moveFocus(0, -1);
        event.preventDefault();
        break;
      case "ArrowDown":
        moveFocus(0, 1);
        event.preventDefault();
        break;
      case "Enter":
      case " ": {
        const mesh = focusedCell && cellMeshByKey.get(cellKey(focusedCell)!);
        if (mesh) onSelectDate(mesh.userData.date);
        event.preventDefault();
        break;
      }
    }
  }

  function handleFocus() {
    if (!focusedCell) focusedCell = defaultFocusCell();
    setActiveCell(focusedCell);
    announceFocused();
  }

  function handleBlur() {
    // Keep focusedCell remembered so tabbing back returns to the same spot;
    // just stop showing it as active (unless the mouse is now hovering it).
    setActiveCell(null);
  }

  return {
    mount(_container, renderer) {
      canvas = renderer.domElement;
      canvas.addEventListener("pointerdown", handlePointerDown);
      canvas.addEventListener("pointermove", handlePointerMove);
      canvas.addEventListener("pointerup", handlePointerUp);
      canvas.addEventListener("pointerleave", handlePointerLeave);
      canvas.addEventListener("keydown", handleKeyDown);
      canvas.addEventListener("focus", handleFocus);
      canvas.addEventListener("blur", handleBlur);
      canvas.tabIndex = 0;
      canvas.setAttribute("role", "application");
      canvas.setAttribute("aria-label", "Moon phase calendar. Use arrow keys to move, Enter to open a day.");
    },

    update() {
      // Grid cells are static thumbnails — nothing to animate per frame.
    },

    render(renderer) {
      renderer.render(scene, camera);
    },

    resize(width, height) {
      // Calendar mode is a fixed 7-column week grid — it never transposes;
      // narrow screens fall back to the same min-cell-size + pan system as
      // any other layout that doesn't fit at full size.
      const nextTransposed = !isCalendar && height > width;
      if (nextTransposed !== transposed) {
        transposed = nextTransposed;
        panInitialized = false; // re-derive a sensible starting pan below
      }
      // The 1.3x close-pack boost only applies to the desktop single-row
      // "wide strip" case — transposed/multi-row/calendar layouts rely on
      // the min-cell-size + pan system below instead.
      cellScale = !isCalendar && rows === 1 && !transposed ? 1.3 : 1;
      applyLayout();

      const cellDiameterWorld = 2 * CELL_RADIUS * cellScale;
      let { width: fitW, height: fitH } = fitFrustum(contentWidth, contentHeight, width / height);
      const fitCellPx = (cellDiameterWorld / fitW) * width;

      if (fitCellPx >= MIN_CELL_PX) {
        panEnabled = false;
        frustumW = fitW;
        frustumH = fitH;
        pxPerWorldUnit = width / frustumW;
        topInsetWorld = getTopInset() / pxPerWorldUnit;
        // Fit mode already centers content with an even top/bottom margin
        // (frustumH - contentHeight, split both ways) — usually more than
        // enough to clear the nav on its own. Only nudge content down by
        // whatever's left over after that existing margin, rather than the
        // full inset, so desktop/wide screens (which already have plenty of
        // headroom) don't get an oversized, oddly-placed gap under the nav.
        let existingTopMargin = (frustumH - contentHeight) / 2;
        if (topInsetWorld > existingTopMargin) {
          // Near-square content (e.g. the calendar grid) doesn't have wide
          // layouts' huge incidental vertical letterboxing to hide the
          // inset in — without this, nudging content down to clear the nav
          // would push its bottom rows off the bottom of the frustum, with
          // no pan available in fit mode to recover them. Pad the height
          // fitFrustum aims for by the shortfall (doubled, since it splits
          // the pad evenly top/bottom) so frustumH actually has the room.
          const shortfall = topInsetWorld - existingTopMargin;
          ({ width: fitW, height: fitH } = fitFrustum(contentWidth, contentHeight + shortfall * 2, width / height));
          frustumW = fitW;
          frustumH = fitH;
          pxPerWorldUnit = width / frustumW;
          topInsetWorld = getTopInset() / pxPerWorldUnit;
          existingTopMargin = (frustumH - contentHeight) / 2;
        }
        panX = centerX;
        panY = centerY + Math.max(0, topInsetWorld - existingTopMargin);
      } else {
        panEnabled = true;
        const targetPxPerWorldUnit = MIN_CELL_PX / cellDiameterWorld;
        frustumW = width / targetPxPerWorldUnit;
        frustumH = height / targetPxPerWorldUnit;
        pxPerWorldUnit = targetPxPerWorldUnit;
        topInsetWorld = getTopInset() / pxPerWorldUnit;
        if (!panInitialized) {
          // Start at the top-left (day 1 / first month), the natural
          // reading start, rather than centered on the whole grid.
          const b = panBounds();
          panX = b.minX;
          panY = b.maxY;
        }
        clampPan();
      }
      panInitialized = true;
      applyCamera();
    },

    // Called by main.js when the user flips the rings toggle while this
    // grid is already mounted — updates in place, no rebuild needed.
    setRingsVisible(visible: boolean) {
      for (const { sprite } of ringSprites) sprite.visible = visible;
    },

    dispose() {
      if (canvas) {
        canvas.removeEventListener("pointerdown", handlePointerDown);
        canvas.removeEventListener("pointermove", handlePointerMove);
        canvas.removeEventListener("pointerup", handlePointerUp);
        canvas.removeEventListener("pointerleave", handlePointerLeave);
        canvas.removeEventListener("keydown", handleKeyDown);
        canvas.removeEventListener("focus", handleFocus);
        canvas.removeEventListener("blur", handleBlur);
        canvas.style.cursor = "";
        canvas.removeAttribute("tabindex");
        canvas.removeAttribute("role");
        canvas.removeAttribute("aria-label");
      }
      disposables.forEach((d) => d.dispose());
      cells.length = 0;
    },
  };
}
