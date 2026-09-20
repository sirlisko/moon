import * as THREE from "three";

const COLOR_URL = "/lroc_color_2k.webp";
const DISPLACEMENT_URL = "/ldem_3_8bit.jpg";

let colorMap: THREE.Texture | null = null;
let displacementMap: THREE.Texture | null = null;
let colorMapLoaded = false;
const colorMapListeners: Array<() => void> = [];
const loader = new THREE.TextureLoader();

// Loaded once and shared across every view/mesh in the app — the grid alone
// can have ~366 meshes, all sampling the same two JPGs.
export function getColorMap(): THREE.Texture {
  if (!colorMap) {
    colorMap = loader.load(COLOR_URL, () => {
      colorMapLoaded = true;
      colorMapListeners.splice(0).forEach((cb) => cb());
    });
    colorMap.colorSpace = THREE.SRGBColorSpace; // color data — gamma-correct
  }
  return colorMap;
}

// Fires once the color map (the visually-dominant texture; the displacement
// map is comparatively tiny) has actually arrived — used to hide the
// startup loading indicator instead of showing a flash of default-gray moon.
export function onColorMapReady(callback: () => void): void {
  if (colorMapLoaded) callback();
  else colorMapListeners.push(callback);
}

export function getDisplacementMap(): THREE.Texture {
  if (!displacementMap) {
    displacementMap = loader.load(DISPLACEMENT_URL); // height data — stays linear
  }
  return displacementMap;
}
