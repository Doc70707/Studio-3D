// The camera glides between views instead of jumping, the way a real object would move: it turns, slides and zooms
// together along the shortest turn, settling without overshoot (a critically damped spring). Any grab of the view
// stops the glide where it is, so the camera never fights the mouse.
import * as THREE from "three";

/** How quickly the camera reaches a new view, in seconds (Apple's "response"). */
export const GLIDE_RESPONSE = 0.4;

/**
 * How far along a critically damped spring is after `t` seconds, from 0 to 1. It starts at rest, so the move eases
 * in, and it never passes 1, so the camera never overshoots the view.
 */
export function springProgress(t: number, response = GLIDE_RESPONSE): number {
  if (t <= 0) return 0;
  const w = (2 * Math.PI) / response;
  return 1 - (1 + w * t) * Math.exp(-w * t);
}

/** Close enough to the end that the rest can't be seen: less than a thousandth of the way. */
export const settled = (progress: number) => progress > 0.999;

export interface Pose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
}

/** The camera's turn as a quaternion: looking from `position` at `target`, with `up` up on screen. */
function orientation(p: Pose): THREE.Quaternion {
  const m = new THREE.Matrix4().lookAt(p.position, p.target, p.up);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

/**
 * The camera between two poses: the look-at point slides, the distance to it scales, and the camera turns along the
 * shortest arc. Moving the position in a straight line instead would cut through the part when the view swings round.
 */
export function blendPose(from: Pose, to: Pose, k: number): Pose {
  const q = orientation(from).slerp(orientation(to), k);
  const target = from.target.clone().lerp(to.target, k);
  const d0 = from.position.distanceTo(from.target);
  const d1 = to.position.distanceTo(to.target);
  const distance = d0 + (d1 - d0) * k;
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  return { position: target.clone().addScaledVector(back, distance), target, up };
}

/** Whether the person has asked their system for less motion; the camera then jumps, as before. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}
