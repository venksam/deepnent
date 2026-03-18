// ─── Geometry ────────────────────────────────────────────────
export interface Point { x: number; y: number }
export type Polygon = Point[]

// ─── Part ────────────────────────────────────────────────────
export interface Part {
  id: string
  name: string
  /** Vertices of the outer contour in local coordinates (origin = 0,0) */
  polygon: Polygon
  /** Inner contours (bolt holes, slots, cutouts) in same local coordinates */
  holes?: Polygon[]
  quantity: number
  /** Allowed rotations in degrees, e.g. [0, 90, 180, 270] */
  allowedRotations: number[]
  color?: string
  /** Pre-computed area in mm² */
  area?: number
}

// ─── Sheet sizes ─────────────────────────────────────────────
export type SheetSizeKey = '1000x2000' | '1250x2500' | '1500x3000'

export interface SheetDimension {
  width: number
  height: number
  label: string
}

export const SHEET_SIZES: Record<SheetSizeKey, SheetDimension> = {
  '1000x2000': { width: 1000, height: 2000, label: '1000 × 2000 mm' },
  '1250x2500': { width: 1250, height: 2500, label: '1250 × 2500 mm' },
  '1500x3000': { width: 1500, height: 3000, label: '1500 × 3000 mm' },
}

// ─── Settings ────────────────────────────────────────────────
export interface NestingSettings {
  /** Gap between part edge and sheet edge (mm) */
  edgeGap: number
  /** Minimum gap between two parts (mm) */
  partGap: number
  /** Cutting kerf – material removed by the cutting tool (mm) */
  kerf: number
  sheetSize: SheetSizeKey
  /** How many rotation steps: 1=none, 2=180°, 4=90° steps, 8=45° steps */
  rotationSteps: number
  /** GA population size */
  populationSize: number
  /** GA generations */
  generations: number
  /** GA mutation rate 0-1 */
  mutationRate: number
}

export const DEFAULT_SETTINGS: NestingSettings = {
  edgeGap: 5,
  partGap: 3,
  kerf: 2,
  sheetSize: '1000x2000',
  rotationSteps: 4,
  populationSize: 6,
  generations: 8,
  mutationRate: 0.1,
}

// ─── Nesting Result ───────────────────────────────────────────
export interface PlacedPart {
  uid: string          // unique placement id
  partId: string
  name: string
  /** Outer contour in sheet coordinates (already transformed) */
  polygon: Polygon
  /** Inner contours (holes) in sheet coordinates */
  holes?: Polygon[]
  /** Bounding-box position in sheet coords */
  x: number
  y: number
  rotation: number
  sheetIndex: number
  color: string
}

export interface SheetResult {
  sheetIndex: number
  sheetWidth: number
  sheetHeight: number
  placements: PlacedPart[]
  usedArea: number      // sum of part areas  (mm²)
  sheetArea: number     // total sheet area   (mm²)
  efficiency: number    // 0-100 %
}

export interface NestingResult {
  sheetResults: SheetResult[]
  totalSheets: number
  totalParts: number
  placedCount: number
  unplaced: Array<{ partId: string; name: string; remaining: number }>
  overallEfficiency: number
  settings: NestingSettings
  processingTime: number   // ms
  timestamp: string
}

// ─── Worker messages ──────────────────────────────────────────
export interface WorkerInput {
  parts: Part[]
  settings: NestingSettings
}

export interface WorkerProgress {
  type: 'progress'
  generation: number
  totalGenerations: number
  bestEfficiency: number
  status: string
}

export interface WorkerResult {
  type: 'result'
  result: NestingResult
}

export interface WorkerError {
  type: 'error'
  message: string
}

export type WorkerMessage = WorkerProgress | WorkerResult | WorkerError
