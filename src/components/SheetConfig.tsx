import { Settings, ChevronDown, ChevronUp } from 'lucide-react'
import { useState } from 'react'
import type { NestingSettings } from '../types'
import { SHEET_SIZES } from '../types'

interface SheetConfigProps {
  settings: NestingSettings
  onChange: (s: NestingSettings) => void
}

export function SheetConfig({ settings, onChange }: SheetConfigProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const update = (key: keyof NestingSettings, value: number | string) =>
    onChange({ ...settings, [key]: value })

  return (
    <div className="space-y-4">
      {/* Sheet Selection */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Sheet Size</h2>
        <div className="grid grid-cols-1 gap-2">
          {(Object.entries(SHEET_SIZES) as [keyof typeof SHEET_SIZES, typeof SHEET_SIZES[keyof typeof SHEET_SIZES]][]).map(([key, s]) => (
            <button
              key={key}
              onClick={() => update('sheetSize', key)}
              className={`text-left px-3 py-2 rounded-lg border text-xs transition ${
                settings.sheetSize === key
                  ? 'bg-blue-600 text-white border-blue-600 font-semibold'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
              }`}
            >
              <span className="font-medium">{s.label}</span>
              <span className={`ml-2 ${settings.sheetSize === key ? 'text-blue-200' : 'text-gray-400'}`}>
                ({(s.width * s.height / 1e6).toFixed(2)} m²)
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Gap Settings */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1">
          <Settings size={13} /> Cutting Parameters
        </h2>

        <div className="space-y-3">
          <GapInput
            label="Edge Gap"
            description="Space between part and sheet edge"
            unit="mm"
            value={settings.edgeGap}
            min={0} max={50}
            onChange={v => update('edgeGap', v)}
            color="blue"
          />
          <GapInput
            label="Part Gap"
            description="Minimum clearance between parts"
            unit="mm"
            value={settings.partGap}
            min={0} max={50}
            onChange={v => update('partGap', v)}
            color="green"
          />
          <GapInput
            label="Kerf"
            description="Material removed by the cutting tool"
            unit="mm"
            value={settings.kerf}
            min={0} max={20}
            onChange={v => update('kerf', v)}
            color="orange"
          />
        </div>
      </div>

      {/* Rotation */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">Rotation</h2>
        <div className="grid grid-cols-2 gap-1">
          {[
            { v: 1, label: 'Fixed', sub: '0° only' },
            { v: 2, label: '180°', sub: '0°, 180°' },
            { v: 4, label: '90°', sub: '0°–270°' },
            { v: 8, label: '45°', sub: '0°–315°' },
          ].map(r => (
            <button
              key={r.v}
              onClick={() => update('rotationSteps', r.v)}
              className={`px-2 py-2 rounded-lg border text-xs transition text-center ${
                settings.rotationSteps === r.v
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-blue-300'
              }`}
            >
              <div className="font-medium">{r.label}</div>
              <div className={`text-[10px] ${settings.rotationSteps === r.v ? 'text-blue-200' : 'text-gray-400'}`}>{r.sub}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Advanced (GA) */}
      <div>
        <button
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition"
          onClick={() => setShowAdvanced(v => !v)}
        >
          {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          Advanced (Genetic Algorithm)
        </button>

        {showAdvanced && (
          <div className="mt-2 space-y-2 bg-gray-50 border border-gray-100 rounded-lg p-3">
            <NumberInput label="Population Size" min={4} max={50} value={settings.populationSize}
              onChange={v => update('populationSize', v)} />
            <NumberInput label="Generations" min={5} max={200} value={settings.generations}
              onChange={v => update('generations', v)} />
            <label className="block text-xs text-gray-500">
              Mutation Rate ({(settings.mutationRate * 100).toFixed(0)}%)
              <input
                type="range" min={0} max={100} step={5}
                value={settings.mutationRate * 100}
                onChange={e => update('mutationRate', parseInt(e.target.value) / 100)}
                className="w-full mt-1 accent-blue-600"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ───────────────────────────────────────────

function GapInput({
  label, description, unit, value, min, max, onChange, color,
}: {
  label: string
  description: string
  unit: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  color: 'blue' | 'green' | 'orange'
}) {
  const colorMap = {
    blue: 'bg-blue-500',
    green: 'bg-green-500',
    orange: 'bg-orange-500',
  }
  return (
    <div className="flex items-center gap-3">
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colorMap[color]}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">{label}</span>
          <div className="flex items-center gap-1">
            <input
              type="number" value={value} min={min} max={max} step={0.5}
              onChange={e => onChange(parseFloat(e.target.value) || 0)}
              className="w-14 text-xs border border-gray-200 rounded px-1.5 py-0.5 text-right focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <span className="text-xs text-gray-400">{unit}</span>
          </div>
        </div>
        <p className="text-[10px] text-gray-400">{description}</p>
        <input
          type="range" min={min} max={max} step={0.5} value={value}
          onChange={e => onChange(parseFloat(e.target.value))}
          className="w-full mt-1 accent-blue-600"
        />
      </div>
    </div>
  )
}

function NumberInput({ label, min, max, value, onChange }: {
  label: string; min: number; max: number; value: number; onChange: (v: number) => void
}) {
  return (
    <label className="block text-xs text-gray-500">
      {label}
      <input
        type="number" value={value} min={min} max={max}
        onChange={e => onChange(parseInt(e.target.value) || min)}
        className="w-full border border-gray-200 rounded px-2 py-1 mt-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    </label>
  )
}
