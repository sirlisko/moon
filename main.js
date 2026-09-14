import "./style.css";

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import {
  Body,
  Illumination,
  MoonPhase,
  Libration,
  Observer,
  Equator,
  Horizon,
  SiderealTime,
} from "astronomy-engine";

const textureURL = "./lroc_color_2k.jpg";
const displacementURL = "./ldem_3_8bit.jpg";

function getPhaseName(phase) {
  if (phase < 0.025 || phase >= 0.975) return "New Moon";
  if (phase < 0.225) return "Waxing Crescent";
  if (phase < 0.275) return "First Quarter";
  if (phase < 0.475) return "Waxing Gibbous";
  if (phase < 0.525) return "Full Moon";
  if (phase < 0.725) return "Waning Gibbous";
  if (phase < 0.775) return "Last Quarter";
  return "Waning Crescent";
}

// Angle between the sky's zenith direction and the Moon's north pole, as seen
// by the observer — this is what actually tilts the crescent/terminator to
// match how the Moon looks in the local sky, and depends on latitude + time.
function computeParallacticAngle(date, observer, ra, dec) {
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

// Combines the Moon's real illumination/libration with the observer's
// location (when available) to produce everything the render needs.
function computeMoonState(observerCoords) {
  const date = new Date();
  const illum = Illumination(Body.Moon, date);
  const phase = MoonPhase(date) / 360; // 0 = new, 0.5 = full, 1 = next new
  const lib = Libration(date);

  let parallacticAngle = 0;
  let horizon = null;
  if (observerCoords) {
    const observer = new Observer(observerCoords.lat, observerCoords.lon, 0);
    const eq = Equator(Body.Moon, date, observer, true, true);
    horizon = Horizon(date, observer, eq.ra, eq.dec, "normal");
    parallacticAngle = computeParallacticAngle(date, observer, eq.ra, eq.dec);
  }

  return {
    phase,
    illuminatedPercent: Math.round(illum.phase_fraction * 100),
    libLonRad: lib.elon * (Math.PI / 180),
    libLatRad: lib.elat * (Math.PI / 180),
    parallacticAngle,
    horizon,
  };
}

const COMPASS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];
function azimuthToCompass(deg) {
  return COMPASS[Math.round(deg / 22.5) % 16];
}

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector("#bg") });

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
camera.position.z = 5;
renderer.render(scene, camera);

const textureLoader = new THREE.TextureLoader();
const texture = textureLoader.load(textureURL);
texture.encoding = THREE.sRGBEncoding; // color map — gamma-correct; displacement/bump stays linear
const displacementMap = textureLoader.load(displacementURL);

const moon = new THREE.Mesh(
  new THREE.SphereGeometry(2, 60, 60),
  new THREE.MeshPhongMaterial({
    color: 0xffffff,
    map: texture,
    displacementMap: displacementMap,
    displacementScale: 0.06,
    bumpMap: displacementMap,
    bumpScale: 0.04,
    reflectivity: 0,
    shininess: 0,
  })
);
moon.rotation.x = Math.PI * 0.02;
moon.rotation.y = Math.PI * 1.54;
scene.add(moon);

// Static star field — points distributed uniformly on a large sphere
const starPositions = new Float32Array(8000 * 3);
for (let i = 0; i < 8000; i++) {
  const phi = Math.acos(2 * Math.random() - 1);
  const theta = Math.random() * Math.PI * 2;
  const r = 800;
  starPositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
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

// Sun direction derived from today's phase.
// theta=0 → new moon (light behind moon), theta=π → full moon (light toward viewer / camera).
const sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
scene.add(sunLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.015);
hemiLight.color.setHSL(0.6, 1, 0.6);
hemiLight.groundColor.setHSL(0.095, 1, 0.75);
scene.add(hemiLight);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.25;

const label = document.createElement("div");
label.style.cssText =
  "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);" +
  "color:rgba(255,255,255,0.6);font-family:system-ui,sans-serif;" +
  "font-size:13px;letter-spacing:0.12em;text-transform:uppercase;" +
  "text-align:center;pointer-events:none;";
document.body.appendChild(label);

// Observer coordinates, filled in once geolocation resolves (or left null
// to fall back to a geocentric-only render, with no local sky tilt applied).
let observerCoords = null;
let locationNote = "Locating…";
let moonState;

function refreshMoonState() {
  moonState = computeMoonState(observerCoords);

  const sunTheta = moonState.phase * 2 * Math.PI;
  sunLight.position.set(100 * Math.sin(sunTheta), 10, -100 * Math.cos(sunTheta));

  const lines = [
    `${getPhaseName(moonState.phase)} · ${moonState.illuminatedPercent}% illuminated`,
  ];
  if (moonState.horizon) {
    const alt = moonState.horizon.altitude;
    lines.push(
      alt > 0
        ? `${alt.toFixed(0)}° above the ${azimuthToCompass(moonState.horizon.azimuth)} horizon`
        : `below the horizon right now`
    );
  } else {
    lines.push(locationNote);
  }
  label.innerHTML = lines.join("<br>");
}

refreshMoonState();
setInterval(refreshMoonState, 30000);

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (position) => {
      observerCoords = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };
      refreshMoonState();
    },
    () => {
      locationNote = "Location unavailable — showing geocentric view";
      refreshMoonState();
    }
  );
} else {
  locationNote = "Geolocation not supported — showing geocentric view";
}

function animate() {
  requestAnimationFrame(animate);
  moon.rotation.y = Math.PI * 1.54 + moonState.libLonRad;
  moon.rotation.x = Math.PI * 0.02 + moonState.libLatRad;
  moon.rotation.z = moonState.parallacticAngle;
  controls.update();
  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
