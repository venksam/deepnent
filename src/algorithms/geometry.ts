import type { Point, Polygon } from '../types'

const DEG = Math.PI / 180

// ── Basic transforms ─────────────────────────────────────────

export function rotatePoint(p: Point, deg: number): Point {
  const r = deg * DEG
  const c = Math.cos(r), s = Math.sin(r)
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c }
}

export function rotatePolygon(poly: Polygon, deg: number): Polygon {
  if (deg === 0) return poly
  return poly.map(p => rotatePoint(p, deg))
}

export function translatePolygon(poly: Polygon, tx: number, ty: number): Polygon {
  return poly.map(p => ({ x: p.x + tx, y: p.y + ty }))
}

export function reflectPolygon(poly: Polygon): Polygon {
  return poly.map(p => ({ x: -p.x, y: -p.y }))
}

// ── Bounds ───────────────────────────────────────────────────

export interface Bounds {
  minX: number; minY: number
  maxX: number; maxY: number
  width: number; height: number
}

export function polygonBounds(poly: Polygon): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of poly) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

export function normalizePolygon(poly: Polygon): Polygon {
  const b = polygonBounds(poly)
  return translatePolygon(poly, -b.minX, -b.minY)
}

// ── Area ─────────────────────────────────────────────────────

export function polygonArea(poly: Polygon): number {
  let area = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += poly[i].x * poly[j].y - poly[j].x * poly[i].y
  }
  return Math.abs(area) / 2
}

// ── Rectangle helper ─────────────────────────────────────────

export function makeRect(w: number, h: number): Polygon {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

// ── Expand polygon (Minkowski sum with a square) ─────────────
/** Offset a convex-enough polygon outward by `amount` mm */
export function offsetPolygon(poly: Polygon, amount: number): Polygon {
  if (amount === 0) return poly
  const n = poly.length
  const result: Polygon = []

  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n]
    const curr = poly[i]
    const next = poly[(i + 1) % n]

    // Edge normals
    const e1 = { x: curr.x - prev.x, y: curr.y - prev.y }
    const e2 = { x: next.x - curr.x, y: next.y - curr.y }

    const len1 = Math.hypot(e1.x, e1.y)
    const len2 = Math.hypot(e2.x, e2.y)
    if (len1 === 0 || len2 === 0) continue

    const n1 = { x: -e1.y / len1, y: e1.x / len1 }
    const n2 = { x: -e2.y / len2, y: e2.x / len2 }

    // Bisector
    let bx = n1.x + n2.x
    let by = n1.y + n2.y
    const bLen = Math.hypot(bx, by)
    if (bLen < 1e-9) {
      bx = n1.x; by = n1.y
    } else {
      bx /= bLen; by /= bLen
    }

    // miter length
    const dot = n1.x * bx + n1.y * by
    const miter = dot < 0.1 ? amount : amount / dot

    result.push({ x: curr.x + bx * miter, y: curr.y + by * miter })
  }
  return result
}

// ── Collision detection (SAT) ────────────────────────────────

function projectPolygon(poly: Polygon, axis: Point): [number, number] {
  let min = Infinity, max = -Infinity
  for (const p of poly) {
    const d = p.x * axis.x + p.y * axis.y
    if (d < min) min = d
    if (d > max) max = d
  }
  return [min, max]
}

export function polygonsOverlap(A: Polygon, B: Polygon, tolerance = 0.01): boolean {
  // Quick AABB
  const ba = polygonBounds(A)
  const bb = polygonBounds(B)
  if (ba.maxX <= bb.minX + tolerance || bb.maxX <= ba.minX + tolerance ||
      ba.maxY <= bb.minY + tolerance || bb.maxY <= ba.minY + tolerance) {
    return false
  }

  // SAT
  for (const poly of [A, B]) {
    const n = poly.length
    for (let i = 0; i < n; i++) {
      const p0 = poly[i], p1 = poly[(i + 1) % n]
      const edge = { x: p1.x - p0.x, y: p1.y - p0.y }
      const normal = { x: -edge.y, y: edge.x }
      const len = Math.hypot(normal.x, normal.y)
      if (len < 1e-9) continue
      normal.x /= len; normal.y /= len

      const [minA, maxA] = projectPolygon(A, normal)
      const [minB, maxB] = projectPolygon(B, normal)
      if (maxA <= minB + tolerance || maxB <= minA + tolerance) return false
    }
  }
  return true
}

// ── Polygon fits inside rectangle? ──────────────────────────

export function fitsInRect(poly: Polygon, w: number, h: number): boolean {
  const b = polygonBounds(poly)
  return b.minX >= -0.001 && b.minY >= -0.001 && b.maxX <= w + 0.001 && b.maxY <= h + 0.001
}

// ── SVG path helper ──────────────────────────────────────────

export function polygonToSvgPath(poly: Polygon): string {
  if (poly.length === 0) return ''
  const pts = poly.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
  return pts.join(' ') + ' Z'
}

// ── Generate allowed rotations ────────────────────────────────

export function getAllowedRotations(steps: number): number[] {
  if (steps <= 1) return [0]
  const rots: number[] = []
  for (let i = 0; i < steps; i++) {
    rots.push((360 / steps) * i)
  }
  return rots
}
