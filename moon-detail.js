import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { computeMoonState, getPhaseName, azimuthToCompass } from "./astronomy.js";
import { getColorMap, getDisplacementMap } from "./textures.js";
import { sunDirFromPhase } from "./moon-shader.js";

const BASE_ROTATION_Y = Math.PI * 1.54;
const BASE_ROTATION_X = Math.PI * 0.02;
const REFRESH_INTERVAL_MS = 30000;
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 0, 5);
const DEFAULT_CAMERA_DIR = DEFAULT_CAMERA_POSITION.clone().normalize();

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "long",
  day: "numeric",
});

// The single "moon as seen from here" 3D view. `live: true` (the "Today" nav
// entry) recomputes from the real clock every 30s; otherwise it's a static
// snapshot at local noon on `date`, reached by clicking a calendar cell.
//
// `location` is a shared mutable ref ({ coords, status }) owned by main.js —
// status is "idle" | "pending" | "granted" | "denied" | "unsupported".
// Geolocation is never requested automatically; `onRequestLocation` (from
// main.js) is only called when the user clicks the "Use my location" button,
// and views read location.coords/status fresh on every refresh() call, so
// a later grant still takes effect via refreshLocation().
export function createMoonDetailView({ date, location, live, onBack, onRequestLocation }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  camera.position.copy(DEFAULT_CAMERA_POSITION);

  const moon = new THREE.Mesh(
    new THREE.SphereGeometry(2, 60, 60),
    new THREE.MeshPhongMaterial({
      color: 0xffffff,
      map: getColorMap(),
      displacementMap: getDisplacementMap(),
      displacementScale: 0.06,
      bumpMap: getDisplacementMap(),
      bumpScale: 0.04,
      reflectivity: 0,
      shininess: 0,
    })
  );
  moon.rotation.x = BASE_ROTATION_X;
  moon.rotation.y = BASE_ROTATION_Y;
  scene.add(moon);

  const starPositions = new Float32Array(8000 * 3);
  for (let i = 0; i < 8000; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    const r = 800;
    starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPositions[i * 3 + 2] = r * Math.cos(phi);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(
    starGeometry,
    new THREE.PointsMaterial({ color: 0xffffff, size: 0.7, sizeAttenuation: true })
  );
  scene.add(stars);

  const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(sunLight);

  const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.015);
  hemiLight.color.setHSL(0.6, 1, 0.6);
  hemiLight.groundColor.setHSL(0.095, 1, 0.75);
  scene.add(hemiLight);

  let controls = null;
  let moonState = null;
  let intervalId = null;
  let root = null;
  let hud = null;
  let label = null;
  let backButton = null;
  let resetButton = null;
  let locationButton = null;

  function applyMoonState(state) {
    moonState = state;
    const sunDir = sunDirFromPhase(state.phase);
    sunLight.position.copy(sunDir).multiplyScalar(100);
  }

  function refresh() {
    const at = live ? new Date() : date;
    applyMoonState(computeMoonState(at, location.coords));

    const lines = [`${getPhaseName(moonState.phase)} · ${moonState.illuminatedPercent}% illuminated`];
    if (moonState.horizon) {
      const alt = moonState.horizon.altitude;
      const when = live ? "right now" : "at local noon";
      lines.push(
        alt > 0
          ? `${alt.toFixed(0)}° above the ${azimuthToCompass(moonState.horizon.azimuth)} horizon ${when}`
          : `below the horizon ${when}`
      );
    } else if (location.status === "denied") {
      lines.push("Location unavailable — showing geocentric view");
    } else if (location.status === "unsupported") {
      lines.push("Geolocation not supported — showing geocentric view");
    }
    if (!live) lines.push(DATE_FORMAT.format(date));
    if (label) label.innerHTML = lines.join("<br>");

    if (locationButton) {
      const needsButton = !moonState.horizon && (location.status === "idle" || location.status === "pending");
      locationButton.hidden = !needsButton;
      if (needsButton) {
        locationButton.disabled = location.status === "pending";
        locationButton.textContent = location.status === "pending" ? "Locating…" : "📍 Use my location";
      }
    }
  }

  return {
    mount(container, renderer) {
      root = container;

      // Stacked in a bottom-anchored flex column so the button and label
      // never overlap regardless of how many lines the label wraps to.
      hud = document.createElement("div");
      hud.className = "moon-hud";
      root.appendChild(hud);

      locationButton = document.createElement("button");
      locationButton.className = "location-button";
      locationButton.hidden = true;
      locationButton.addEventListener("click", () => onRequestLocation?.());
      hud.appendChild(locationButton);

      label = document.createElement("div");
      label.className = "moon-label";
      hud.appendChild(label);

      if (onBack) {
        backButton = document.createElement("button");
        backButton.className = "back-button";
        backButton.textContent = "← Back to calendar";
        backButton.addEventListener("click", onBack);
        root.appendChild(backButton);
      }

      resetButton = document.createElement("button");
      resetButton.className = "reset-button";
      resetButton.textContent = "Reset view";
      resetButton.hidden = true;
      resetButton.addEventListener("click", () => {
        camera.position.copy(DEFAULT_CAMERA_POSITION);
        controls.update();
      });
      root.appendChild(resetButton);

      controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.25;

      refresh();
      if (live) {
        intervalId = setInterval(refresh, REFRESH_INTERVAL_MS);
      }
    },

    update() {
      moon.rotation.y = BASE_ROTATION_Y + moonState.libLonRad;
      moon.rotation.x = BASE_ROTATION_X + moonState.libLatRad;
      moon.rotation.z = moonState.parallacticAngle;
      controls.update();

      // Only rotation away from the default view matters here — zooming
      // in/out doesn't change which way you're "looking," so it shouldn't
      // surface the reset control.
      const rotated = camera.position.clone().normalize().dot(DEFAULT_CAMERA_DIR) < 0.9999;
      if (resetButton) resetButton.hidden = !rotated;
    },

    render(renderer) {
      renderer.render(scene, camera);
    },

    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },

    // Called by main.js when geolocation resolves after this view already
    // mounted — recomputes with the now-available coordinates.
    refreshLocation: refresh,

    dispose() {
      if (intervalId) clearInterval(intervalId);
      if (controls) controls.dispose();
      if (hud) hud.remove();
      if (backButton) backButton.remove();
      if (resetButton) resetButton.remove();
      moon.geometry.dispose();
      moon.material.dispose();
      starGeometry.dispose();
      stars.material.dispose();
    },
  };
}
