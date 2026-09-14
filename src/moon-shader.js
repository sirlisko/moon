import * as THREE from "three";

const AMBIENT = 0.04;

// Turns a 0..1 phase fraction into a world-space sun direction. This is the
// single source of truth for "which way is the sun" — both the grid's
// per-cell shader material and the detail view's DirectionalLight derive
// their lighting from this same function, so the two views can't diverge.
// theta=0 → new moon (light behind moon), theta=π → full moon (light toward viewer).
export function sunDirFromPhase(phase) {
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
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  void main() {
    vec3 texColor = texture2D(map, vUv).rgb;
    float ndotl = max(dot(normalize(vWorldNormal), uSunDir), 0.0);
    float lit = uAmbient + (1.0 - uAmbient) * ndotl;
    gl_FragColor = vec4(texColor * lit, 1.0);
  }
`;

// A lightweight, self-lit material for grid-cell thumbnails: no scene lights
// involved, just a per-material sun-direction uniform — lets hundreds of
// cells each show a different, correct terminator without touching
// three.js's scene-light/light-count machinery.
export function createMoonCellMaterial(colorMap, phase) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: colorMap },
      uSunDir: { value: sunDirFromPhase(phase) },
      uAmbient: { value: AMBIENT },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
}
