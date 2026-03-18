/**
 * Nesting Engine — 3-Strategy BLF placer
 *
 * Placement: Bottom-Left Fill (BLF) with raster height map and
 * edge-contact X candidates.  Direct SAT collision detection.
 *
 * Optimisation: runs 3 deterministic sort strategies and keeps the best:
 *   S0 – parts sorted by polygon area  (largest first)
 *   S1 – parts sorted by bounding-box area (largest first)
 *   S2 – natural (import) order
 *
 * For each part we greedily try every allowed rotation and pick the
 * rotation + position with the lowest (y, x) score — this delivers
 * tight interlocking without the overhead of a Genetic Algorithm.
 */

import type { Part, NestingSettings, PlacedPart, SheetResult, NestingResult } from '../types'
import type { Polygon } from '../types'
import { SHEET_SIZES } from '../types'
import {
  rotatePolygon, translatePolygon,
  polygonBounds, polygonArea,
} from './geometry'
import { clearNFPCache } from './nfpTrue'
import { v4 as uuid } from 'uuid'

// ── Colour palette ────────────────────────────────────────────

const COLORS = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#f87171', '#2dd4bf', '#fb923c', '#818cf8', '#4ade80',
  '#e879f9', '#facc15', '#38bdf8', '#f43f5e', '#a3e635',
]

// ── Progress callback ─────────────────────────────────────────

export type ProgressCallback = (
  generation: number,
  total: number,
  efficiency: number,
  status: string
) => void

// ── Main entry point ──────────────────────────────────────────

export async function runNesting(
  parts: Part[],
  settings: NestingSettings,
  onProgress?: ProgressCallback,
): Promise<NestingResult> {
  const t0 = Date.now()
  const sheet = SHEET_SIZES[settings.sheetSize]

  clearNFPCache()

  // Expand instances (respecting quantity)
  const instances: { part: Part; colorIndex: number }[] = []
  parts.forEach((part, pi) => {
    for (let q = 0; q < part.quantity; q++) {
      instances.push({ part, colorIndex: pi % COLORS.length })
    }
  })

  if (instances.length === 0) return emptyResult(settings, t0)

  // ── Pre-compute rotated polygons + botProfiles once ───────
  // These are the same for every BLF pass, so build them once and reuse.
  const rotCache = buildRotCache(instances)

  // ── 3 deterministic BLF strategies — pick the best ───────
  const area = (i: { part: Part }) => i.part.area ?? polygonArea(i.part.polygon)
  const bbox = (i: { part: Part }) => {
    const b = polygonBounds(i.part.polygon); return b.maxX * b.maxY
  }

  const strategies = [
    [...instances].sort((a, b) => area(b)  - area(a)),  // S0: largest polygon area first
    [...instances].sort((a, b) => bbox(b)  - bbox(a)),  // S1: largest bbox first
    [...instances],                                       // S2: natural (import) order
  ]

  let bestResult: SheetResult[] = []
  let bestScore = Infinity

  for (let si = 0; si < strategies.length; si++) {
    if (onProgress) onProgress(si + 1, strategies.length, 0, `Packing strategy ${si + 1}/3…`)
    await sleep(0)

    const result = placeInstances(strategies[si], sheet, settings, rotCache)
    // Score = fewer sheets first, then more area used
    const score = result.length * 1e9 - result.reduce((s: number, r: SheetResult) => s + r.usedArea, 0)
    if (score < bestScore) { bestScore = score; bestResult = result }

    if (onProgress) {
      const eff = bestResult.reduce((s: number, r: SheetResult) => s + r.efficiency, 0) / Math.max(1, bestResult.length)
      onProgress(si + 1, strategies.length, eff,
        `Strategy ${si + 1}/3 done — best ${eff.toFixed(1)}% on ${bestResult.length} sheet(s)`)
    }
  }

  // ── Build result ──────────────────────────────────────────
  const placed = bestResult.flatMap(s => s.placements)
  const placedCountById = new Map<string, number>()
  placed.forEach(p => placedCountById.set(p.partId, (placedCountById.get(p.partId) ?? 0) + 1))

  const unplaced: NestingResult['unplaced'] = []
  const seenIds = new Set<string>()
  for (const inst of instances) {
    if (seenIds.has(inst.part.id)) continue
    seenIds.add(inst.part.id)
    const placedQty = placedCountById.get(inst.part.id) ?? 0
    if (placedQty < inst.part.quantity) {
      unplaced.push({ partId: inst.part.id, name: inst.part.name, remaining: inst.part.quantity - placedQty })
    }
  }

  const totalPartsArea = instances.reduce((s, i) => s + polygonArea(i.part.polygon), 0)
  const totalSheetArea = bestResult.reduce((s, r) => s + r.sheetArea, 0)
  const overallEfficiency = totalSheetArea > 0
    ? Math.round((totalPartsArea / totalSheetArea) * 10000) / 100 : 0

  return {
    sheetResults: bestResult,
    totalSheets: bestResult.length,
    totalParts: instances.length,
    placedCount: placed.length,
    unplaced,
    overallEfficiency,
    settings,
    processingTime: Date.now() - t0,
    timestamp: new Date().toISOString(),
  }
}

// ── Column step (mm) for the raster height map ────────────────
const RASTER_STEP_FINE = 5   // mm — fine enough for interlocking

// ── Rotation cache ────────────────────────────────────────────
// Pre-computed rotated polygon + botProfile for each unique part × rotation.
// Avoids repeating the rotation + profile work on every BLF pass.

interface RotVariant {
  rot:        number
  rotated:    Polygon
  normDX:     number
  normDY:     number
  botProfile: Float64Array
  bW:         number
  bH:         number
}

function buildRotCache(instances: { part: Part }[]): Map<string, RotVariant[]> {
  const cache = new Map<string, RotVariant[]>()
  for (const inst of instances) {
    if (cache.has(inst.part.id)) continue
    const rots = inst.part.allowedRotations?.length ? inst.part.allowedRotations : [0]
    cache.set(inst.part.id, rots.map(rot => {
      const raw    = rotatePolygon(inst.part.polygon, rot)
      const rb     = polygonBounds(raw)
      const normDX = -rb.minX, normDY = -rb.minY
      const rotated = translatePolygon(raw, normDX, normDY)
      const b = polygonBounds(rotated)
      return { rot, rotated, normDX, normDY, botProfile: buildBotProfile(rotated), bW: b.maxX, bH: b.maxY }
    }))
  }
  return cache
}

// ── Place all parts (one BLF pass) ───────────────────────────
//
// Tries every allowed rotation per part and picks the rotation + position
// with the lowest (y, x) gravity score.  Called 3 times with different
// sort orders; the best result is kept.

function placeInstances(
  instances: { part: Part; colorIndex: number }[],
  sheet: { width: number; height: number },
  settings: NestingSettings,
  rotCache: Map<string, RotVariant[]>,
): SheetResult[] {
  const sheetResults: SheetResult[] = []

  const eg          = settings.edgeGap
  const S           = RASTER_STEP_FINE
  const innerW      = sheet.width - 2 * eg
  const nCols       = Math.ceil(innerW / S) + 2
  const combinedGap = settings.partGap + settings.kerf

  let currentSheet = newSheet(0, sheet)
  sheetResults.push(currentSheet)
  let raster    = new Float64Array(nCols)
  let aabbCache: Array<ReturnType<typeof polygonBounds>> = []

  const tryOnSheet = (
    inst: { part: Part; colorIndex: number },
    r: Float64Array,
    ac: Array<ReturnType<typeof polygonBounds>>,
    s: SheetResult,
  ) => {
    const variants = rotCache.get(inst.part.id) ?? []
    let best: { pos: { x: number; y: number }; rot: number; rotated: Polygon; normDX: number; normDY: number } | null = null
    let bestScore = Infinity
    for (const v of variants) {
      const pos = tryPlaceOnSheet(v.rotated, v.botProfile, v.bW, v.bH, combinedGap, r, ac, s, settings)
      if (pos) {
        const score = pos.y * 1_000_000 + pos.x
        if (score < bestScore) { bestScore = score; best = { pos, rot: v.rot, rotated: v.rotated, normDX: v.normDX, normDY: v.normDY } }
      }
    }
    return best
  }

  for (const inst of instances) {
    let result = tryOnSheet(inst, raster, aabbCache, currentSheet)
    if (!result) {
      currentSheet = newSheet(sheetResults.length, sheet)
      sheetResults.push(currentSheet)
      raster    = new Float64Array(nCols)
      aabbCache = []
      result    = tryOnSheet(inst, raster, aabbCache, currentSheet)
    }
    if (result) {
      const { pos, rot, rotated, normDX, normDY } = result
      const placedPoly = translatePolygon(rotated, pos.x, pos.y)
      addToRaster(raster, placedPoly, eg, nCols)
      aabbCache.push(polygonBounds(placedPoly))
      currentSheet.placements.push({
        uid: uuid(),
        partId: inst.part.id,
        name: inst.part.name,
        polygon: placedPoly,
        holes: inst.part.holes?.map(h => {
          const rh = rotatePolygon(h, rot)
          return translatePolygon(rh, normDX + pos.x, normDY + pos.y)
        }),
        x: pos.x, y: pos.y,
        rotation: rot,
        sheetIndex: currentSheet.sheetIndex,
        color: COLORS[inst.colorIndex],
      })
      currentSheet.usedArea += polygonArea(rotated)
      currentSheet.efficiency = (currentSheet.usedArea / currentSheet.sheetArea) * 100
    }
  }

  return sheetResults.filter(s => s.placements.length > 0)
}

// ── Raster-Jump BLF placer ────────────────────────────────────
//
// Key insight — interlocking formula:
//   y_min[x] = max_c( raster[c] + gap - botProfile[c] )
//
// raster[c]     = max Y of all placed polygon edges at column c (inner coords)
// botProfile[c] = min Y of incoming part's bottom at local column c
//
// If the incoming part has a concave pocket at the bottom, botProfile[c] > 0
// at those columns, so y_min is LOWER — part slides into the placed part's
// concave pocket instead of stacking on top (interlocking).

function tryPlaceOnSheet(
  B: Polygon,
  botProfile: Float64Array,
  bW: number,
  bH: number,
  combinedGap: number,
  raster: Float64Array,
  aabbCache: Array<ReturnType<typeof polygonBounds>>,
  sheet: SheetResult,
  settings: NestingSettings,
): { x: number; y: number } | null {
  const S    = RASTER_STEP_FINE
  const eg   = settings.edgeGap

  const innerW    = sheet.sheetWidth  - 2 * eg
  const innerH    = sheet.sheetHeight - 2 * eg
  const maxXInner = innerW - bW
  const maxYInner = innerH - bH

  if (maxXInner < -0.001 || maxYInner < -0.001) return null
  if (sheet.placements.length === 0) return { x: eg, y: eg }

  const nCols = raster.length
  const nBP   = botProfile.length

  // ── X candidate list ──────────────────────────────────────
  // Grid positions + flush-contact positions from the last 6 placed parts.
  // Capping at 6 avoids O(N²) growth as the sheet fills up.
  const xRaw: number[] = []
  for (let xi = 0; xi * S <= maxXInner + 0.001; xi++) xRaw.push(xi * S)
  const contactSlice = aabbCache.slice(Math.max(0, aabbCache.length - 6))
  for (const a of contactSlice) {
    const xR = a.maxX - eg + combinedGap        // B left touches placed right
    const xL = a.minX - eg - combinedGap - bW   // B right touches placed left
    if (xR >= 0 && xR <= maxXInner + 0.001) xRaw.push(xR)
    if (xL >= 0 && xL <= maxXInner + 0.001) xRaw.push(xL)
  }
  xRaw.sort((a, b) => a - b)
  const xCands = xRaw.filter((x, i) => i === 0 || x - xRaw[i - 1] > 0.4)

  let best: { x: number; y: number } | null = null
  let bestScore = Infinity

  for (const x of xCands) {
    // ── Interlocking y_min ────────────────────────────────
    const c1   = Math.floor(x / S)
    const cLen = Math.min(Math.ceil(bW / S) + 2, nCols - c1, nBP)
    let yMin = 0
    for (let k = 0; k < cLen; k++) {
      const ras = (c1 + k < nCols) ? raster[c1 + k] : 0
      const bot = (k < nBP)        ? botProfile[k]   : 0
      yMin = Math.max(yMin, ras + combinedGap - bot)
    }
    yMin = Math.max(0, yMin)   // exact — no grid snap (snap adds unnecessary gap)

    const sx = x + eg

    // ── Y search: exact yMin first, then 1 mm sub-steps near start,
    //    then full S steps.  This ensures flush contact without big gaps.
    for (let y = yMin; y <= maxYInner + 0.001; ) {
      if (y * 1_000_000 + x >= bestScore) break   // can't beat current best

      const sy = y + eg
      let collision = false

      for (let pi = 0; pi < aabbCache.length; pi++) {
        const a = aabbCache[pi]
        if (sx + bW + combinedGap <= a.minX ||
            sx  - combinedGap      >= a.maxX ||
            sy + bH + combinedGap  <= a.minY ||
            sy  - combinedGap      >= a.maxY) continue
        if (polygonsOverlapAt(B, sx, sy, sheet.placements[pi].polygon, -combinedGap)) {
          collision = true; break
        }
      }

      if (!collision) {
        bestScore = y * 1_000_000 + x
        best = { x: sx, y: sy }
        break
      }
      // Sub-step: 1 mm within first S mm from yMin, then full S
      y += (y - yMin < S) ? 1 : S
    }
  }

  return best
}

// ── Build part bottom profile ────────────────────────────────
// profile[c] = min Y of the part polygon at column c (represents concave pockets)

function buildBotProfile(poly: Polygon): Float64Array {
  const S   = RASTER_STEP_FINE
  const W   = polygonBounds(poly).maxX
  const nBP = Math.ceil(W / S) + 2
  const profile = new Float64Array(nBP).fill(Infinity)
  const n = poly.length
  for (let ei = 0; ei < n; ei++) {
    const ax = poly[ei].x,           ay = poly[ei].y
    const bx = poly[(ei + 1) % n].x, by = poly[(ei + 1) % n].y
    const xLo = Math.min(ax, bx), xHi = Math.max(ax, bx)
    const cLo = Math.max(0, Math.floor(xLo / S))
    const cHi = Math.min(nBP - 1, Math.floor(xHi / S) + 1)
    for (let c = cLo; c <= cHi; c++) {
      const xc1 = c * S, xc2 = (c + 1) * S
      if (Math.abs(bx - ax) < 1e-9) {
        if (xc1 <= ax && ax <= xc2) profile[c] = Math.min(profile[c], ay, by)
      } else {
        const t1 = Math.max(0, Math.min(1, (xc1 - ax) / (bx - ax)))
        const t2 = Math.max(0, Math.min(1, (xc2 - ax) / (bx - ax)))
        profile[c] = Math.min(profile[c], ay, by, ay + t1*(by-ay), ay + t2*(by-ay))
      }
    }
  }
  for (let c = 0; c < nBP; c++) if (profile[c] === Infinity) profile[c] = 0
  return profile
}

// ── Incremental raster update ─────────────────────────────────
// After placing a part, raise the height raster with its polygon edges.

function addToRaster(raster: Float64Array, poly: Polygon, edgeGap: number, nCols: number) {
  const S = RASTER_STEP_FINE
  const n = poly.length
  for (let ei = 0; ei < n; ei++) {
    const ax = poly[ei].x - edgeGap,           ay = poly[ei].y - edgeGap
    const bx = poly[(ei + 1) % n].x - edgeGap, by = poly[(ei + 1) % n].y - edgeGap
    const xLo = Math.min(ax, bx), xHi = Math.max(ax, bx)
    const cLo = Math.max(0, Math.floor(xLo / S))
    const cHi = Math.min(nCols - 1, Math.floor(xHi / S) + 1)
    for (let c = cLo; c <= cHi; c++) {
      const xc1 = c * S, xc2 = (c + 1) * S
      if (Math.abs(bx - ax) < 1e-9) {
        if (xc1 <= ax && ax <= xc2) raster[c] = Math.max(raster[c], ay, by)
      } else {
        const t1 = Math.max(0, Math.min(1, (xc1 - ax) / (bx - ax)))
        const t2 = Math.max(0, Math.min(1, (xc2 - ax) / (bx - ax)))
        raster[c] = Math.max(raster[c], ay, by, ay + t1*(by-ay), ay + t2*(by-ay))
      }
    }
  }
}

// ── SAT overlap check with offset ────────────────────────────

function polygonsOverlapAt(
  A: Polygon, ax: number, ay: number,
  B: Polygon,
  tolerance: number,
): boolean {
  let Aminx = Infinity, Aminy = Infinity, Amaxx = -Infinity, Amaxy = -Infinity
  for (const p of A) {
    const x = p.x + ax, y = p.y + ay
    if (x < Aminx) Aminx = x; if (x > Amaxx) Amaxx = x
    if (y < Aminy) Aminy = y; if (y > Amaxy) Amaxy = y
  }
  let Bminx = Infinity, Bminy = Infinity, Bmaxx = -Infinity, Bmaxy = -Infinity
  for (const p of B) {
    if (p.x < Bminx) Bminx = p.x; if (p.x > Bmaxx) Bmaxx = p.x
    if (p.y < Bminy) Bminy = p.y; if (p.y > Bmaxy) Bmaxy = p.y
  }
  if (Amaxx + tolerance <= Bminx || Bmaxx + tolerance <= Aminx ||
      Amaxy + tolerance <= Bminy || Bmaxy + tolerance <= Aminy) return false

  const polys: [Polygon, number, number][] = [[A, ax, ay], [B, 0, 0]]
  for (const [poly, ox, oy] of polys) {
    const n = poly.length
    for (let i = 0; i < n; i++) {
      const p0x = poly[i].x + ox,       p0y = poly[i].y + oy
      const p1x = poly[(i+1)%n].x + ox, p1y = poly[(i+1)%n].y + oy
      const ex = p1x - p0x, ey = p1y - p0y
      const len = Math.hypot(ex, ey)
      if (len < 1e-9) continue
      const nx = -ey / len, ny = ex / len
      let minA = Infinity, maxA = -Infinity
      for (const p of A) { const d = (p.x+ax)*nx + (p.y+ay)*ny; if (d<minA) minA=d; if (d>maxA) maxA=d }
      let minB = Infinity, maxB = -Infinity
      for (const p of B) { const d = p.x*nx + p.y*ny; if (d<minB) minB=d; if (d>maxB) maxB=d }
      if (maxA + tolerance <= minB || maxB + tolerance <= minA) return false
    }
  }
  return true
}

// ── Helpers ───────────────────────────────────────────────────

function newSheet(index: number, sheet: { width: number; height: number }): SheetResult {
  return {
    sheetIndex: index,
    sheetWidth: sheet.width,
    sheetHeight: sheet.height,
    placements: [],
    usedArea: 0,
    sheetArea: sheet.width * sheet.height,
    efficiency: 0,
  }
}

function emptyResult(settings: NestingSettings, t0: number): NestingResult {
  return {
    sheetResults: [],
    totalSheets: 0,
    totalParts: 0,
    placedCount: 0,
    unplaced: [],
    overallEfficiency: 0,
    settings,
    processingTime: Date.now() - t0,
    timestamp: new Date().toISOString(),
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

