import { useState } from 'react'
import { FileText, BarChart3, X, Download, CheckCircle, AlertCircle } from 'lucide-react'
import type { NestingResult } from '../types'
import { SHEET_SIZES } from '../types'
import { generatePDFReport, sheetToDataUrl } from '../utils/reportGenerator'

interface ReportPanelProps {
  result: NestingResult
  svgRefs: React.MutableRefObject<SVGSVGElement[]>
  onClose: () => void
}

export function ReportPanel({ result, svgRefs, onClose }: ReportPanelProps) {
  const [exporting, setExporting] = useState(false)
  const sheet = SHEET_SIZES[result.settings.sheetSize]

  const handleExport = async () => {
    setExporting(true)
    try {
      const dataUrls: string[] = []
      for (let i = 0; i < result.sheetResults.length; i++) {
        const svgEl = svgRefs.current[i]
        if (svgEl) {
          try {
            const url = await sheetToDataUrl(svgEl)
            dataUrls.push(url)
          } catch {
            dataUrls.push('')
          }
        } else {
          dataUrls.push('')
        }
      }
      generatePDFReport(result, dataUrls)
    } finally {
      setExporting(false)
    }
  }

  const totalPartsArea = result.sheetResults.reduce((s, r) => s + r.usedArea, 0)

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="bg-blue-100 text-blue-600 rounded-lg p-1.5">
              <FileText size={18} />
            </div>
            <div>
              <h2 className="font-semibold text-gray-800">Nesting Report</h2>
              <p className="text-xs text-gray-400">{new Date(result.timestamp).toLocaleString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg text-sm transition"
            >
              <Download size={15} />
              {exporting ? 'Exporting…' : 'Export PDF'}
            </button>
            <button onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition text-gray-500">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Overview */}
          <div>
            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3 flex items-center gap-1">
              <BarChart3 size={14} /> Summary
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Sheets Used" value={String(result.totalSheets)} color="blue" />
              <StatCard label="Parts Placed" value={`${result.placedCount} / ${result.totalParts}`} color="green" />
              <StatCard label="Efficiency" value={`${result.overallEfficiency.toFixed(1)}%`} color="purple" />
              <StatCard label="Process Time" value={`${result.processingTime}ms`} color="gray" />
            </div>
          </div>

          {/* Settings used */}
          <div className="bg-gray-50 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Settings Used</h3>
            <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
              <SettingRow k="Sheet Size" v={sheet.label} />
              <SettingRow k="Edge Gap" v={`${result.settings.edgeGap} mm`} />
              <SettingRow k="Part Gap" v={`${result.settings.partGap} mm`} />
              <SettingRow k="Kerf" v={`${result.settings.kerf} mm`} />
              <SettingRow k="Rotation Steps" v={String(result.settings.rotationSteps)} />
              <SettingRow k="GA Generations" v={String(result.settings.generations)} />
            </div>
          </div>

          {/* Per-sheet breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">
              Per-Sheet Breakdown
            </h3>
            <div className="space-y-2">
              {result.sheetResults.map(s => (
                <div key={s.sheetIndex}
                  className="flex items-center gap-4 bg-white border border-gray-100 rounded-xl px-4 py-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 font-bold text-sm flex-shrink-0">
                    {s.sheetIndex + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-700">
                        {s.placements.length} parts
                      </span>
                      <span className="text-xs font-semibold text-gray-800">
                        {s.efficiency.toFixed(1)}% efficiency
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.min(100, s.efficiency)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1 text-[10px] text-gray-400">
                      <span>Used: {(s.usedArea / 100).toFixed(0)} cm²</span>
                      <span>Sheet: {(s.sheetArea / 100).toFixed(0)} cm²</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Parts summary */}
          <div>
            <h3 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Parts Placed</h3>
            <div className="border border-gray-100 rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-3 py-2 text-gray-500 font-medium">Part</th>
                    <th className="text-center px-3 py-2 text-gray-500 font-medium">Count</th>
                    <th className="text-center px-3 py-2 text-gray-500 font-medium">Sheet</th>
                    <th className="text-center px-3 py-2 text-gray-500 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {buildPartsList(result).map((row, i) => (
                    <tr key={i} className="border-t border-gray-50 hover:bg-gray-50 transition">
                      <td className="px-3 py-2 font-medium text-gray-800">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full" style={{ background: row.color }} />
                          {row.name}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-gray-600">{row.count}</td>
                      <td className="px-3 py-2 text-center text-gray-500">{row.sheets}</td>
                      <td className="px-3 py-2 text-center">
                        {row.unplaced > 0 ? (
                          <span className="inline-flex items-center gap-1 text-red-500">
                            <AlertCircle size={11} />{row.unplaced} unplaced
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-green-500">
                            <CheckCircle size={11} /> OK
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Material totals */}
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-3">Material Summary</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-blue-500">Total Sheet Area</p>
                <p className="text-lg font-bold text-blue-700">
                  {(result.sheetResults.reduce((s, r) => s + r.sheetArea, 0) / 1e6).toFixed(3)} m²
                </p>
              </div>
              <div>
                <p className="text-xs text-blue-500">Parts Area</p>
                <p className="text-lg font-bold text-blue-700">
                  {(totalPartsArea / 1e6).toFixed(3)} m²
                </p>
              </div>
              <div>
                <p className="text-xs text-blue-500">Waste</p>
                <p className="text-lg font-bold text-blue-700">
                  {((result.sheetResults.reduce((s, r) => s + r.sheetArea, 0) - totalPartsArea) / 1e6).toFixed(3)} m²
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────

interface PartRow {
  partId: string; name: string; color: string
  count: number; sheets: string; unplaced: number
}

function buildPartsList(result: NestingResult): PartRow[] {
  const map = new Map<string, PartRow>()
  const sheetSet = new Map<string, Set<number>>()

  for (const s of result.sheetResults) {
    for (const p of s.placements) {
      const row = map.get(p.partId) ?? { partId: p.partId, name: p.name, color: p.color, count: 0, sheets: '', unplaced: 0 }
      row.count++
      if (!sheetSet.has(p.partId)) sheetSet.set(p.partId, new Set())
      sheetSet.get(p.partId)!.add(s.sheetIndex + 1)
      map.set(p.partId, row)
    }
  }

  for (const u of result.unplaced) {
    const row = map.get(u.partId) ?? { partId: u.partId, name: u.name, color: '#f87171', count: 0, sheets: '–', unplaced: 0 }
    row.unplaced = u.remaining
    map.set(u.partId, row)
  }

  return Array.from(map.values()).map(row => ({
    ...row,
    sheets: Array.from(sheetSet.get(row.partId) ?? []).sort((a, b) => a - b).join(', ') || '–',
  }))
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-green-50 text-green-700 border-green-100',
    purple: 'bg-purple-50 text-purple-700 border-purple-100',
    gray: 'bg-gray-50 text-gray-700 border-gray-100',
  }
  return (
    <div className={`rounded-xl border p-3 text-center ${colors[color]}`}>
      <p className="text-xs opacity-70 mb-0.5">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  )
}

function SettingRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{k}</span>
      <span className="font-medium text-gray-700">{v}</span>
    </div>
  )
}
