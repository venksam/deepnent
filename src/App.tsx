import { useState, useRef } from 'react'
import { Play, Square, FileText, RotateCcw, AlertTriangle, FileCode2 } from 'lucide-react'
import { Header } from './components/Header'
import { PartManager } from './components/PartManager'
import { SheetConfig } from './components/SheetConfig'
import { NestingCanvas } from './components/NestingCanvas'
import { ReportPanel } from './components/ReportPanel'
import { useNesting } from './hooks/useNesting'
import { downloadCombinedDXF } from './utils/dxfExporter'
import type { Part, NestingSettings } from './types'
import { DEFAULT_SETTINGS } from './types'

export default function App() {
  const [parts, setParts] = useState<Part[]>([])
  const [settings, setSettings] = useState<NestingSettings>(DEFAULT_SETTINGS)
  const [showReport, setShowReport] = useState(false)
  const svgRefs = useRef<SVGSVGElement[]>([])
  const { isNesting, progress, result, error, startNesting, cancelNesting, clearResult } = useNesting()

  const handleStart = () => {
    if (parts.length === 0) return
    clearResult()
    svgRefs.current = []
    startNesting(parts, settings)
  }

  const handleReset = () => {
    cancelNesting()
    clearResult()
  }

  const totalInstances = parts.reduce((s, p) => s + p.quantity, 0)

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <Header partCount={parts.length} isNesting={isNesting} />

      <div className="flex-1 flex overflow-hidden" style={{ height: 'calc(100vh - 60px)' }}>
        {/* ── Left Sidebar ───────────────────────────────────── */}
        <aside className="w-72 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-y-auto">
          <div className="p-4 space-y-6">
            {/* Parts */}
            <PartManager parts={parts} onChange={setParts} settings={settings} />

            {/* Divider */}
            <hr className="border-gray-100" />

            {/* Sheet Config */}
            <SheetConfig settings={settings} onChange={setSettings} />
          </div>
        </aside>

        {/* ── Main Area ──────────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden p-4 gap-4 min-w-0">
          {/* Control Bar */}
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-3 flex-shrink-0">
            {!isNesting ? (
              <button
                onClick={handleStart}
                disabled={parts.length === 0}
                className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white rounded-lg font-medium text-sm transition shadow-sm"
              >
                <Play size={16} />
                Start Nesting
              </button>
            ) : (
              <button
                onClick={cancelNesting}
                className="flex items-center gap-2 px-5 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium text-sm transition shadow-sm"
              >
                <Square size={16} />
                Stop
              </button>
            )}

            {result && (
              <>
                <button
                  onClick={() => setShowReport(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium transition shadow-sm"
                >
                  <FileText size={15} />
                  View Report
                </button>
                <button
                  onClick={() => downloadCombinedDXF(result)}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition shadow-sm"
                  title="Export all sheets as production DXF"
                >
                  <FileCode2 size={15} />
                  Export DXF
                </button>
                <button
                  onClick={handleReset}
                  className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg text-sm transition"
                >
                  <RotateCcw size={14} />
                  Reset
                </button>
              </>
            )}

            {/* Progress */}
            {isNesting && progress && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                  <span>{progress.status}</span>
                  <span>{progress.bestEfficiency.toFixed(1)}% efficiency</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${(progress.generation / progress.totalGenerations) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* Result summary */}
            {result && !isNesting && (
              <div className="flex-1 flex items-center gap-4 text-sm text-gray-600 pl-2">
                <span>
                  <span className="font-semibold text-gray-800">{result.totalSheets}</span> sheet{result.totalSheets !== 1 ? 's' : ''}
                </span>
                <span>
                  <span className="font-semibold text-gray-800">{result.placedCount}</span>/{result.totalParts} parts
                </span>
                <span>
                  <span className={`font-semibold ${result.overallEfficiency >= 70 ? 'text-green-600' : result.overallEfficiency >= 50 ? 'text-yellow-600' : 'text-red-500'}`}>
                    {result.overallEfficiency.toFixed(1)}%
                  </span> efficiency
                </span>
                {result.unplaced.length > 0 && (
                  <span className="flex items-center gap-1 text-orange-500">
                    <AlertTriangle size={13} />
                    {result.unplaced.reduce((s, u) => s + u.remaining, 0)} unplaced
                  </span>
                )}
              </div>
            )}

            {parts.length === 0 && !isNesting && !result && (
              <p className="text-sm text-gray-400 ml-2">
                ← Add parts from the sidebar to begin
              </p>
            )}

            <div className="ml-auto text-xs text-gray-400">
              {totalInstances} instance{totalInstances !== 1 ? 's' : ''} · {settings.sheetSize} mm sheet
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex-shrink-0">
              <AlertTriangle size={16} />
              <span>Nesting error: {error}</span>
            </div>
          )}

          {/* Canvas */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            <NestingCanvas result={result} parts={parts} svgRefs={svgRefs} />
          </div>
        </main>
      </div>

      {/* Report Modal */}
      {showReport && result && (
        <ReportPanel
          result={result}
          svgRefs={svgRefs}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  )
}
