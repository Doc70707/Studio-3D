// The ground under the part: the build plate and its grid, or model space's grid alone, drawn by one shader on one
// flat surface. Lines are worked out per pixel, so they stay one crisp, anti-aliased pixel wide at any zoom and never
// shimmer or crowd into a moiré. The spacing adapts to the zoom: finer squares appear as you zoom in, coarser ones take
// over as you zoom out, cross-fading level to level so nothing jumps. The plate and its grid are the same surface, so
// they can't fight over depth (no z-fighting), and there is one draw call whatever the plate's size.
import * as THREE from "three";

/** The grid's spacing: the finest squares (mm) and how many of one level make the next (10 for mm: 1, 10, 100…). */
export interface GridScale {
  unit: number;
  factor: number;
}

export const MM_GRID: GridScale = { unit: 1, factor: 10 };
/** Inches: 1/16", 1/4", 1", 4", 16"… */
export const INCH_GRID: GridScale = { unit: 25.4 / 16, factor: 4 };

/** The finest squares shown are at least this many pixels across; smaller ones have faded out. */
export const MIN_CELL_PIXELS = 10;

/**
 * Which squares show at a zoom: `fine` is the smallest drawn (fading out as `t` goes from 0 to 1), `coarse` the next
 * size up, which takes the fine squares' place as `t` reaches 1. The same sums are done per pixel in the shader.
 */
export function gridLevels(mmPerPixel: number, scale: GridScale): { fine: number; coarse: number; t: number } {
  const lod = Math.max(0, Math.log((mmPerPixel * MIN_CELL_PIXELS) / scale.unit) / Math.log(scale.factor));
  const level = Math.floor(lod);
  const fine = scale.unit * scale.factor ** level;
  return { fine, coarse: fine * scale.factor, t: lod - level };
}

/** The squares a grid snap should use at a zoom: the finest ones still clearly drawn. */
export function snapStep(mmPerPixel: number, scale: GridScale): number {
  const { fine, coarse, t } = gridLevels(mmPerPixel, scale);
  return t < 0.5 ? fine : coarse;
}

export interface GroundColors {
  plate: number;
  gridMinor: number;
  gridMajor: number;
}

export interface GroundOptions {
  width: number;
  depth: number;
  /** Draw the plate's surface; without it, the grid alone (model space). */
  surface: boolean;
  grid: boolean;
  scale: GridScale;
  colors: GroundColors;
  /** The camera's distance from what it looks at, updated each frame; the grid fades a few times further out. */
  focus: { value: number };
}

const vertexShader = /* glsl */ `
  varying vec2 vWorld;
  varying float vDepth;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xy;
    vec4 view = viewMatrix * world;
    vDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec2 halfSize;
  uniform float radius;
  uniform float surface;
  uniform float showGrid;
  uniform float unit;
  uniform float factor;
  uniform float minCellPixels;
  uniform float focus;
  uniform vec3 plateColor;
  uniform float plateAlpha;
  uniform vec3 minorColor;
  uniform vec3 majorColor;
  uniform vec3 xColor;
  uniform vec3 yColor;
  varying vec2 vWorld;
  varying float vDepth;

  // How much of a pixel is covered by grid lines of this spacing, lines 'widthPx' wide, anti-aliased. Where the squares
  // get too small to tell apart on screen (seen edge-on), the lines fade instead of merging into a solid mass.
  float lines(vec2 p, float spacing, float widthPx) {
    vec2 cell = p / spacing;
    vec2 perPixel = max(fwidth(cell), vec2(1e-6));
    vec2 toLine = abs(fract(cell - 0.5) - 0.5) / perPixel; // pixels to the nearest line, each way
    vec2 cover = clamp(widthPx * 0.5 + 0.5 - toLine, 0.0, 1.0);
    cover *= 1.0 - smoothstep(0.15, 0.35, perPixel);
    return max(cover.x, cover.y);
  }

  // Coverage of a line along one axis (|d| = 0), in pixels of 'perPixel'.
  float axis(float d, float perPixel, float widthPx) {
    return clamp(widthPx * 0.5 + 0.5 - abs(d) / max(perPixel, 1e-6), 0.0, 1.0);
  }

  void main() {
    vec2 p = vWorld;
    vec2 mmPerPixel = fwidth(p);
    float px = max(mmPerPixel.x, mmPerPixel.y);

    // The plate's rounded outline, anti-aliased.
    vec2 q = abs(p) - (halfSize - radius);
    float edge = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
    float inside = 1.0 - smoothstep(-px, px, edge);
    if (inside <= 0.0) discard;

    // Level of detail: the finest squares at least minCellPixels across, cross-fading into the next size up.
    float lod = max(0.0, log(px * minCellPixels / unit) / log(factor));
    float level = floor(lod);
    float t = lod - level;
    float fine = unit * pow(factor, level);
    float l0 = lines(p, fine, 1.0) * (1.0 - t);
    float l1 = lines(p, fine * factor, 1.0);
    float l2 = lines(p, fine * factor * factor, 1.25);
    // The middle size changes from major to minor as the finest fades, so the weights never jump.
    float minor = max(l0, l1 * t);
    float major = max(l1 * (1.0 - t), l2);

    // Far away the grid fades out, so the horizon stays calm; the model stays the thing you look at.
    float away = 1.0 - smoothstep(focus * 3.0, focus * 8.0, vDepth);
    // Model space's grid also thins out towards its far edge.
    float rim = surface > 0.5 ? 1.0 : 1.0 - smoothstep(-halfSize.x * 0.4, 0.0, edge);
    float g = showGrid * away * rim;

    vec4 color = vec4(plateColor, plateAlpha * surface);
    color = mix(color, vec4(minorColor, 1.0), minor * g * 0.75);
    color = mix(color, vec4(majorColor, 1.0), major * g);
    float xLine = axis(p.y, mmPerPixel.y, 1.25) * away * rim;
    float yLine = axis(p.x, mmPerPixel.x, 1.25) * away * rim;
    color = mix(color, vec4(xColor, 0.85), xLine * 0.8);
    color = mix(color, vec4(yColor, 0.85), yLine * 0.8);
    color.a *= inside;
    if (color.a < 0.002) discard;
    gl_FragColor = color;
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** The plate (or model space's grid): one flat surface at the height of the plate, centred on the origin. */
export function buildGround(o: GroundOptions): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      halfSize: { value: new THREE.Vector2(o.width / 2, o.depth / 2) },
      radius: { value: o.surface ? Math.min(o.width, o.depth) * 0.04 : 0 },
      surface: { value: o.surface ? 1 : 0 },
      showGrid: { value: o.grid ? 1 : 0 },
      unit: { value: o.scale.unit },
      factor: { value: o.scale.factor },
      minCellPixels: { value: MIN_CELL_PIXELS },
      focus: o.focus,
      plateColor: { value: new THREE.Color(o.colors.plate) },
      plateAlpha: { value: 0.72 },
      minorColor: { value: new THREE.Color(o.colors.gridMinor) },
      majorColor: { value: new THREE.Color(o.colors.gridMajor) },
      xColor: { value: new THREE.Color(0xd9534f) },
      yColor: { value: new THREE.Color(0x5cb85c) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(o.width, o.depth), material);
  mesh.name = o.surface ? "build-plate" : "model-space";
  // Just under the part's base, so the part's own bottom face always wins the depth test.
  mesh.position.z = -0.01;
  return mesh;
}
