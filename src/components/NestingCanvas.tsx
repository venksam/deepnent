import { useState } from 'react'
import type { NestingResult, SheetResult, PlacedPart, Part, Polygon } from '../types'
import { polygonBounds, polygonArea } from '../algorithms/geometry'
import { downloadSheetDXF, downloadCombinedDXF } from '../utils/dxfExporter'
import { ZoomIn, ZoomOut, Download, FileCode2 } from 'lucide-react'

const COLORS = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#f87171', '#2dd4bf', '#fb923c', '#818cf8', '#4ade80',
]

interface NestingCanvasProps {
  result: NestingResult | null
  parts?: Part[]
  svgRefs?: React.MutableRefObject<SVGSVGElement[]>
}

export function NestingCanvas({ result, parts, svgRefs }: NestingCanvasProps) {
  const [activeSheet, setActiveSheet] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [hovered, setHovered] = useState<string | null>(null)

  // ── Before nesting: show imported parts as a preview grid ──────────────
  if (!result || result.sheetResults.length === 0) {
    if (parts && parts.length > 0) {
      return <PartsGrid parts={parts} />
    }
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
        <div className="text-center text-gray-400">
          <div className="text-5xl mb-3">⬜</div>
          <p className="font-medium text-gray-500">No nesting result yet</p>
          <p className="text-sm mt-1">Add parts and click "Start Nesting"</p>
        </div>
      </div>
    )
  }

  const sheet = result.sheetResults[activeSheet]
  if (!sheet) return null

  const handleDownloadSVG = () => {
    const svgEl = svgRefs?.current[activeSheet]
    if (!svgEl) return
    const svgStr = new XMLSerializer().serializeToString(svgEl)
    const blob = new Blob([svgStr], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sheet-${activeSheet + 1}-layout.svg`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 flex flex-col gap-3 min-h-0">
      {/* Sheet tabs + controls */}
      <div className="flex items-center gap-2 flex-wrap">
        {result.sheetResults.map((s, i) => (
          <button
            key={i}
            onClick={() => setActiveSheet(i)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              activeSheet === i
                ? 'bg-blue-600 text-white shadow'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-blue-300'
            }`}
          >
            Sheet {i + 1}
            <span className={`ml-1 text-[10px] ${activeSheet === i ? 'text-blue-200' : 'text-gray-400'}`}>
              {s.efficiency.toFixed(0)}%
            </span>
          </button>
        ))}

        <div className="ml-auto flex items-center gap-1 flex-wrap">
          <button onClick={() => setZoom(z => Math.min(z + 0.25, 4))}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition text-gray-600">
            <ZoomIn size={14} />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.15))}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition text-gray-600">
            <ZoomOut size={14} />
          </button>
          <button onClick={handleDownloadSVG}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 transition text-xs text-gray-600">
            <Download size={13} /> SVG
          </button>
          <button
            onClick={() => downloadSheetDXF(result, activeSheet)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-green-300 bg-green-50 hover:bg-green-100 transition text-xs text-green-700 font-medium"
            title="Export this sheet as production DXF"
          >
            <FileCode2 size={13} /> DXF
          </button>
          <button
            onClick={() => downloadCombinedDXF(result)}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-green-400 bg-green-600 hover:bg-green-700 transition text-xs text-white font-medium"
            title="Export ALL sheets as one DXF file"
          >
            <FileCode2 size={13} /> All Sheets DXF
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <SheetStats sheet={sheet} result={result} />

      {/* Parts per sheet — always visible */}
      <PartCountPanel sheet={sheet} result={result} />

      {/* Main drawing */}
      <div className="flex-1 overflow-auto bg-gray-100 rounded-xl border border-gray-200 p-2 min-h-0">
        <SheetDrawing
          sheet={sheet}
          zoom={zoom}
          hovered={hovered}
          setHovered={setHovered}
          svgRef={svgRefs ? el => { if (svgRefs.current) svgRefs.current[activeSheet] = el! } : undefined}
        />
      </div>

      {/* Legend */}
      <PartLegend sheet={sheet} hovered={hovered} setHovered={setHovered} />
    </div>
  )
}

// ── Parts count panel ──────────────────────────────────────────────────────
function PartCountPanel({ sheet, result }: { sheet: SheetResult; result: NestingResult }) {
  // Count each part type on THIS sheet
  const sheetCounts = new Map<string, { name: string; color: string; count: number }>()
  for (const p of sheet.placements) {
    const e = sheetCounts.get(p.partId) ?? { name: p.name, color: p.color, count: 0 }
    e.count++
    sheetCounts.set(p.partId, e)
  }

  // Count each part type across ALL sheets
  const totalCounts = new Map<string, number>()
  for (const s of result.sheetResults) {
    for (const p of s.placements) totalCounts.set(p.partId, (totalCounts.get(p.partId) ?? 0) + 1)
  }

  return (
    <div className="bg-white border border-blue-200 rounded-xl px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Parts fitted — Sheet {sheet.sheetIndex + 1}
      </p>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
        {Array.from(sheetCounts.entries()).map(([id, { name, color, count }]) => (
          <div key={id} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <span className="text-gray-700 truncate flex-1">{name}</span>
            <span className="font-semibold text-blue-700">×{count}</span>
            <span className="text-gray-400">/ {totalCounts.get(id) ?? count} total</span>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
        <span><b className="text-gray-700">{sheet.placements.length}</b> parts on this sheet</span>
        <span>
          <b className="text-gray-700">{result.placedCount}</b> / {result.totalParts} total placed
          {result.unplaced.length > 0 && (
            <span className="text-red-500 ml-1">({result.unplaced.reduce((s, u) => s + u.remaining, 0)} unplaced)</span>
          )}
        </span>
      </div>
    </div>
  )
}

// ── Parts preview grid (shown before nesting) ──────────────────────────────
function PartsGrid({ parts }: { parts: Part[] }) {
  return (
    <div className="flex-1 flex flex-col bg-gray-50 rounded-xl border border-gray-200 overflow-auto p-4 gap-3 min-h-0">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Imported Parts — {parts.length} type{parts.length !== 1 ? 's' : ''} ·{' '}
        {parts.reduce((s, p) => s + p.quantity, 0)} total instances
      </p>
      <div className="flex flex-wrap gap-3">
        {parts.map((part, pi) => {
          const color = COLORS[pi % COLORS.length]
          const xs = part.polygon.map(p => p.x)
          const ys = part.polygon.map(p => p.y)
          const minX = Math.min(...xs), minY = Math.min(...ys)
          const maxX = Math.max(...xs), maxY = Math.max(...ys)
          const w = maxX - minX || 1, h = maxY - minY || 1
          const PAD = 6, SIZE = 120
          const scale = SIZE / Math.max(w, h)
          const svgW = w * scale + PAD * 2
          const svgH = h * scale + PAD * 2
          const toPath = (pts: Polygon) =>
            pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x - minX) * scale + PAD} ${(p.y - minY) * scale + PAD}`).join(' ') + ' Z'
          const d = [part.polygon, ...(part.holes ?? [])].map(toPath).join(' ')
          const area = part.area ?? polygonArea(part.polygon)

          return (
            <div key={part.id}
              className="bg-white rounded-xl border border-gray-200 p-3 flex flex-col items-center gap-1 shadow-sm hover:border-blue-300 transition"
              style={{ minWidth: 140 }}
            >
              <svg width={svgW} height={svgH} style={{ maxWidth: 140, maxHeight: 140, display: 'block' }}>
                <path d={d} fillRule="evenodd" fill={color} fillOpacity={0.3} stroke={color} strokeWidth="1.5" />
              </svg>
              <p className="text-xs font-medium text-gray-700 text-center truncate w-full">{part.name}</p>
              <p className="text-[10px] text-gray-400 text-center">
                {w.toFixed(0)} × {h.toFixed(0)} mm · {(area / 100).toFixed(1)} cm²
              </p>
              {part.holes && part.holes.length > 0 && (
                <p className="text-[10px] text-green-600">{part.holes.length} hole{part.holes.length !== 1 ? 's' : ''}</p>
              )}
              <span className="text-[10px] bg-blue-50 text-blue-600 font-semibold px-2 py-0.5 rounded-full">
                × {part.quantity}
              </span>
            </div>
          )
        })}
      </div>
      <p className="text-xs text-gray-400 text-center mt-2">
        ↑ Click "Start Nesting" in the toolbar to arrange these parts on sheets
      </p>
    </div>
  )
}

// ── Sheet Drawing (SVG) ────────────────────────────────────────────────────
function SheetDrawing({
  sheet, zoom, hovered, setHovered, svgRef,
}: {
  sheet: SheetResult
  zoom: number
  hovered: string | null
  setHovered: (id: string | null) => void
  svgRef?: (el: SVGSVGElement | null) => void
}) {
  const DISPLAY_MAX = 700
  const scale = Math.min(DISPLAY_MAX / sheet.sheetWidth, DISPLAY_MAX / sheet.sheetHeight) * zoom
  const svgW = sheet.sheetWidth * scale
  const svgH = sheet.sheetHeight * scale
  const PAD = 10

  const toPath = (pts: Polygon, ox = 0, oy = 0) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x + ox) * scale + PAD} ${(p.y + oy) * scale + PAD}`).join(' ') + ' Z'

  const partPath = (p: PlacedPart) => {
    const outer = toPath(p.polygon)
    const inner = (p.holes ?? []).map(h => toPath(h)).join(' ')
    return outer + (inner ? ' ' + inner : '')
  }

  return (
    <div className="flex justify-center">
      <svg
        ref={svgRef}
        width={svgW + PAD * 2}
        height={svgH + PAD * 2}
        style={{ display: 'block' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Sheet background */}
        <rect x={PAD} y={PAD} width={svgW} height={svgH} fill="white" stroke="#94a3b8" strokeWidth="1.5" />
        <GridLines sheetW={sheet.sheetWidth} sheetH={sheet.sheetHeight} scale={scale} pad={PAD} />

        {/* Parts with holes (evenodd fill) */}
        {sheet.placements.map(p => {
          const d = partPath(p)
          const bounds = polygonBounds(p.polygon)
          const cx = ((bounds.minX + bounds.maxX) / 2) * scale + PAD
          const cy = ((bounds.minY + bounds.maxY) / 2) * scale + PAD
          const isHovered = hovered === p.partId
          const labelSize = Math.max(6, Math.min(11, (bounds.width + bounds.height) * scale / 15))

          return (
            <g key={p.uid}
              onMouseEnter={() => setHovered(p.partId)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}>
              {/* Filled shape with holes cut out */}
              <path
                d={d}
                fillRule="evenodd"
                fill={p.color}
                fillOpacity={isHovered ? 0.85 : 0.5}
                stroke={p.color}
                strokeWidth={isHovered ? 2 : 1}
              />
              {/* Part label */}
              {scale > 0.2 && (
                <text x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize={labelSize} fill="#1e293b"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {p.name.length > 10 ? p.name.slice(0, 9) + '…' : p.name}
                </text>
              )}
              {p.rotation !== 0 && scale > 0.3 && (
                <text x={cx} y={cy + labelSize + 1}
                  textAnchor="middle" dominantBaseline="middle"
                  fontSize="7" fill="#64748b"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}>
                  {p.rotation}°
                </text>
              )}
            </g>
          )
        })}

        {/* Dimension labels */}
        <text x={PAD + svgW / 2} y={PAD + svgH + 14} textAnchor="middle" fontSize="10" fill="#64748b">
          {sheet.sheetWidth} mm
        </text>
        <text x={PAD - 8} y={PAD + svgH / 2} textAnchor="middle" fontSize="10" fill="#64748b"
          transform={`rotate(-90, ${PAD - 8}, ${PAD + svgH / 2})`}>
          {sheet.sheetHeight} mm
        </text>
      </svg>
    </div>
  )
}

function GridLines({ sheetW, sheetH, scale, pad }: { sheetW: number; sheetH: number; scale: number; pad: number }) {
  const step = 100
  const lines = []
  for (let x = step; x < sheetW; x += step)
    lines.push(<line key={`v${x}`} x1={x * scale + pad} y1={pad} x2={x * scale + pad} y2={sheetH * scale + pad} stroke="#e2e8f0" strokeWidth="0.5" />)
  for (let y = step; y < sheetH; y += step)
    lines.push(<line key={`h${y}`} x1={pad} y1={y * scale + pad} x2={sheetW * scale + pad} y2={y * scale + pad} stroke="#e2e8f0" strokeWidth="0.5" />)
  return <>{lines}</>
}

// ── Sheet stats bar ────────────────────────────────────────────────────────
function SheetStats({ sheet, result }: { sheet: SheetResult; result: NestingResult }) {
  const effColor = sheet.efficiency >= 70 ? 'text-green-600' : sheet.efficiency >= 50 ? 'text-yellow-600' : 'text-red-500'

  // Unique part types on this sheet
  const uniqueParts = new Set(sheet.placements.map(p => p.partId)).size

  return (
    <div className="flex flex-wrap gap-4 bg-white rounded-lg border border-gray-200 px-4 py-2">
      <Stat label="Sheet" value={`${sheet.sheetIndex + 1} / ${result.totalSheets}`} />
      <Stat label="Parts (this sheet)" value={String(sheet.placements.length)} />
      <Stat label="Part Types" value={String(uniqueParts)} />
      <Stat label="Sheet Area" value={`${(sheet.sheetArea / 100).toFixed(0)} cm²`} />
      <Stat label="Used Area" value={`${(sheet.usedArea / 100).toFixed(0)} cm²`} />
      <Stat label="Efficiency" value={`${sheet.efficiency.toFixed(1)}%`} valueClass={effColor} />
      <Stat label="Waste" value={`${((1 - sheet.usedArea / sheet.sheetArea) * 100).toFixed(1)}%`} />
    </div>
  )
}

function Stat({ label, value, valueClass = 'text-gray-800' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="text-center">
      <p className="text-[10px] text-gray-400 uppercase">{label}</p>
      <p className={`text-sm font-semibold ${valueClass}`}>{value}</p>
    </div>
  )
}

// ── Part legend ────────────────────────────────────────────────────────────
function PartLegend({ sheet, hovered, setHovered }: {
  sheet: SheetResult; hovered: string | null; setHovered: (id: string | null) => void
}) {
  const unique = new Map<string, { name: string; color: string; count: number; holes: number }>()
  for (const p of sheet.placements) {
    const e = unique.get(p.partId) ?? { name: p.name, color: p.color, count: 0, holes: p.holes?.length ?? 0 }
    e.count++
    unique.set(p.partId, e)
  }
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from(unique.entries()).map(([id, { name, color, count, holes }]) => (
        <div
          key={id}
          onMouseEnter={() => setHovered(id)}
          onMouseLeave={() => setHovered(null)}
          className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs border transition cursor-default ${
            hovered === id ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white'
          }`}
        >
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
          <span className="text-gray-700">{name}</span>
          <span className="font-semibold text-blue-700">×{count}</span>
          {holes > 0 && <span className="text-gray-400 text-[10px]">{holes}✕⭕</span>}
        </div>
      ))}
    </div>
  )
}
