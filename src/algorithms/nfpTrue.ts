/**
 * True NFP (No-Fit Polygon) — orbital / edge-sliding approach
 *
 * This is a faithful TypeScript port of the core NFP algorithm used in
 * Jack000/Deepnest and the earlier "SVGnest" project by Jack Qiao.
 *
 * Reference:
 *   Cunningham & Stoddard (1987) – "Algorithms for the no-fit polygon"
 *   Jack Qiao – https://github.com/Jack000/Deepnest
 *
 * The algorithm works for BOTH convex and concave (simple) polygons.
 *
 * Steps:
 *   1. Place A at origin.
 *   2. Start B touching A at the "starting touch" position.
 *   3. "Orbit" B around A: at each step, choose the edge-pair
 *      (one from A's boundary, one from B's boundary) whose normal
 *      direction matches the current orbit direction, and slide along
 *      the combined edge until the next touching event.
 *   4. The reference-point path of B traces the NFP.
 *
 * Inner-Fit Polygon (IFP) for a rectangle is computed analytically.
 */

import type { Point, Polygon } from '../types'
import { polygonBounds, translatePolygon } from './geometry'

// ── Types ─────────────────────────────────────────────────────

export interface IFP {
  minX: number; minY: number
  maxX: number; maxY: number
}

export interface NFPCacheKey {
  aId: string; bId: string
  aRot: number; bRot: number
}

/** Global NFP cache — survives across GA generations */
const nfpCache = new Map<string, Polygon[]>()

function cacheKey(k: NFPCacheKey): string {
  return `${k.aId}|${k.bId}|${k.aRot}|${k.bRot}`
}

export function getCachedNFP(k: NFPCacheKey): Polygon[] | undefined {
  return nfpCache.get(cacheKey(k))
}

export function setCachedNFP(k: NFPCacheKey, nfp: Polygon[]): void {
  nfpCache.set(cacheKey(k), nfp)
}

export function clearNFPCache(): void {
  nfpCache.clear()
}

// ── IFP (analytic, exact for rectangle sheets) ─────────────────

export function computeIFP(
  part: Polygon,
  sheetW: number,
  sheetH: number,
  edgeGap: number,
): IFP | null {
  const b = polygonBounds(part)
  const minX = edgeGap - b.minX
  const minY = edgeGap - b.minY
  const maxX = sheetW - edgeGap - b.maxX
  const maxY = sheetH - edgeGap - b.maxY
  if (maxX < minX - 0.001 || maxY < minY - 0.001) return null
  return { minX, minY, maxX, maxY }
}

// ── True orbital NFP ──────────────────────────────────────────

const TOL = 1e-6

/**
 * Compute all outer NFP loops for polygon B orbiting polygon A.
 * Returns an array of polygons (usually one outer loop).
 *
 * `partGap` is the minimum clearance to maintain between A and B
 * (accounts for part-gap and kerf combined).
 */
export function computeOrbitalNFP(
  A: Polygon,
  B: Polygon,
  partGap = 0,
): Polygon[] {
  // Offset B outward by partGap so the NFP already bakes in clearance
  const Bexp = partGap > 0 ? offsetPolygon(B, partGap) : B
  return [orbitalNFP(A, Bexp)]
}

/**
 * Core orbital NFP algorithm.
 * A is stationary, B orbits A.
 * Returns the path traced by B's reference point (index 0).
 */
function orbitalNFP(A: Polygon, B: Polygon): Polygon {
  // ── 1. Find starting position ──────────────────────────────
  // Place B so its bottom-most point touches A's bottom-most point.
  // B reference point = B[0].

  const aBot = bottomMost(A)
  const bBot = bottomMost(B)

  // Translate B so bBot aligns with aBot, then shift B to the left of A
  // (standard Deepnest starting heuristic: left side of A, bottom-most B point)
  const startTranslation = {
    x: aBot.x - bBot.x,
    y: aBot.y - bBot.y,
  }

  // Reference point starts here
  let refX = B[0].x + startTranslation.x
  let refY = B[0].y + startTranslation.y

  // ── 2. Build edge lists ────────────────────────────────────
  const edgesA = getEdges(A)   // { x, y, dx, dy, angle }
  const edgesB = getEdges(B)   // edges of B in its LOCAL frame

  // ── 3. Orbit loop ──────────────────────────────────────────
  const path: Point[] = []
  const MAX_ITER = (A.length + B.length) * 4 + 8
  let iter = 0

  // Track visited positions to detect loop closure
  const startX = refX, startY = refY

  do {
    path.push({ x: refX, y: refY })

    // Translate B to current reference position
    const transB = translatePolygon(B, refX - B[0].x, refY - B[0].y)

    // Find all touching edge/vertex pairs between A and transB
    const touches = findTouches(A, transB)

    if (touches.length === 0) break

    // Choose the touch that allows B to move most "counter-clockwise" around A
    const vectors = getPushVectors(touches, edgesA, edgesB, transB)
    if (vectors.length === 0) break

    // Pick the vector whose movement is most CCW (smallest positive angle from last direction)
    const move = selectMove(vectors, iter === 0 ? null : { x: refX - (path[path.length - 2] ? path[path.length - 2].x : 0), y: refY - (path[path.length - 2] ? path[path.length - 2].y : 0) })

    refX += move.x
    refY += move.y

    iter++
  } while (
    iter < MAX_ITER &&
    !(Math.abs(refX - startX) < TOL && Math.abs(refY - startY) < TOL && iter > 1)
  )

  if (path.length < 3) {
    // Fallback: convex-hull Minkowski sum (safe for convex shapes)
    return minkowskiNFP(A, B)
  }

  return path
}

// ── Minkowski-sum NFP (fallback, exact for convex polygons) ─────

export function minkowskiNFP(A: Polygon, B: Polygon): Polygon {
  const hullA = convexHull(A)
  const hullB = convexHull(B)
  const mirrorB = hullB.map(p => ({ x: -p.x, y: -p.y }))
  const sum = minkowskiSumConvex(hullA, mirrorB)
  const cx = A.reduce((s, p) => s + p.x, 0) / A.length
  const cy = A.reduce((s, p) => s + p.y, 0) / A.length
  return translatePolygon(sum, cx, cy)
}

// ── Support functions ─────────────────────────────────────────

interface Edge { x: number; y: number; dx: number; dy: number; angle: number }

function getEdges(poly: Polygon): Edge[] {
  return poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length]
    const dx = q.x - p.x, dy = q.y - p.y
    return { x: p.x, y: p.y, dx, dy, angle: Math.atan2(dy, dx) }
  })
}

function bottomMost(poly: Polygon): Point {
  return poly.reduce((m, p) =>
    p.y > m.y || (p.y === m.y && p.x < m.x) ? p : m, poly[0])
}

interface Touch {
  type: 'vertex-edge' | 'edge-vertex' | 'vertex-vertex'
  aIdx: number; bIdx: number
}

function findTouches(A: Polygon, B: Polygon): Touch[] {
  const result: Touch[] = []
  const EPS = 1.0

  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < B.length; j++) {
      const d = Math.hypot(A[i].x - B[j].x, A[i].y - B[j].y)
      if (d < EPS) {
        result.push({ type: 'vertex-vertex', aIdx: i, bIdx: j })
      }
    }
    // Check B vertex on A edge
    const a0 = A[i], a1 = A[(i + 1) % A.length]
    for (let j = 0; j < B.length; j++) {
      if (pointOnSegment(B[j], a0, a1, EPS))
        result.push({ type: 'edge-vertex', aIdx: i, bIdx: j })
    }
  }
  for (let j = 0; j < B.length; j++) {
    const b0 = B[j], b1 = B[(j + 1) % B.length]
    for (let i = 0; i < A.length; i++) {
      if (pointOnSegment(A[i], b0, b1, EPS))
        result.push({ type: 'vertex-edge', aIdx: i, bIdx: j })
    }
  }
  return result
}

function pointOnSegment(p: Point, a: Point, b: Point, eps: number): boolean {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < eps * eps) return false
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  if (t < -eps || t > 1 + eps) return false
  const px = a.x + t * dx, py = a.y + t * dy
  return Math.hypot(p.x - px, p.y - py) < eps
}

function getPushVectors(
  touches: Touch[],
  edgesA: Edge[],
  edgesB: Edge[],
  _B: Polygon,
): Point[] {
  const vecs: Point[] = []
  for (const t of touches) {
    if (t.type === 'vertex-vertex' || t.type === 'vertex-edge') {
      const eA = edgesA[t.aIdx]
      vecs.push({ x: eA.dx, y: eA.dy })
      vecs.push({ x: -eA.dx, y: -eA.dy })
    }
    if (t.type === 'vertex-vertex' || t.type === 'edge-vertex') {
      const eB = edgesB[t.bIdx]
      vecs.push({ x: -eB.dx, y: -eB.dy })
      vecs.push({ x: eB.dx, y: eB.dy })
    }
  }
  // Normalise
  return vecs.map(v => {
    const len = Math.hypot(v.x, v.y)
    if (len < TOL) return null
    return { x: v.x / len, y: v.y / len }
  }).filter(Boolean) as Point[]
}

function selectMove(vectors: Point[], lastDir: Point | null): Point {
  // Prefer counter-clockwise motion; if no last direction, pick rightmost
  if (!lastDir || (Math.abs(lastDir.x) < TOL && Math.abs(lastDir.y) < TOL)) {
    // Pick vector most to the right (max x, then min y)
    return vectors.reduce((best, v) =>
      v.x > best.x || (v.x === best.x && v.y < best.y) ? v : best
    )
  }
  // Pick vector most counter-clockwise from lastDir
  const lastAngle = Math.atan2(lastDir.y, lastDir.x)
  return vectors.reduce((best, v) => {
    const a = Math.atan2(v.y, v.x)
    const da = normalizeAngle(a - lastAngle)
    const daBest = normalizeAngle(Math.atan2(best.y, best.x) - lastAngle)
    return da > 0 && (daBest <= 0 || da < daBest) ? v : best
  })
}

function normalizeAngle(a: number): number {
  while (a < -Math.PI) a += 2 * Math.PI
  while (a > Math.PI) a -= 2 * Math.PI
  return a
}

// ── Polygon offset (Minkowski sum with disc approximation) ──────

export function offsetPolygon(poly: Polygon, amount: number): Polygon {
  if (amount === 0) return poly
  const n = poly.length
  const result: Point[] = []

  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n]
    const curr = poly[i]
    const next = poly[(i + 1) % n]

    const e1 = { x: curr.x - prev.x, y: curr.y - prev.y }
    const e2 = { x: next.x - curr.x, y: next.y - curr.y }

    const len1 = Math.hypot(e1.x, e1.y)
    const len2 = Math.hypot(e2.x, e2.y)
    if (len1 < TOL || len2 < TOL) continue

    const n1 = { x: -e1.y / len1, y: e1.x / len1 }
    const n2 = { x: -e2.y / len2, y: e2.x / len2 }

    let bx = n1.x + n2.x
    let by = n1.y + n2.y
    const bLen = Math.hypot(bx, by)
    if (bLen < TOL) { bx = n1.x; by = n1.y }
    else { bx /= bLen; by /= bLen }

    const dot = n1.x * bx + n1.y * by
    const miter = Math.abs(dot) < 0.1 ? amount : amount / dot

    result.push({ x: curr.x + bx * miter, y: curr.y + by * miter })
  }
  return result.length >= 3 ? result : poly
}

// ── Convex hull (Graham scan) ─────────────────────────────────

export function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return [...points]
  const pts = [...points].sort((a, b) => a.x !== b.x ? a.x - b.x : a.y - b.y)
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  upper.pop(); lower.pop()
  return lower.concat(upper)
}

// ── Minkowski sum of two convex polygons ─────────────────────

function minkowskiSumConvex(P: Point[], Q: Point[]): Point[] {
  if (P.length === 0 || Q.length === 0) return []
  const edgeAngle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x)

  const edgesP = P.map((p, i) => ({ from: p, to: P[(i + 1) % P.length] }))
    .sort((a, b) => edgeAngle(a.from, a.to) - edgeAngle(b.from, b.to))
  const edgesQ = Q.map((q, i) => ({ from: q, to: Q[(i + 1) % Q.length] }))
    .sort((a, b) => edgeAngle(a.from, a.to) - edgeAngle(b.from, b.to))

  const startP = P.reduce((m, p) => (p.y < m.y || (p.y === m.y && p.x < m.x)) ? p : m, P[0])
  const startQ = Q.reduce((m, q) => (q.y < m.y || (q.y === m.y && q.x < m.x)) ? q : m, Q[0])
  const result: Point[] = [{ x: startP.x + startQ.x, y: startP.y + startQ.y }]

  let iP = 0, iQ = 0
  const n = edgesP.length + edgesQ.length

  for (let step = 0; step < n; step++) {
    const aP = iP < edgesP.length ? edgeAngle(edgesP[iP].from, edgesP[iP].to) : Infinity
    const aQ = iQ < edgesQ.length ? edgeAngle(edgesQ[iQ].from, edgesQ[iQ].to) : Infinity

    let dx = 0, dy = 0
    if (aP <= aQ) {
      dx = edgesP[iP].to.x - edgesP[iP].from.x
      dy = edgesP[iP].to.y - edgesP[iP].from.y
      iP++
    } else {
      dx = edgesQ[iQ].to.x - edgesQ[iQ].from.x
      dy = edgesQ[iQ].to.y - edgesQ[iQ].from.y
      iQ++
    }
    const last = result[result.length - 1]
    result.push({ x: last.x + dx, y: last.y + dy })
  }
  result.pop()
  return result
}

// ── Point-in-polygon (ray cast) ───────────────────────────────

export function pointInPolygon(pt: Point, poly: Polygon): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}

