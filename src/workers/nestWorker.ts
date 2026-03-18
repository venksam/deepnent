/**
 * Web Worker – runs the nesting engine off the main thread
 * so the UI stays responsive during computation.
 */

import { runNesting } from '../algorithms/nestingEngine'
import type { WorkerInput, WorkerMessage } from '../types'

self.onmessage = async (e: MessageEvent<WorkerInput>) => {
  const { parts, settings } = e.data

  try {
    const result = await runNesting(parts, settings, (gen, total, eff, status) => {
      const msg: WorkerMessage = {
        type: 'progress',
        generation: gen,
        totalGenerations: total,
        bestEfficiency: eff,
        status,
      }
      self.postMessage(msg)
    })

    const msg: WorkerMessage = { type: 'result', result }
    self.postMessage(msg)
  } catch (err) {
    const msg: WorkerMessage = {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    }
    self.postMessage(msg)
  }
}
