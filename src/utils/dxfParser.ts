/**
 * DXF Parser — two-pass block approach.
 *
 * Pass 1: tokenise all group-code pairs, split into entity blocks.
 * Pass 2: process each block by entity type — no state machine,
 *         no risk of "pending vertex gets dropped at ENDSEC".
 *
 * Supported entities:
 *   LWPOLYLINE (with bulge arcs)
 *   POLYLINE + VERTEX (with bulge)
 *   LINE, ARC (joined into closed loops)
 *   CIRCLE, ELLIPSE, SPLINE
 */

import type { Polygon } from '../types'
import { polygonArea, polygonBounds } from '../algorithms/geometry'

// ─────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────

export interface DxfShape {
  name: string
  polygon: Polygon     // outer contour, normalised to (0,0) origin
  holes: Polygon[]     // inner cut-outs in the same local coordinate system
  area: number
  layer: string
}

// ─────────────────────────────────────────────────────────────
// Tokeniser
// ─────────────────────────────────────────────────────────────

interface Pair { code: number; value: string }

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r?\n/)
  const pairs: Pair[] = []
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10)
    if (isNaN(code)) continue
    pairs.push({ code, value: lines[i + 1].trim() })
  }
  return pairs
}

// ─────────────────────────────────────────────────────────────
// Block splitter
//
// An "entity block" is all the pairs from one code=0 entity-name
// to the next code=0.
// ─────────────────────────────────────────────────────────────

interface Block {
  type: string
  pairs: Pair[]   // does NOT include the opening code=0 pair
}

function splitBlocks(pairs: Pair[]): Block[] {
  const blocks: Block[] = []
  let start = -1
  let type = ''

  // Jump to the ENTITIES section
  let offset = 0
  const entIdx = pairs.findIndex(p => p.code === 2 && p.value === 'ENTITIES')
  if (entIdx >= 0) offset = entIdx + 1

  for (let i = offset; i < pairs.length; i++) {
    const { code, value } = pairs[i]
    if (code === 0) {
      if (start >= 0 && type) {
        blocks.push({ type, pairs: pairs.slice(start, i) })
      }
      if (value === 'ENDSEC' || value === 'EOF') break
      type = value
      start = i + 1
    }
  }
  // Flush the last block
  if (start >= 0 && type) {
    blocks.push({ type, pairs: pairs.slice(start) })
  }
  return blocks
}

// ─────────────────────────────────────────────────────────────
// Block helpers — extract all values for a given group code
// ─────────────────────────────────────────────────────────────

const num  = (b: Block, code: number, def = 0) => {
  const p = b.pairs.find(p => p.code === code)
  return p ? parseFloat(p.value) : def
}
const str  = (b: Block, code: number, def = '') => {
  const p = b.pairs.find(p => p.code === code)
  return p ? p.value : def
}
const flag = (b: Block, code: number) => parseInt(str(b, code, '0'), 10)
const nums = (b: Block, code: number): number[] =>
  b.pairs.filter(p => p.code === code).map(p => parseFloat(p.value))

// ─────────────────────────────────────────────────────────────
// LWPOLYLINE  — parse vertices with bulge in order
// ─────────────────────────────────────────────────────────────

interface LwVertex { x: number; y: number; bulge: number }

function parseLwPolyline(b: Block): { verts: LwVertex[]; closed: boolean } {
  const closed = (flag(b, 70) & 1) === 1
  const verts: LwVertex[] = []

  let pendX: number | null = null
  let pendY: number | null = null
  let pendBulge = 0

  const commit = () => {
    if (pendX !== null && pendY !== null) {
      verts.push({ x: pendX, y: pendY, bulge: pendBulge })
    }
    pendX = null; pendY = null; pendBulge = 0
  }

  for (const { code, value } of b.pairs) {
    if (code === 10) {
      commit()                          // save previous vertex
      pendX = parseFloat(value)
    } else if (code === 20 && pendX !== null) {
      pendY = parseFloat(value)
    } else if (code === 42) {
      // bulge always comes AFTER X,Y for the current vertex
      pendBulge = parseFloat(value)
    }
  }
  commit()  // save last vertex

  return { verts, closed }
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

export function parseDXFFile(dxfText: string, fileName: string): DxfShape[] {
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const pairs  = tokenize(dxfText)
  const blocks = splitBlocks(pairs)
  const raws   = blocksToShapes(blocks, baseName)
  return assignHoles(raws)
}

// ─────────────────────────────────────────────────────────────
// Raw shape (original DXF coordinates, not yet normalised)
// ─────────────────────────────────────────────────────────────

interface RawShape { name: string; polygon: Polygon; area: number; layer: string }

function blocksToShapes(blocks: Block[], baseName: string): RawShape[] {
  const shapes: RawShape[] = []

  const add = (poly: Polygon | null | undefined, name: string, layer: string) => {
    if (!poly || poly.length < 3) return
    const area = polygonArea(poly)
    if (area < 1) return
    shapes.push({ name, polygon: poly, area, layer })
  }

  // ── LWPOLYLINE ─────────────────────────────────────────────
  blocks.filter(b => b.type === 'LWPOLYLINE').forEach((b, i) => {
    const layer = str(b, 8, baseName)
    const { verts, closed } = parseLwPolyline(b)
    if (verts.length < 2) return
    add(lwToPolygon(verts, closed), `${layer}-lw${i + 1}`, layer)
  })

  // ── Old POLYLINE + VERTEX ──────────────────────────────────
  {
    let plIdx = 0
    for (let bi = 0; bi < blocks.length; bi++) {
      if (blocks[bi].type !== 'POLYLINE') continue
      const pb = blocks[bi]
      const layer = str(pb, 8, baseName)
      const closed = (flag(pb, 70) & 1) === 1
      plIdx++

      const verts: LwVertex[] = []
      for (let vi = bi + 1; vi < blocks.length; vi++) {
        const vb = blocks[vi]
        if (vb.type === 'SEQEND') break
        if (vb.type !== 'VERTEX') continue
        const x = num(vb, 10)
        const y = num(vb, 20)
        const bulge = num(vb, 42, 0)
        verts.push({ x, y, bulge })
      }

      if (verts.length >= 2)
        add(lwToPolygon(verts, closed), `${layer}-poly${plIdx}`, layer)
    }
  }

  // ── CIRCLE ─────────────────────────────────────────────────
  blocks.filter(b => b.type === 'CIRCLE').forEach((b, i) => {
    const layer = str(b, 8, baseName)
    const cx = num(b, 10); const cy = num(b, 20); const r = num(b, 40)
    if (r <= 0) return
    add(circlePoints(cx, cy, r, 48), `${layer}-circle${i + 1}`, layer)
  })

  // ── ELLIPSE ────────────────────────────────────────────────
  blocks.filter(b => b.type === 'ELLIPSE').forEach((b, i) => {
    const layer = str(b, 8, baseName)
    add(parseEllipse(b), `${layer}-ellipse${i + 1}`, layer)
  })

  // ── SPLINE ─────────────────────────────────────────────────
  blocks.filter(b => b.type === 'SPLINE').forEach((b, i) => {
    const layer = str(b, 8, baseName)
    add(parseSpline(b), `${layer}-spline${i + 1}`, layer)
  })

  // ── LINE + ARC → joined closed loops (grouped by layer) ───
  {
    const segsByLayer = new Map<string, Seg[]>()
    blocks.filter(b => b.type === 'LINE' || b.type === 'ARC').forEach(b => {
      const layer = str(b, 8, baseName)
      if (!segsByLayer.has(layer)) segsByLayer.set(layer, [])
      segsByLayer.get(layer)!.push(b.type === 'LINE' ? parseLine(b) : parseArc(b))
    })
    segsByLayer.forEach((segs, layer) => {
      joinSegments(segs).forEach((poly, i) =>
        add(poly, `${layer}-loop${i + 1}`, layer)
      )
    })
  }

  return shapes
}

// ─────────────────────────────────────────────────────────────
// LWPOLYLINE with bulge → polygon points
// ─────────────────────────────────────────────────────────────

function lwToPolygon(verts: LwVertex[], closed: boolean): Polygon {
  const pts: Polygon = []
  const n = verts.length
  const limit = closed ? n : n - 1

  for (let i = 0; i < limit; i++) {
    const v0 = verts[i]
    const v1 = verts[(i + 1) % n]
    pts.push({ x: v0.x, y: v0.y })
    if (v0.bulge !== 0) {
      const arc = bulgeArc(v0.x, v0.y, v1.x, v1.y, v0.bulge, 32)
      pts.push(...arc.slice(1, -1))
    }
  }
  if (!closed) pts.push({ x: verts[n - 1].x, y: verts[n - 1].y })
  return pts
}

/**
 * DXF bulge → arc points.
 *
 * bulge = tan(θ/4)  where θ = included angle, positive = CCW.
 *
 * Key insight: DXF uses a Y-up right-hand coordinate system.
 * Positive bulge = CCW arc = the arc curves to the LEFT relative
 * to the direction from p1 to p2.
 */
function bulgeArc(
  x1: number, y1: number,
  x2: number, y2: number,
  bulge: number,
  segs: number,
): Polygon {
  const dx = x2 - x1, dy = y2 - y1
  const chord = Math.hypot(dx, dy)
  if (chord < 1e-9) return [{ x: x1, y: y1 }, { x: x2, y: y2 }]

  // Included angle (signed: + CCW, - CW)
  const theta = 4 * Math.atan(Math.abs(bulge))   // always positive, use sign below
  const r = chord / (2 * Math.sin(theta / 2))

  // Distance from chord midpoint to arc centre (always positive)
  const distToCenter = r * Math.cos(theta / 2)

  // Unit perpendicular to chord
  // For CCW arc (bulge>0), centre is to the LEFT of (p1→p2)
  // LEFT of (dx,dy)/chord is (-dy,dx)/chord
  const sign = bulge > 0 ? 1 : -1
  const perpX = sign * (-dy / chord)
  const perpY = sign * ( dx / chord)

  const cx = (x1 + x2) / 2 + distToCenter * perpX
  const cy = (y1 + y2) / 2 + distToCenter * perpY

  let startA = Math.atan2(y1 - cy, x1 - cx)
  let endA   = Math.atan2(y2 - cy, x2 - cx)

  // Sweep in the correct direction
  if (bulge > 0) {
    // CCW: endA must be > startA
    if (endA < startA) endA += 2 * Math.PI
  } else {
    // CW: endA must be < startA
    if (endA > startA) endA -= 2 * Math.PI
  }

  const result: Polygon = []
  for (let s = 0; s <= segs; s++) {
    const a = startA + (endA - startA) * s / segs
    result.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return result
}

// ─────────────────────────────────────────────────────────────
// CIRCLE
// ─────────────────────────────────────────────────────────────

function circlePoints(cx: number, cy: number, r: number, segs: number): Polygon {
  return Array.from({ length: segs }, (_, i) => {
    const a = (2 * Math.PI * i) / segs
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
  })
}

// ─────────────────────────────────────────────────────────────
// ELLIPSE
// ─────────────────────────────────────────────────────────────

function parseEllipse(b: Block): Polygon | null {
  const cx = num(b, 10); const cy = num(b, 20)

  // Major axis endpoint vector (code 11, 21)
  const majorXs = nums(b, 11); const majorYs = nums(b, 21)
  const majorX = majorXs[0] ?? 1; const majorY = majorYs[0] ?? 0
  const majorLen = Math.hypot(majorX, majorY)
  if (majorLen < 1e-6) return null

  const ratio = num(b, 40, 1)  // code 40 = minor/major ratio for ELLIPSE
  const minorLen = majorLen * ratio
  const angle = Math.atan2(majorY, majorX)

  const start = num(b, 41, 0); const end = num(b, 42, 2 * Math.PI)
  const SEG = 72

  return Array.from({ length: SEG }, (_, i) => {
    const t = start + (end - start) * i / (SEG - 1)
    const lx = majorLen * Math.cos(t)
    const ly = minorLen * Math.sin(t)
    return {
      x: cx + lx * Math.cos(angle) - ly * Math.sin(angle),
      y: cy + lx * Math.sin(angle) + ly * Math.cos(angle),
    }
  })
}

// ─────────────────────────────────────────────────────────────
// SPLINE  (cubic B-spline via De Boor)
// ─────────────────────────────────────────────────────────────

function parseSpline(b: Block): Polygon | null {
  const degree = flag(b, 71) || 3

  // Collect control points (code 10/20) and fit points (code 11/21) in order
  const ctrlPts: Array<{ x: number; y: number }> = []
  const fitPts:  Array<{ x: number; y: number }> = []
  const knots = nums(b, 40)

  let pendX10: number | null = null
  let pendX11: number | null = null

  for (const { code, value } of b.pairs) {
    if (code === 10) { pendX10 = parseFloat(value); pendX11 = null }
    else if (code === 20 && pendX10 !== null) {
      ctrlPts.push({ x: pendX10, y: parseFloat(value) }); pendX10 = null
    }
    else if (code === 11) { pendX11 = parseFloat(value); pendX10 = null }
    else if (code === 21 && pendX11 !== null) {
      fitPts.push({ x: pendX11, y: parseFloat(value) }); pendX11 = null
    }
  }

  // Prefer fit points (already on the curve)
  if (fitPts.length >= 2) return fitPts

  if (ctrlPts.length < 2) return null

  const n = ctrlPts.length
  const p = Math.min(degree, n - 1)
  const kv = knots.length === n + p + 1 ? knots : clampedKnots(n, p)

  const STEPS = Math.max(64, n * 8)
  const tMin = kv[p]; const tMax = kv[kv.length - 1 - p]
  const result: Polygon = []

  for (let s = 0; s <= STEPS; s++) {
    const t = s === STEPS ? tMax - 1e-10 : tMin + (tMax - tMin) * s / STEPS
    const pt = deBoor(p, kv, ctrlPts, t)
    if (pt) result.push(pt)
  }
  return result.length >= 3 ? result : null
}

function clampedKnots(n: number, p: number): number[] {
  const m = n + p + 1
  return Array.from({ length: m }, (_, i) => {
    if (i <= p) return 0
    if (i >= m - 1 - p) return 1
    return (i - p) / (n - p)
  })
}

function deBoor(
  p: number, knots: number[],
  ctrl: Array<{ x: number; y: number }>, t: number,
): { x: number; y: number } | null {
  const n = ctrl.length - 1
  let k = p
  for (let j = p; j < knots.length - 1 - p; j++) {
    if (t >= knots[j] && t < knots[j + 1]) { k = j; break }
  }
  if (k > n) k = n

  const d: Array<{ x: number; y: number }> = []
  for (let j = 0; j <= p; j++) {
    const idx = k - p + j
    if (idx < 0 || idx > n) return null
    d.push({ x: ctrl[idx].x, y: ctrl[idx].y })
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const a0 = knots[k - p + j], a1 = knots[k + 1 + j - r]
      const denom = a1 - a0
      if (Math.abs(denom) < 1e-12) continue
      const alpha = (t - a0) / denom
      d[j] = { x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
               y: (1 - alpha) * d[j - 1].y + alpha * d[j].y }
    }
  }
  return d[p]
}

// ─────────────────────────────────────────────────────────────
// LINE / ARC segments for chain-joining
// ─────────────────────────────────────────────────────────────

interface Seg { pts: Polygon }

function parseLine(b: Block): Seg {
  return { pts: [{ x: num(b, 10), y: num(b, 20) }, { x: num(b, 11), y: num(b, 21) }] }
}

function parseArc(b: Block): Seg {
  const cx = num(b, 10); const cy = num(b, 20); const r = num(b, 40)
  const sa = num(b, 50) * Math.PI / 180
  let ea   = num(b, 51) * Math.PI / 180
  if (ea <= sa) ea += 2 * Math.PI   // DXF arcs are always CCW
  const SEG = 24   // 24 segments per arc (enough for smooth curves, faster nesting)
  return {
    pts: Array.from({ length: SEG + 1 }, (_, i) => {
      const a = sa + (ea - sa) * i / SEG
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
    }),
  }
}

function joinSegments(segs: Seg[]): Polygon[] {
  if (segs.length === 0) return []
  const EPS = 1.0
  const used = new Uint8Array(segs.length)
  const near = (ax: number, ay: number, bx: number, by: number) =>
    Math.abs(ax - bx) <= EPS && Math.abs(ay - by) <= EPS
  const loops: Polygon[] = []

  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue
    used[s] = 1
    const loop: Polygon = [...segs[s].pts.slice(0, -1)]
    let ex = segs[s].pts[segs[s].pts.length - 1].x
    let ey = segs[s].pts[segs[s].pts.length - 1].y

    let found = true
    while (found) {
      if (near(ex, ey, loop[0].x, loop[0].y)) break
      found = false
      for (let j = 0; j < segs.length; j++) {
        if (used[j]) continue
        const sp = segs[j].pts[0], ep = segs[j].pts[segs[j].pts.length - 1]
        if (near(ex, ey, sp.x, sp.y)) {
          used[j] = 1; loop.push(...segs[j].pts.slice(0, -1)); ex = ep.x; ey = ep.y; found = true; break
        }
        if (near(ex, ey, ep.x, ep.y)) {
          used[j] = 1; loop.push(...[...segs[j].pts].reverse().slice(0, -1)); ex = sp.x; ey = sp.y; found = true; break
        }
      }
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

// ─────────────────────────────────────────────────────────────
// Hole assignment
// ─────────────────────────────────────────────────────────────

function ptInPoly(px: number, py: number, poly: Polygon): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

function assignHoles(shapes: RawShape[]): DxfShape[] {
  if (shapes.length === 0) return []

  const sorted  = [...shapes].sort((a, b) => b.area - a.area)
  const isHole  = new Uint8Array(sorted.length)
  const holeOf  = new Int32Array(sorted.length).fill(-1)

  for (let i = 1; i < sorted.length; i++) {
    const inner = sorted[i]
    const cx = inner.polygon.reduce((s, p) => s + p.x, 0) / inner.polygon.length
    const cy = inner.polygon.reduce((s, p) => s + p.y, 0) / inner.polygon.length

    for (let j = 0; j < i; j++) {
      if (isHole[j]) continue
      const outer = sorted[j]
      if (inner.area > outer.area * 0.85) continue

      const ob = polygonBounds(outer.polygon), ib = polygonBounds(inner.polygon)
      if (ib.maxX > ob.maxX + 2 || ib.maxY > ob.maxY + 2 ||
          ib.minX < ob.minX - 2 || ib.minY < ob.minY - 2) continue

      if (ptInPoly(cx, cy, outer.polygon)) { isHole[i] = 1; holeOf[i] = j; break }
    }
  }

  const result: DxfShape[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (isHole[i]) continue
    const shape = sorted[i]
    const bounds = polygonBounds(shape.polygon)
    const dx = -bounds.minX, dy = -bounds.minY

    const normOuter = shape.polygon.map(p => ({ x: p.x + dx, y: p.y + dy }))
    const normHoles: Polygon[] = []
    for (let h = 0; h < sorted.length; h++) {
      if (holeOf[h] === i)
        normHoles.push(sorted[h].polygon.map(p => ({ x: p.x + dx, y: p.y + dy })))
    }
    result.push({ name: shape.name, polygon: normOuter, holes: normHoles, area: shape.area, layer: shape.layer })
  }
  return result
}
