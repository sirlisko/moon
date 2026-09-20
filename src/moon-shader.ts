import * as THREE from "three";

// Earthshine — sunlight bounced off the Earth onto the Moon's night side,
// the real "old moon in the new moon's arms". It replaces what used to be a
// flat ambient term plus an additive rim halo, and does their job (keeping an
// unlit new-moon day from reading as an empty slot) with the right shape: a
// faint fill across the whole Earth-facing disc rather than a ring around it.
//
// As a fraction of SUN_INTENSITY. Real earthshine is ~1/10,000 of sunlight,
// which is invisible in a linear render — the eye's log response is why
// photographs show it at all — so this is a deliberate exaggeration, tuned to
// leave a new moon a dim grey disc against the stars.
const EARTHSHINE = 0.03;
// Earth is blue-white, and the Da Vinci glow reads faintly cool.
const EARTHSHINE_COLOR = 0xdfe9ff;

// Irradiance of the detail view's DirectionalLight, which imports this: the
// cell shader below reproduces that light's Lambert response exactly, so the
// same day is the same brightness as a calendar thumbnail and as the full
// view — they sit on screen one after the other during the open/close
// flight, and any mismatch reads as the moon changing under you.
export const SUN_INTENSITY = 1.6;

// Turns a 0..1 phase fraction into a world-space sun direction. This is the
// single source of truth for "which way is the sun" — both the grid's
// per-cell shader material and the detail view's DirectionalLight derive
// their lighting from this same function, so the two views can't diverge.
// theta=0 → new moon (light behind moon), theta=π → full moon (light toward viewer).
export function sunDirFromPhase(phase: number): THREE.Vector3 {
  const theta = phase * 2 * Math.PI;
  return new THREE.Vector3(Math.sin(theta), 0.1, -Math.cos(theta)).normalize();
}

// Earthshine irradiance for a phase, in the same units as SUN_INTENSITY —
// the other half of the lighting model both views share. Earth is "full" as
// seen from the Moon exactly when the Moon is new for us and dark when the
// Moon is full, so this is the *unlit* fraction of the Moon's disc: bright
// on a thin crescent, gone by full moon. Earth sits in the viewer's own
// direction, which is where both views put this light.
export function earthshineFromPhase(phase: number): number {
  const unlitFraction = (1 + Math.cos(phase * 2 * Math.PI)) / 2;
  return SUN_INTENSITY * EARTHSHINE * unlitFraction;
}

// Linear-space, like every color three.js hands a shader (Color converts from
// sRGB on construction), so the cell shader and the detail view's own
// earthshine light are tinted identically.
export function earthshineColor(): THREE.Color {
  return new THREE.Color(EARTHSHINE_COLOR);
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
  uniform float uSunIntensity;
  uniform float uEarthshine;
  uniform vec3 uEarthshineColor;
  varying vec3 vWorldNormal;
  varying vec2 vUv;
  // three.js only defines this inside its own <common> chunk, which a
  // ShaderMaterial doesn't pull in.
  const float RECIPROCAL_PI_ = 0.3183098862;
  void main() {
    vec3 normal = normalize(vWorldNormal);
    // The color map is flagged SRGBColorSpace, so this sample is already
    // decoded to linear light — which is the space the lighting below (and
    // MeshPhongMaterial's, in the detail view) works in.
    vec3 texColor = texture2D(map, vUv).rgb;
    float ndotl = max(dot(normal, uSunDir), 0.0);
    // Earth is in the viewer's direction, and the cell camera is orthographic
    // down -Z, so the view direction is the constant (0, 0, 1) — earthshine
    // is simply strongest face-on and falls away towards the limb.
    vec3 irradiance = vec3(uSunIntensity * ndotl) + uEarthshineColor * uEarthshine * max(normal.z, 0.0);
    // Lambert BRDF, as MeshPhongMaterial computes it: albedo / π times the
    // light's irradiance. Same numbers as the detail view's two lights (see
    // SUN_INTENSITY / earthshineFromPhase), so a thumbnail and the full view
    // of one day agree.
    gl_FragColor = vec4(texColor * RECIPROCAL_PI_ * irradiance, 1.0);
    // Linear → the renderer's output color space. A ShaderMaterial bypasses
    // the encoding the built-in materials get, and writing linear values
    // straight out is what made these cells read darker and harsher-edged
    // than the same moon in the detail view.
    #include <colorspace_fragment>
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
      uSunIntensity: { value: SUN_INTENSITY },
      uEarthshine: { value: earthshineFromPhase(phase) },
      uEarthshineColor: { value: earthshineColor() },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
  });
}
