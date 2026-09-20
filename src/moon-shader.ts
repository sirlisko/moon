import * as THREE from "three";

const AMBIENT = 0.04;
// A faint additive edge light, so an unlit new-moon cell still reads as a
// sphere against the black background rather than as an empty slot. A rim
// rather than more ambient light keeps every other day's terminator crisp.
const RIM = 0.2;

// Turns a 0..1 phase fraction into a world-space sun direction. This is the
// single source of truth for "which way is the sun" — both the grid's
// per-cell shader material and the detail view's DirectionalLight derive
// their lighting from this same function, so the two views can't diverge.
// theta=0 → new moon (light behind moon), theta=π → full moon (light toward viewer).
export function sunDirFromPhase(phase: number): THREE.Vector3 {
  const theta = phase * 2 * Math.PI;
  return new THREE.Vector3(Math.sin(theta), 0.1, -Math.cos(theta)).normalize();
}

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 uSunDir;
  uniform float uAmbient;
  uniform float uRim;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 texColor = texture2D(map, vUv).rgb;
    float ndotl = max(dot(normal, uSunDir), 0.0);
    float lit = uAmbient + (1.0 - uAmbient) * ndotl;
    // The cell camera is orthographic down -Z, so the view direction is a
    // constant (0, 0, 1) and the silhouette is where the normal turns away.
    float rim = pow(1.0 - abs(normal.z), 5.0) * uRim;
    gl_FragColor = vec4(texColor * lit + vec3(rim), 1.0);
  }
`;

// A lightweight, self-lit material for grid-cell thumbnails: no scene lights
// involved, just a per-material sun-direction uniform — lets hundreds of
// cells each show a different, correct terminator without touching
// three.js's scene-light/light-count machinery.
export function createMoonCellMaterial(colorMap: THREE.Texture, phase: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: colorMap },
      uSunDir: { value: sunDirFromPhase(phase) },
      uAmbient: { value: AMBIENT },
      uRim: { value: RIM },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
}
