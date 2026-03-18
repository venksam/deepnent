import { useState, useRef } from 'react'
import { Plus, Trash2, Upload, Square, Hexagon, Triangle, FileCode2 } from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { SHEET_SIZES } from '../types'
import type { Part, NestingSettings } from '../types'
import { normalizePolygon, polygonArea, polygonBounds } from '../algorithms/geometry'
import { createRectPart, createRegularPolygon, createLShape, parseSVGFile } from '../utils/svgParser'
import { parseDXFFile } from '../utils/dxfParser'

interface PartManagerProps {
  parts: Part[]
  onChange: (parts: Part[]) => void
  /** Current sheet settings — used to auto-calculate quantity on DXF import */
  settings?: NestingSettings
}

const PART_COLORS = [
  '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
  '#f87171', '#2dd4bf', '#fb923c', '#818cf8', '#4ade80',
]

export function PartManager({ parts, onChange, settings }: PartManagerProps) {
  const [showAdd, setShowAdd] = useState(false)
  const [addMode, setAddMode] = useState<'rect' | 'polygon' | 'lshape' | 'circle'>('rect')
  const [form, setForm] = useState({
    name: '',
    width: '200', height: '100',
    sides: '6', radius: '80',
    lw: '200', lh: '150', lcw: '80', lch: '70',
    qty: '1',
    rotations: '4',
  })
  const [importError, setImportError] = useState<string | null>(null)
  const [previewPart, setPreviewPart] = useState<Part | null>(null)

  const svgFileRef = useRef<HTMLInputElement>(null)
  const dxfFileRef = useRef<HTMLInputElement>(null)

  const colorFor = (i: number) => PART_COLORS[i % PART_COLORS.length]

  // ── Add manually drawn part ─────────────────────────────────────────────
  const addPart = () => {
    let poly
    let name = form.name.trim()

    if (addMode === 'rect') {
      poly = createRectPart(parseFloat(form.width), parseFloat(form.height))
      if (!name) name = `Rect ${parseFloat(form.width)}x${parseFloat(form.height)}`
    } else if (addMode === 'polygon') {
      poly = createRegularPolygon(parseInt(form.sides), parseFloat(form.radius))
      if (!name) name = `Polygon-${form.sides}sides`
    } else if (addMode === 'lshape') {
      poly = createLShape(
        parseFloat(form.lw), parseFloat(form.lh),
        parseFloat(form.lcw), parseFloat(form.lch)
      )
      if (!name) name = `L-Shape ${form.lw}x${form.lh}`
    } else {
      poly = createRegularPolygon(64, parseFloat(form.radius))
      if (!name) name = `Circle r=${form.radius}`
    }

    const steps = parseInt(form.rotations)
    const rots: number[] = []
    for (let i = 0; i < steps; i++) rots.push((360 / steps) * i)

    const part: Part = {
      id: uuid(),
      name,
      polygon: normalizePolygon(poly),
      quantity: parseInt(form.qty) || 1,
      allowedRotations: rots,
      color: colorFor(parts.length),
      area: polygonArea(poly),
    }
    onChange([...parts, part])
    setShowAdd(false)
    setForm({ ...form, name: '' })
  }

  const removePart = (id: string) => onChange(parts.filter(p => p.id !== id))

  const updateQty = (id: string, qty: number) =>
    onChange(parts.map(p => p.id === id ? { ...p, quantity: Math.max(1, qty) } : p))

  // ── SVG Upload ────────────────────────────────────────────────────────────
  const handleSVGUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    setImportError(null)
    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        const text = ev.target?.result as string
        const shapes = parseSVGFile(text, file.name)
        if (shapes.length === 0) {
          setImportError(`No valid shapes found in "${file.name}"`)
          return
        }
        const newParts: Part[] = shapes.map((s, i) => ({
          id: uuid(),
          name: s.name,
          polygon: s.polygon,
          quantity: 1,
          allowedRotations: [0, 90, 180, 270],
          color: colorFor(parts.length + i),
          area: s.area,
        }))
        onChange([...parts, ...newParts])
      }
      reader.readAsText(file)
    })
    e.target.value = ''
  }

  // ── DXF Upload ────────────────────────────────────────────────────────────
  const handleDXFUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    setImportError(null)

    Array.from(files).forEach(file => {
      const reader = new FileReader()
      reader.onload = ev => {
        try {
          const text = ev.target?.result as string
          const shapes = parseDXFFile(text, file.name)

          if (shapes.length === 0) {
            setImportError(
              `No closed polygons found in "${file.name}". ` +
              `Ensure the file contains LWPOLYLINE, POLYLINE, LINE loops, CIRCLE, ARC, ELLIPSE or SPLINE entities.`
            )
            return
          }

          // Auto-calculate quantity: count how many part bboxes fit on one sheet
          // (floor-math, exact — avoids over-estimation from concave polygon area)
          const sheet = SHEET_SIZES[settings?.sheetSize ?? '1000x2000']
          const edgeGap = settings?.edgeGap ?? 5
          const gap     = settings?.partGap  ?? 3
          const innerW  = sheet.width  - 2 * edgeGap
          const innerH  = sheet.height - 2 * edgeGap

          const newParts: Part[] = shapes.map((s, i) => {
            const bnds = polygonBounds(s.polygon)   // polygon is normalised: minX=minY=0
            const bW   = bnds.maxX
            const bH   = bnds.maxY
            // Count fits at 0° and 90°, take the larger
            const fits0   = Math.floor(innerW / (bW + gap)) * Math.floor(innerH / (bH + gap))
            const fits90  = bH > 0 && bW > 0
              ? Math.floor(innerW / (bH + gap)) * Math.floor(innerH / (bW + gap))
              : 0
            const autoQty = Math.max(1, Math.max(fits0, fits90))
            return {
              id: uuid(),
              name: s.name,
              polygon: s.polygon,
              holes: s.holes.length > 0 ? s.holes : undefined,
              quantity: autoQty,
              allowedRotations: [0, 90, 180, 270],
              color: colorFor(parts.length + i),
              area: s.area,
            }
          })
          onChange([...parts, ...newParts])
        } catch (err) {
          setImportError(`Failed to parse "${file.name}": ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      reader.onerror = () => setImportError(`Could not read file "${file.name}"`)
      reader.readAsText(file)
    })
    e.target.value = ''
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Parts</h2>
        <div className="flex gap-1">
          <button
            onClick={() => svgFileRef.current?.click()}
            title="Import SVG file(s)"
            className="flex items-center gap-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded transition"
          >
            <Upload size={12} /> SVG
          </button>
          <button
            onClick={() => dxfFileRef.current?.click()}
            title="Import DXF — LWPOLYLINE, POLYLINE, LINE, CIRCLE, ARC, ELLIPSE, SPLINE"
            className="flex items-center gap-1 text-xs bg-purple-100 hover:bg-purple-200 text-purple-700 px-2 py-1 rounded transition"
          >
            <FileCode2 size={12} /> DXF
          </button>
          <button
            onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1 text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition"
          >
            <Plus size={12} /> Add
          </button>
        </div>
        <input ref={svgFileRef} type="file" accept=".svg" multiple className="hidden" onChange={handleSVGUpload} />
        <input ref={dxfFileRef} type="file" accept=".dxf,.DXF" multiple className="hidden" onChange={handleDXFUpload} />
      </div>

      {/* Import error banner */}
      {importError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs flex items-start gap-2">
          <span className="mt-0.5 flex-shrink-0">⚠</span>
          <div className="flex-1">
            <p className="font-medium">Import error</p>
            <p className="mt-0.5 text-red-500">{importError}</p>
          </div>
          <button onClick={() => setImportError(null)} className="text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* DXF hint */}
      <div className="bg-purple-50 border border-purple-100 rounded-lg px-3 py-1.5 text-[10px] text-purple-600 leading-relaxed">
        <span className="font-semibold">DXF supports:</span> LWPOLYLINE · POLYLINE · LINE loops · CIRCLE · ARC · ELLIPSE · SPLINE
        <br /><span className="text-purple-400">Holes / internal cutouts are automatically excluded from nesting.</span>
      </div>

      {/* Add Part Form */}
      {showAdd && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-3">
          <div className="flex gap-1">
            {[
              { mode: 'rect' as const,    icon: <Square size={13} />,   label: 'Rect'    },
              { mode: 'lshape' as const,  icon: <Square size={13} />,   label: 'L-Shape' },
              { mode: 'polygon' as const, icon: <Hexagon size={13} />,  label: 'Polygon' },
              { mode: 'circle' as const,  icon: <Triangle size={13} />, label: 'Circle'  },
            ].map(({ mode, icon, label }) => (
              <button
                key={mode}
                onClick={() => setAddMode(mode)}
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition flex-1 justify-center ${
                  addMode === mode
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {icon} {label}
              </button>
            ))}
          </div>

          <input
            type="text" placeholder="Part name (optional)" value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />

          {addMode === 'rect' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">Width (mm)
                <input type="number" value={form.width} onChange={e => setForm(f => ({ ...f, width: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </label>
              <label className="text-xs text-gray-500">Height (mm)
                <input type="number" value={form.height} onChange={e => setForm(f => ({ ...f, height: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </label>
            </div>
          )}

          {addMode === 'circle' && (
            <label className="text-xs text-gray-500">Radius (mm)
              <input type="number" value={form.radius} onChange={e => setForm(f => ({ ...f, radius: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </label>
          )}

          {addMode === 'polygon' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">Sides
                <input type="number" value={form.sides} min="3" max="12" onChange={e => setForm(f => ({ ...f, sides: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </label>
              <label className="text-xs text-gray-500">Radius (mm)
                <input type="number" value={form.radius} onChange={e => setForm(f => ({ ...f, radius: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </label>
            </div>
          )}

          {addMode === 'lshape' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-500">Width (mm)
                <input type="number" value={form.lw} onChange={e => setForm(f => ({ ...f, lw: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </label>
              <label className="text-xs text-gray-500">Height (mm)
                <input type="number" value={form.lh} onChange={e => setForm(f => ({ ...f, lh: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </label>
              <label className="text-xs text-gray-500">Cut Width (mm)
                <input type="number" value={form.lcw} onChange={e => setForm(f => ({ ...f, lcw: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </label>
              <label className="text-xs text-gray-500">Cut Height (mm)
                <input type="number" value={form.lch} onChange={e => setForm(f => ({ ...f, lch: e.target.value }))}
                  className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-gray-500">Quantity
              <input type="number" value={form.qty} min="1" onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400" />
            </label>
            <label className="text-xs text-gray-500">Rotations
              <select value={form.rotations} onChange={e => setForm(f => ({ ...f, rotations: e.target.value }))}
                className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400">
                <option value="1">No rotation</option>
                <option value="2">180°</option>
                <option value="4">90° steps</option>
                <option value="8">45° steps</option>
              </select>
            </label>
          </div>

          <div className="flex gap-2">
            <button onClick={addPart}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 rounded transition">
              Add Part
            </button>
            <button onClick={() => setShowAdd(false)}
              className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs py-1.5 rounded transition">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Parts List */}
      <div className="space-y-1 overflow-y-auto max-h-96">
        {parts.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">
            No parts added yet.<br />Click "Add", import an SVG, or import a DXF.
          </p>
        )}
        {parts.map((part, i) => (
          <div
            key={part.id}
            className="flex items-center gap-2 bg-white border border-gray-100 rounded-lg px-2 py-1.5 hover:border-blue-300 transition cursor-pointer"
            onClick={() => setPreviewPart({ ...part, color: colorFor(i) })}
          >
            <PartPreview polygon={part.polygon} holes={part.holes} color={colorFor(i)} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{part.name}</p>
              <p className="text-[10px] text-gray-400">
                {part.area ? `${(part.area / 100).toFixed(0)} cm²` : ''} · {part.allowedRotations.length} rot
              </p>
            </div>
            <input
              type="number" min="1" value={part.quantity}
              onClick={e => e.stopPropagation()}
              onChange={e => updateQty(part.id, parseInt(e.target.value) || 1)}
              className="w-12 text-xs border border-gray-200 rounded px-1 py-0.5 text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <button
              onClick={e => { e.stopPropagation(); removePart(part.id) }}
              className="text-gray-300 hover:text-red-500 transition flex-shrink-0"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {parts.length > 0 && (
        <div className="text-xs text-gray-400 text-center">
          {parts.reduce((s: number, p) => s + p.quantity, 0)} total instances · click a part to preview
        </div>
      )}

      {/* ── Part preview modal ─────────────────────────────────────────── */}
      {previewPart && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setPreviewPart(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-5 w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-gray-800 text-sm truncate">{previewPart.name}</p>
              <button onClick={() => setPreviewPart(null)} className="text-gray-400 hover:text-gray-700 text-xl leading-none ml-2">&times;</button>
            </div>
            <LargePartPreview polygon={previewPart.polygon} holes={previewPart.holes} color={previewPart.color ?? '#60a5fa'} />
            <div className="mt-3 flex gap-4 text-xs text-gray-500 justify-center">
              <span><b className="text-gray-700">{previewPart.polygon.length}</b> vertices</span>
              <span><b className="text-gray-700">{previewPart.area ? (previewPart.area / 100).toFixed(1) : '?'}</b> cm²</span>
              <span><b className="text-gray-700">{previewPart.quantity}</b> pcs</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sidebar thumbnail (40×40) ─────────────────────────────────────────────
function PartPreview({ polygon, holes, color }: { polygon: { x: number; y: number }[]; holes?: { x: number; y: number }[][]; color: string }) {
  if (polygon.length === 0) return null
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y)
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const maxX = Math.max(...xs), maxY = Math.max(...ys)
  const w = maxX - minX || 1, h = maxY - minY || 1
  const SIZE = 40
  const scale = SIZE / Math.max(w, h)
  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x - minX) * scale} ${(p.y - minY) * scale}`).join(' ') + ' Z'
  const d = [polygon, ...(holes ?? [])].map(toPath).join(' ')
  return (
    <svg width={SIZE} height={SIZE} className="flex-shrink-0 rounded border border-gray-100 bg-gray-50">
      <path d={d} fillRule="evenodd" fill={color} fillOpacity={0.4} stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

// ── Large modal preview ──────────────────────────────────────────────────
function LargePartPreview({ polygon, holes, color }: { polygon: { x: number; y: number }[]; holes?: { x: number; y: number }[][]; color: string }) {
  if (polygon.length === 0) return null
  const xs = polygon.map(p => p.x), ys = polygon.map(p => p.y)
  const minX = Math.min(...xs), minY = Math.min(...ys)
  const maxX = Math.max(...xs), maxY = Math.max(...ys)
  const w = maxX - minX || 1, h = maxY - minY || 1
  const PAD = 16
  const MAX = 280
  const scale = MAX / Math.max(w, h)
  const svgW = w * scale + PAD * 2
  const svgH = h * scale + PAD * 2
  const toPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x - minX) * scale + PAD} ${(p.y - minY) * scale + PAD}`).join(' ') + ' Z'
  const d = [polygon, ...(holes ?? [])].map(toPath).join(' ')
  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-center overflow-auto">
      <svg
        width={svgW}
        height={svgH}
        style={{ maxWidth: '100%', maxHeight: 320, display: 'block' }}
      >
        {/* Grid */}
        {Array.from({ length: Math.ceil(w / 100) + 1 }, (_, i) => (
          <line key={`vg${i}`}
            x1={i * 100 * scale + PAD} y1={PAD}
            x2={i * 100 * scale + PAD} y2={svgH - PAD}
            stroke="#e5e7eb" strokeWidth="0.5" />
        ))}
        {Array.from({ length: Math.ceil(h / 100) + 1 }, (_, i) => (
          <line key={`hg${i}`}
            x1={PAD} y1={i * 100 * scale + PAD}
            x2={svgW - PAD} y2={i * 100 * scale + PAD}
            stroke="#e5e7eb" strokeWidth="0.5" />
        ))}
        <path d={d} fillRule="evenodd" fill={color} fillOpacity={0.25} stroke={color} strokeWidth="2" />
        {/* Hole outlines */}
        {holes?.map((h, hi) => {
          const hp = h.map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x - minX) * scale + PAD} ${(p.y - minY) * scale + PAD}`).join(' ') + ' Z'
          return <path key={hi} d={hp} fill="none" stroke={color} strokeWidth="1" strokeDasharray="3,2" opacity={0.6} />
        })}
        {/* Dimension labels */}
        <text x={svgW / 2} y={svgH - 2} textAnchor="middle" fontSize="10" fill="#9ca3af">{w.toFixed(0)} mm</text>
        <text x={4} y={svgH / 2} textAnchor="middle" fontSize="10" fill="#9ca3af"
          transform={`rotate(-90,4,${svgH / 2})`}>{h.toFixed(0)} mm</text>
        {/* Holes count */}
        {holes && holes.length > 0 && (
          <text x={svgW - PAD} y={PAD + 10} textAnchor="end" fontSize="9" fill="#6b7280">
            {holes.length} hole{holes.length !== 1 ? 's' : ''}
          </text>
        )}
      </svg>
    </div>
  )
}
