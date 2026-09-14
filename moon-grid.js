import * as THREE from "three";
import { computeMoonVisual, daysInMonth, localNoon, MONTH_NAMES } from "./astronomy.js";
import { getColorMap } from "./textures.js";
import { createMoonCellMaterial } from "./moon-shader.js";

const SPACING = 2.4;
const CELL_RADIUS = 0.85;
const LEFT_GUTTER = 3.2; // world units reserved for the row-label axis (month names or day numbers)
const TOP_GUTTER = 1.4; // world units reserved for the column-header axis (day numbers or month names)
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

// Shared across every grid mount — a year view and a month view both reuse
// the same low-poly sphere; never disposed, only per-cell materials are.
let sharedCellGeometry = null;
function getCellGeometry() {
  if (!sharedCellGeometry) {
    sharedCellGeometry = new THREE.SphereGeometry(CELL_RADIUS, 20, 14);
  }
  return sharedCellGeometry;
}

// Rasterizes text once at a fixed resolution, solid white — dimming and
// hover-highlighting are done live via material.opacity/color (see
// setLabelHighlighted) rather than by re-rendering the texture. The
// sprite's on-screen size is likewise controlled entirely via .scale (set
// later, per layout) rather than by the texture's pixel size.
function createTextSprite(text, { fontPx = 64 } = {}) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
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
  texture.encoding = THREE.sRGBEncoding;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    opacity: LABEL_OPACITY,
    color: LABEL_COLOR,
  });
  const sprite = new THREE.Sprite(material);
  const worldHeight = 0.7;
  sprite.userData.baseScale = { x: (width / height) * worldHeight, y: worldHeight };
  return sprite;
}

function setLabelHighlighted(sprite, highlighted) {
  if (!sprite) return;
  sprite.material.opacity = highlighted ? LABEL_HOVER_OPACITY : LABEL_OPACITY;
  sprite.material.color.copy(highlighted ? LABEL_HOVER_COLOR : LABEL_COLOR);
  const base = sprite.userData.currentScale || sprite.userData.baseScale;
  const boost = highlighted ? LABEL_HOVER_SCALE : 1;
  sprite.scale.set(base.x * boost, base.y * boost, 1);
}

// "Contain" fit — the whole grid visible, no cropping, letterboxed to match
// the container's aspect ratio exactly (so spheres stay circular).
function fitFrustum(contentWidth, contentHeight, containerAspect) {
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

// months: array of 0-based month indices — [m] for a single month, [0..11]
// for a full year. Same grid builder either way; year view is just "more
// months." On a portrait/narrow viewport the grid transposes — days run
// vertically and months become columns — since scrolling vertically is the
// natural mobile gesture, vs. the horizontal "poster" layout on desktop.
export function createMoonGridView({ year, months, onSelectDate }) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  camera.position.z = 10;

  const cols = 31; // days
  const rows = months.length; // months

  const cells = []; // { mesh, day, row }
  const monthLabels = []; // { sprite, row }
  const dayLabels = []; // { sprite, day }
  const disposables = [];

  months.forEach((month0, row) => {
    const label = createTextSprite(MONTH_NAMES[month0], { fontPx: 56 });
    scene.add(label);
    monthLabels.push({ sprite: label, row });
    disposables.push(label.material.map, label.material);

    const n = daysInMonth(year, month0);
    for (let day = 1; day <= n; day++) {
      const date = localNoon(year, month0, day);
      const { phase } = computeMoonVisual(date);
      const material = createMoonCellMaterial(getColorMap(), phase);
      const mesh = new THREE.Mesh(getCellGeometry(), material);
      mesh.rotation.x = BASE_ROTATION_X;
      mesh.rotation.y = BASE_ROTATION_Y;
      mesh.userData.date = date;
      mesh.userData.day = day;
      mesh.userData.row = row;
      scene.add(mesh);
      cells.push({ mesh, day, row });
      disposables.push(material);
    }
  });

  for (let day = 1; day <= cols; day++) {
    const label = createTextSprite(String(day), { fontPx: 40 });
    scene.add(label);
    dayLabels.push({ sprite: label, day });
    disposables.push(label.material.map, label.material);
  }

  const cellMeshes = cells.map((c) => c.mesh);
  const monthLabelByRow = new Map(monthLabels.map((m) => [m.row, m.sprite]));
  const dayLabelByDay = new Map(dayLabels.map((d) => [d.day, d.sprite]));
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let canvas = null;

  // Hover crosshair — highlights the month/day labels for whichever cell
  // the pointer is currently over. Mouse-only in practice: touch doesn't
  // fire pointermove without an active (dragging) pointer.
  let hoveredCell = null; // { day, row } | null
  function setHover(cell) {
    const changed = !cell !== !hoveredCell || (cell && hoveredCell && (cell.day !== hoveredCell.day || cell.row !== hoveredCell.row));
    if (!changed) return;
    if (hoveredCell) {
      setLabelHighlighted(monthLabelByRow.get(hoveredCell.row), false);
      setLabelHighlighted(dayLabelByDay.get(hoveredCell.day), false);
    }
    if (cell) {
      setLabelHighlighted(monthLabelByRow.get(cell.row), true);
      setLabelHighlighted(dayLabelByDay.get(cell.day), true);
    }
    hoveredCell = cell;
    if (canvas) canvas.style.cursor = cell ? "pointer" : "";
  }

  function hoverAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(cellMeshes, false)[0];
    setHover(hit ? { day: hit.object.userData.day, row: hit.object.userData.row } : null);
  }

  // Layout state, recomputed in resize() since orientation is only known then.
  let transposed = false;
  let cellScale = 1;
  let contentWidth = 0;
  let contentHeight = 0;
  let centerX = 0;
  let centerY = 0;

  function applyLayout() {
    // "Primary" axis = days (31, the long axis) — X when horizontal,
    // Y when transposed. "Secondary" axis = months (1 or 12) — the other one.
    const primaryCount = cols;
    const secondaryCount = rows;
    contentWidth = LEFT_GUTTER + (transposed ? secondaryCount : primaryCount) * SPACING;
    contentHeight = TOP_GUTTER + (transposed ? primaryCount : secondaryCount) * SPACING;
    centerX = contentWidth / 2;
    centerY = -contentHeight / 2;

    function posFor(primaryIndex, secondaryIndex) {
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

    for (const { mesh, day, row } of cells) {
      const { x, y } = posFor(day - 1, row);
      mesh.position.set(x, y, 0);
      mesh.scale.setScalar(cellScale);
    }

    // Month labels sit in the secondary-axis gutter: a left-hand row label
    // normally, a top column header once transposed.
    for (const { sprite, row } of monthLabels) {
      const { x, y } = transposed
        ? { x: LEFT_GUTTER + row * SPACING + SPACING / 2, y: TOP_GUTTER * 0.3 }
        : { x: LEFT_GUTTER * 0.42, y: -TOP_GUTTER - row * SPACING - SPACING / 2 };
      sprite.position.set(x, y, 0);
      sprite.userData.currentScale = { x: sprite.userData.baseScale.x * cellScale, y: sprite.userData.baseScale.y * cellScale };
      sprite.scale.set(sprite.userData.currentScale.x, sprite.userData.currentScale.y, 1);
    }

    // Day labels sit in the primary-axis header: a top header normally,
    // a left-hand row label once transposed.
    for (const { sprite, day } of dayLabels) {
      const { x, y } = transposed
        ? { x: LEFT_GUTTER * 0.42, y: -TOP_GUTTER - (day - 1) * SPACING - SPACING / 2 }
        : { x: LEFT_GUTTER + (day - 1) * SPACING + SPACING / 2, y: SPACING * 0.15 };
      sprite.position.set(x, y, 0);
      sprite.userData.currentScale = { x: sprite.userData.baseScale.x * cellScale, y: sprite.userData.baseScale.y * cellScale };
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

  function panBounds() {
    const minX = frustumW >= contentWidth ? centerX : frustumW / 2;
    const maxX = frustumW >= contentWidth ? centerX : contentWidth - frustumW / 2;
    const maxY = frustumH >= contentHeight ? centerY : -frustumH / 2;
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

  function selectAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(cellMeshes, false)[0];
    if (hit) onSelectDate(hit.object.userData.date);
  }

  let dragPointerId = null;
  let dragStartClientX = 0;
  let dragStartClientY = 0;
  let dragStartPanX = 0;
  let dragStartPanY = 0;
  let dragMoved = 0;
  let pxPerWorldUnit = 1;

  function handlePointerDown(event) {
    dragPointerId = event.pointerId;
    dragStartClientX = event.clientX;
    dragStartClientY = event.clientY;
    dragStartPanX = panX;
    dragStartPanY = panY;
    dragMoved = 0;
    canvas.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event) {
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

  function handlePointerUp(event) {
    if (event.pointerId !== dragPointerId) return;
    dragPointerId = null;
    if (dragMoved < DRAG_THRESHOLD_PX) {
      selectAt(event.clientX, event.clientY);
    }
  }

  function handlePointerLeave() {
    setHover(null);
  }

  return {
    mount(container, renderer) {
      canvas = renderer.domElement;
      canvas.addEventListener("pointerdown", handlePointerDown);
      canvas.addEventListener("pointermove", handlePointerMove);
      canvas.addEventListener("pointerup", handlePointerUp);
      canvas.addEventListener("pointerleave", handlePointerLeave);
    },

    update() {
      // Grid cells are static thumbnails — nothing to animate per frame.
    },

    render(renderer) {
      renderer.render(scene, camera);
    },

    resize(width, height) {
      const nextTransposed = height > width;
      if (nextTransposed !== transposed) {
        transposed = nextTransposed;
        panInitialized = false; // re-derive a sensible starting pan below
      }
      // The 1.3x close-pack boost only applies to the desktop single-row
      // "wide strip" case — transposed/multi-row layouts rely on the
      // min-cell-size + pan system below instead.
      cellScale = rows === 1 && !transposed ? 1.3 : 1;
      applyLayout();

      const cellDiameterWorld = 2 * CELL_RADIUS * cellScale;
      const { width: fitW, height: fitH } = fitFrustum(contentWidth, contentHeight, width / height);
      const fitCellPx = (cellDiameterWorld / fitW) * width;

      if (fitCellPx >= MIN_CELL_PX) {
        panEnabled = false;
        frustumW = fitW;
        frustumH = fitH;
        panX = centerX;
        panY = centerY;
      } else {
        panEnabled = true;
        const targetPxPerWorldUnit = MIN_CELL_PX / cellDiameterWorld;
        frustumW = width / targetPxPerWorldUnit;
        frustumH = height / targetPxPerWorldUnit;
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
      pxPerWorldUnit = width / frustumW;
      applyCamera();
    },

    dispose() {
      if (canvas) {
        canvas.removeEventListener("pointerdown", handlePointerDown);
        canvas.removeEventListener("pointermove", handlePointerMove);
        canvas.removeEventListener("pointerup", handlePointerUp);
        canvas.removeEventListener("pointerleave", handlePointerLeave);
        canvas.style.cursor = "";
      }
      disposables.forEach((d) => d.dispose());
      cells.length = 0;
    },
  };
}
