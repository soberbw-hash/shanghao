import type { SceneZoneId } from "@private-voice/shared";

import { isSeatZone, seatSlots } from "./sceneZones";

export interface CharacterMotionPoint {
  left: number;
  top: number;
}

export type CharacterRouteKind = "enter" | "move" | "exit";

export interface CharacterMotionRoute {
  points: CharacterMotionPoint[];
  times: number[];
  length: number;
  duration: number;
  strideDurationMs: number;
  direction: "left" | "right";
}

const ENTRY_POINT: CharacterMotionPoint = { left: -9, top: 56 };
const EXIT_POINT: CharacterMotionPoint = { left: -9, top: 56 };
const EPSILON = 0.01;
const DESK_HALF_WIDTH = 8.8;
const DESK_TOP_CLEARANCE = 10;
const DESK_BOTTOM_CLEARANCE = 9.5;
const CORNER_CLEARANCE = 0.8;

interface CollisionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const distanceBetween = (from: CharacterMotionPoint, to: CharacterMotionPoint): number =>
  Math.hypot(to.left - from.left, to.top - from.top);

const routeLength = (points: CharacterMotionPoint[]): number =>
  points
    .slice(1)
    .reduce((total, point, index) => total + distanceBetween(points[index]!, point), 0);

const routeTimes = (points: CharacterMotionPoint[]): number[] => {
  const total = routeLength(points);
  if (total <= EPSILON) return points.map((_, index) => (index === 0 ? 0 : 1));

  let travelled = 0;
  return points.map((point, index) => {
    if (index === 0) return 0;
    travelled += distanceBetween(points[index - 1]!, point);
    return clamp(travelled / total, 0, 1);
  });
};

const containsPoint = (rect: CollisionRect, point: CharacterMotionPoint): boolean =>
  point.left >= rect.left &&
  point.left <= rect.right &&
  point.top >= rect.top &&
  point.top <= rect.bottom;

const deskObstacles = (
  start: CharacterMotionPoint,
  destination: CharacterMotionPoint,
  fromZone?: SceneZoneId,
  toZone?: SceneZoneId,
): CollisionRect[] =>
  seatSlots
    .filter((slot) => slot.id !== fromZone && slot.id !== toZone)
    .map((slot) => ({
      left: slot.left - DESK_HALF_WIDTH,
      right: slot.left + DESK_HALF_WIDTH,
      top: slot.top - DESK_TOP_CLEARANCE,
      bottom: slot.top + DESK_BOTTOM_CLEARANCE,
    }))
    // An interrupted animation can restart while the character is still inside
    // the previous desk footprint. Treat that desk as the current doorway so
    // the new route can leave it instead of falling back to a blocked segment.
    .filter((rect) => !containsPoint(rect, start) && !containsPoint(rect, destination));

const segmentIntersectsRectInterior = (
  from: CharacterMotionPoint,
  to: CharacterMotionPoint,
  rect: CollisionRect,
): boolean => {
  // Liang-Barsky clipping against a slightly shrunken rectangle treats grazing
  // a safe corner as valid while still rejecting paths through the desk body.
  const inner = {
    left: rect.left + EPSILON,
    right: rect.right - EPSILON,
    top: rect.top + EPSILON,
    bottom: rect.bottom - EPSILON,
  };
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const p = [-dx, dx, -dy, dy];
  const q = [
    from.left - inner.left,
    inner.right - from.left,
    from.top - inner.top,
    inner.bottom - from.top,
  ];
  let entry = 0;
  let exit = 1;

  for (let index = 0; index < p.length; index += 1) {
    const direction = p[index]!;
    const distance = q[index]!;
    if (Math.abs(direction) <= EPSILON) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) entry = Math.max(entry, ratio);
    else exit = Math.min(exit, ratio);
    if (entry > exit) return false;
  }
  return exit >= 0 && entry <= 1;
};

const hasLineOfSight = (
  from: CharacterMotionPoint,
  to: CharacterMotionPoint,
  obstacles: CollisionRect[],
): boolean => obstacles.every((rect) => !segmentIntersectsRectInterior(from, to, rect));

const obstacleCorners = (rect: CollisionRect): CharacterMotionPoint[] => [
  { left: rect.left - CORNER_CLEARANCE, top: rect.top - CORNER_CLEARANCE },
  { left: rect.right + CORNER_CLEARANCE, top: rect.top - CORNER_CLEARANCE },
  { left: rect.right + CORNER_CLEARANCE, top: rect.bottom + CORNER_CLEARANCE },
  { left: rect.left - CORNER_CLEARANCE, top: rect.bottom + CORNER_CLEARANCE },
];

const shortestVisibleRoute = (
  start: CharacterMotionPoint,
  destination: CharacterMotionPoint,
  obstacles: CollisionRect[],
): CharacterMotionPoint[] => {
  if (hasLineOfSight(start, destination, obstacles)) return [start, destination];

  const nodes = [start, destination, ...obstacles.flatMap(obstacleCorners)];
  const distances = nodes.map(() => Number.POSITIVE_INFINITY);
  const previous = nodes.map(() => -1);
  const visited = nodes.map(() => false);
  distances[0] = 0;

  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let current = -1;
    for (let index = 0; index < nodes.length; index += 1) {
      if (!visited[index] && (current < 0 || distances[index]! < distances[current]!)) {
        current = index;
      }
    }
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === 1) break;
    visited[current] = true;

    for (let next = 0; next < nodes.length; next += 1) {
      if (next === current || visited[next]) continue;
      if (!hasLineOfSight(nodes[current]!, nodes[next]!, obstacles)) continue;
      const candidate = distances[current]! + distanceBetween(nodes[current]!, nodes[next]!);
      if (candidate + EPSILON < distances[next]!) {
        distances[next] = candidate;
        previous[next] = current;
      }
    }
  }

  if (!Number.isFinite(distances[1])) return [start, destination];
  const route: CharacterMotionPoint[] = [];
  for (let current = 1; current >= 0; current = previous[current]!) {
    route.push(nodes[current]!);
    if (current === 0) break;
  }
  return route.reverse();
};

const routeDuration = (
  kind: CharacterRouteKind,
  length: number,
  from: CharacterMotionPoint,
  to: CharacterMotionPoint,
  fromZone?: SceneZoneId,
  toZone?: SceneZoneId,
): number => {
  const naturalDuration = length / 27;
  if (kind === "enter" || kind === "exit") return clamp(naturalDuration, 1.35, 2.6);
  if (fromZone === "restroomZone" || toZone === "restroomZone") {
    return clamp(naturalDuration, 1.05, 2.25);
  }
  return clamp(naturalDuration, 1, 2.1);
};

const movementDirection = (points: CharacterMotionPoint[]): "left" | "right" => {
  let strongestHorizontalDelta = 0;
  for (let index = 1; index < points.length; index += 1) {
    const delta = points[index]!.left - points[index - 1]!.left;
    if (Math.abs(delta) > Math.abs(strongestHorizontalDelta)) strongestHorizontalDelta = delta;
  }
  return strongestHorizontalDelta < 0 ? "left" : "right";
};

export const planCharacterRoute = ({
  kind,
  from,
  to,
  fromZone,
  toZone,
}: {
  kind: CharacterRouteKind;
  from: CharacterMotionPoint;
  to: CharacterMotionPoint;
  fromZone?: SceneZoneId;
  toZone?: SceneZoneId;
}): CharacterMotionRoute => {
  const start = kind === "enter" ? ENTRY_POINT : from;
  const destination = kind === "exit" ? EXIT_POINT : to;
  const sourceSeat = fromZone && isSeatZone(fromZone) ? fromZone : undefined;
  const targetSeat = toZone && isSeatZone(toZone) ? toZone : undefined;
  const obstacles = deskObstacles(start, destination, sourceSeat, targetSeat);
  // Use the direct segment whenever it is clear. Only a desk collision may add
  // waypoints, and the visibility graph picks the shortest collision-free route.
  const points = shortestVisibleRoute(start, destination, obstacles);

  const length = routeLength(points);
  const duration = routeDuration(kind, length, start, destination, fromZone, toZone);
  const speed = length / Math.max(duration, 0.01);

  return {
    points,
    times: routeTimes(points),
    length,
    duration,
    strideDurationMs: Math.round(clamp(600 - (speed - 18) * 8, 480, 580)),
    direction: kind === "enter" ? "right" : kind === "exit" ? "left" : movementDirection(points),
  };
};

export const sceneEntryPoint = (): CharacterMotionPoint => ({ ...ENTRY_POINT });
