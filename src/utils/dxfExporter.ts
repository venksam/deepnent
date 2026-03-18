/**
 * DXF Exporter — generates production-ready DXF files for each nested sheet.
 *
 * Output format: AutoCAD R12 / R14 ASCII DXF (universally supported by CNC machines,
 * laser cutters, plasma cutters, waterjet machines).
 *
 * Each sheet DXF contains:
 *  • Sheet boundary (RECTANGLE on layer SHEET)
 *  • Each part's outer contour as a LWPOLYLINE on layer PARTS
 *  • Each part's holes/cutouts as LWPOLYLINE on layer HOLES
 *  • Part labels as TEXT entities on layer LABELS
 *  • Title block with sheet number, dimensions, efficiency, date
 */

import type { NestingResult, SheetResult, PlacedPart } from '../types'
import type { Polygon } from '../types'
import { SHEET_SIZES } from '../types'

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/** Download a DXF file for a single sheet */
export function downloadSheetDXF(result: NestingResult, sheetIndex: number): void {
  const sheet = result.sheetResults[sheetIndex]
  if (!sheet) return
  const dxf = buildSheetDXF(sheet, result, sheetIndex)
  downloadText(dxf, `sheet-${sheetIndex + 1}-production.dxf`)
}

/** Download all sheets as separate DXF files */
export function downloadAllSheetsDXF(result: NestingResult): void {
  result.sheetResults.forEach((_, i) => downloadSheetDXF(result, i))
}

/** Download all sheets combined in a single DXF (each sheet on its own Y-offset) */
export function downloadCombinedDXF(result: NestingResult): void {
  const dxf = buildCombinedDXF(result)
  downloadText(dxf, `nesting-all-sheets-production.dxf`)
}

// ─────────────────────────────────────────────────────────────
// DXF builder for a single sheet
// ─────────────────────────────────────────────────────────────

function buildSheetDXF(sheet: SheetResult, result: NestingResult, sheetIndex: number): string {
  const sheetDim = SHEET_SIZES[result.settings.sheetSize]
  const date = new Date(result.timestamp).toLocaleDateString()

  const sections: string[] = []

  // HEADER section
  sections.push(dxfHeader(sheet.sheetWidth, sheet.sheetHeight))

  // TABLES section (layer definitions)
  sections.push(dxfTables([
    { name: 'SHEET',  color: 7,  ltype: 'CONTINUOUS' },
    { name: 'PARTS',  color: 1,  ltype: 'CONTINUOUS' },
    { name: 'HOLES',  color: 3,  ltype: 'CONTINUOUS' },
    { name: 'LABELS', color: 2,  ltype: 'CONTINUOUS' },
    { name: 'DIMS',   color: 4,  ltype: 'CONTINUOUS' },
    { name: 'TITLE',  color: 5,  ltype: 'CONTINUOUS' },
  ]))

  // ENTITIES section
  const entities: string[] = []

  // Sheet boundary
  entities.push(rectangle(0, 0, sheet.sheetWidth, sheet.sheetHeight, 'SHEET'))

  // Dimension annotations on boundary
  entities.push(dimText(sheet.sheetWidth / 2, -15, `${sheet.sheetWidth} mm`, 'DIMS', 7))
  entities.push(dimText(-20, sheet.sheetHeight / 2, `${sheet.sheetHeight} mm`, 'DIMS', 7, 90))

  // Place parts
  sheet.placements.forEach(p => {
    entities.push(lwPolyline(p.polygon, 'PARTS'))
    p.holes?.forEach(h => entities.push(lwPolyline(h, 'HOLES')))

    // Part label at centroid
    const cx = p.polygon.reduce((s, v) => s + v.x, 0) / p.polygon.length
    const cy = p.polygon.reduce((s, v) => s + v.y, 0) / p.polygon.length
    const labelLines = p.rotation !== 0
      ? [`${p.name}`, `R${p.rotation}\u00b0`]
      : [p.name]
    labelLines.forEach((line, li) =>
      entities.push(text(cx, cy - li * 8, line, 5, 'LABELS'))
    )
  })

  // Title block
  const titleY = -40
  const titleLines = [
    `Sheet ${sheetIndex + 1} of ${result.totalSheets}`,
    `Size: ${sheetDim.label}`,
    `Parts: ${sheet.placements.length}  |  Efficiency: ${sheet.efficiency.toFixed(1)}%`,
    `Gap: ${result.settings.partGap}mm  Kerf: ${result.settings.kerf}mm  Edge: ${result.settings.edgeGap}mm`,
    `Date: ${date}`,
  ]
  titleLines.forEach((line, i) =>
    entities.push(dimText(0, titleY - i * 8, line, 'TITLE', 5))
  )

  sections.push(dxfEntitiesSection(entities))
  sections.push('0\nEOF\n')

  return sections.join('\n')
}

// ─────────────────────────────────────────────────────────────
// Combined DXF (all sheets side by side)
// ─────────────────────────────────────────────────────────────

function buildCombinedDXF(result: NestingResult): string {
  const sections: string[] = []
  const maxH = Math.max(...result.sheetResults.map(s => s.sheetHeight))
  const GAP = 100

  sections.push(dxfHeader(
    result.sheetResults.reduce((s, sh) => s + sh.sheetWidth + GAP, 0),
    maxH
  ))
  sections.push(dxfTables([
    { name: 'SHEET',  color: 7,  ltype: 'CONTINUOUS' },
    { name: 'PARTS',  color: 1,  ltype: 'CONTINUOUS' },
    { name: 'HOLES',  color: 3,  ltype: 'CONTINUOUS' },
    { name: 'LABELS', color: 2,  ltype: 'CONTINUOUS' },
    { name: 'DIMS',   color: 4,  ltype: 'CONTINUOUS' },
    { name: 'TITLE',  color: 5,  ltype: 'CONTINUOUS' },
  ]))

  const entities: string[] = []
  let offsetX = 0

  result.sheetResults.forEach((sheet, si) => {
    entities.push(rectangle(offsetX, 0, offsetX + sheet.sheetWidth, sheet.sheetHeight, 'SHEET'))
    entities.push(dimText(offsetX + sheet.sheetWidth / 2, -15,
      `Sheet ${si + 1} — ${sheet.efficiency.toFixed(1)}% efficient`, 'TITLE', 6))

    sheet.placements.forEach(p => {
      entities.push(lwPolyline(p.polygon.map(v => ({ x: v.x + offsetX, y: v.y })), 'PARTS'))
      p.holes?.forEach(h => entities.push(lwPolyline(h.map(v => ({ x: v.x + offsetX, y: v.y })), 'HOLES')))

      const cx = p.polygon.reduce((s, v) => s + v.x, 0) / p.polygon.length + offsetX
      const cy = p.polygon.reduce((s, v) => s + v.y, 0) / p.polygon.length
      entities.push(text(cx, cy, p.name, 5, 'LABELS'))
    })

    offsetX += sheet.sheetWidth + GAP
  })

  sections.push(dxfEntitiesSection(entities))
  sections.push('0\nEOF\n')

  return sections.join('\n')
}

// ─────────────────────────────────────────────────────────────
// DXF primitive builders
// ─────────────────────────────────────────────────────────────

function dxfHeader(maxX: number, maxY: number): string {
  return `  0\nSECTION\n  2\nHEADER\n  9\n$ACADVER\n  1\nAC1014\n  9\n$EXTMIN\n 10\n0.0\n 20\n0.0\n 30\n0.0\n  9\n$EXTMAX\n 10\n${maxX.toFixed(4)}\n 20\n${maxY.toFixed(4)}\n 30\n0.0\n  9\n$INSUNITS\n 70\n4\n  0\nENDSEC`
}

interface LayerDef { name: string; color: number; ltype: string }

function dxfTables(layers: LayerDef[]): string {
  const layerEntries = layers.map(l =>
    `  0\nLAYER\n  2\n${l.name}\n 70\n0\n 62\n${l.color}\n  6\n${l.ltype}`
  ).join('\n')
  return `  0\nSECTION\n  2\nTABLES\n  0\nTABLE\n  2\nLAYER\n 70\n${layers.length}\n${layerEntries}\n  0\nENDTAB\n  0\nENDSEC`
}

function dxfEntitiesSection(entities: string[]): string {
  return `  0\nSECTION\n  2\nENTITIES\n${entities.join('\n')}\n  0\nENDSEC`
}

/** LWPOLYLINE entity (closed polygon) */
function lwPolyline(poly: Polygon, layer: string): string {
  const header = `  0\nLWPOLYLINE\n  8\n${layer}\n 70\n1\n 90\n${poly.length}`
  const verts = poly.map(p => ` 10\n${p.x.toFixed(4)}\n 20\n${p.y.toFixed(4)}`).join('\n')
  return `${header}\n${verts}`
}

/** Closed rectangle as 4-vertex LWPOLYLINE */
function rectangle(x1: number, y1: number, x2: number, y2: number, layer: string): string {
  return lwPolyline([
    { x: x1, y: y1 }, { x: x2, y: y1 },
    { x: x2, y: y2 }, { x: x1, y: y2 },
  ], layer)
}

/** TEXT entity */
function text(x: number, y: number, content: string, height: number, layer: string): string {
  return `  0\nTEXT\n  8\n${layer}\n 10\n${x.toFixed(4)}\n 20\n${y.toFixed(4)}\n 30\n0.0\n 40\n${height}\n  1\n${content}\n 72\n1\n 11\n${x.toFixed(4)}\n 21\n${y.toFixed(4)}\n 31\n0.0`
}

/** TEXT entity with optional rotation */
function dimText(x: number, y: number, content: string, layer: string, height: number, rotation = 0): string {
  return `  0\nTEXT\n  8\n${layer}\n 10\n${x.toFixed(4)}\n 20\n${y.toFixed(4)}\n 30\n0.0\n 40\n${height}\n 50\n${rotation}\n  1\n${content}`
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'application/dxf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
