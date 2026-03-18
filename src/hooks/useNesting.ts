import { useState, useRef, useCallback } from 'react'
import type { Part, NestingSettings, NestingResult, WorkerMessage, WorkerProgress } from '../types'

interface UseNestingReturn {
  isNesting: boolean
  progress: WorkerProgress | null
  result: NestingResult | null
  error: string | null
  startNesting: (parts: Part[], settings: NestingSettings) => void
  cancelNesting: () => void
  clearResult: () => void
}

export function useNesting(): UseNestingReturn {
  const [isNesting, setIsNesting] = useState(false)
  const [progress, setProgress] = useState<WorkerProgress | null>(null)
  const [result, setResult] = useState<NestingResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const workerRef = useRef<Worker | null>(null)

  const cancelNesting = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate()
      workerRef.current = null
    }
    setIsNesting(false)
    setProgress(null)
  }, [])

  const startNesting = useCallback((parts: Part[], settings: NestingSettings) => {
    if (isNesting) cancelNesting()

    setIsNesting(true)
    setError(null)
    setProgress(null)
    setResult(null)

    const worker = new Worker(
      new URL('../workers/nestWorker.ts', import.meta.url),
      { type: 'module' }
    )
    workerRef.current = worker

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.type === 'progress') {
        setProgress(msg)
      } else if (msg.type === 'result') {
        setResult(msg.result)
        setIsNesting(false)
        setProgress(null)
        worker.terminate()
        workerRef.current = null
      } else if (msg.type === 'error') {
        setError(msg.message)
        setIsNesting(false)
        setProgress(null)
        worker.terminate()
        workerRef.current = null
      }
    }

    worker.onerror = (err) => {
      setError(err.message)
      setIsNesting(false)
      setProgress(null)
      workerRef.current = null
    }

    worker.postMessage({ parts, settings })
  }, [isNesting, cancelNesting])

  const clearResult = useCallback(() => {
    setResult(null)
    setError(null)
    setProgress(null)
  }, [])

  return { isNesting, progress, result, error, startNesting, cancelNesting, clearResult }
}
