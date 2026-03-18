import { Layers } from 'lucide-react'

interface HeaderProps {
  partCount: number
  isNesting: boolean
}

export function Header({ partCount, isNesting }: HeaderProps) {
  return (
    <header className="bg-gradient-to-r from-blue-900 to-blue-700 text-white shadow-lg">
      <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-white/20 rounded-lg p-2">
            <Layers size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">DeepNest Web</h1>
            <p className="text-xs text-blue-200">Sheet Nesting Optimizer</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <span className="bg-white/10 px-3 py-1 rounded-full">
            {partCount} part{partCount !== 1 ? 's' : ''} loaded
          </span>
          {isNesting && (
            <span className="flex items-center gap-2 bg-yellow-500/80 px-3 py-1 rounded-full animate-pulse">
              <span className="w-2 h-2 bg-white rounded-full" />
              Nesting…
            </span>
          )}
        </div>
      </div>
    </header>
  )
}
