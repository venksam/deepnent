/**
 * SVG Parser – extracts polygons from uploaded SVG files.
 */

import type { Polygon } from '../types'
import { normalizePolygon, polygonArea } from '../algorithms/geometry'

export interface ParsedShape {
  name: string
  polygon: Polygon
  area: number
}

// ── Parse an SVG file ─────────────────────────────────────────

export function parseSVGFile(svgText: string, fileName: string): ParsedShape[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgText, 'image/svg+xml')
  const shapes: ParsedShape[] = []
  const baseName = fileName.replace(/\.[^.]+$/, '')

  const svgElem = doc.querySelector('svg')
  const viewBox = svgElem?.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
  const svgWidth = viewBox ? viewBox[2] : parseFloat(svgElem?.getAttribute('width') ?? '1000')
  const svgHeight = viewBox ? viewBox[3] : parseFloat(svgElem?.getAttribute('height') ?? '1000')
  void svgHeight

  let idx = 0

  const extractPoints = (elem: Element): Polygon | null => {
    const tag = elem.tagName.toLowerCase()

    if (tag === 'rect') {
      const x = parseFloat(elem.getAttribute('x') ?? '0')
      const y = parseFloat(elem.getAttribute('y') ?? '0')
      const w = parseFloat(elem.getAttribute('width') ?? '0')
      const h = parseFloat(elem.getAttribute('height') ?? '0')
      if (w <= 0 || h <= 0) return null
      return [
        { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
      ]
    }

    if (tag === 'circle') {
      const cx = parseFloat(elem.getAttribute('cx') ?? '0')
      const cy = parseFloat(elem.getAttribute('cy') ?? '0')
      const r = parseFloat(elem.getAttribute('r') ?? '0')
      if (r <= 0) return null
      const pts: Polygon = []
      const segs = 32
      for (let i = 0; i < segs; i++) {
        const a = (2 * Math.PI * i) / segs
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
      }
      return pts
    }

    if (tag === 'ellipse') {
      const cx = parseFloat(elem.getAttribute('cx') ?? '0')
      const cy = parseFloat(elem.getAttribute('cy') ?? '0')
      const rx = parseFloat(elem.getAttribute('rx') ?? '0')
      const ry = parseFloat(elem.getAttribute('ry') ?? '0')
      if (rx <= 0 || ry <= 0) return null
      const pts: Polygon = []
      const segs = 32
      for (let i = 0; i < segs; i++) {
        const a = (2 * Math.PI * i) / segs
        pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) })
      }
      return pts
    }

    if (tag === 'polygon' || tag === 'polyline') {
      const raw = elem.getAttribute('points') ?? ''
      return parsePointsAttr(raw)
    }

    if (tag === 'path') {
      const d = elem.getAttribute('d') ?? ''
      return pathToPolygon(d)
    }

    return null
  }

  const allShapes = doc.querySelectorAll('rect,circle,ellipse,polygon,polyline,path')
  allShapes.forEach(elem => {
    const pts = extractPoints(elem)
    if (!pts || pts.length < 3) return
    const norm = normalizePolygon(pts)
    // Scale to mm if viewBox is much larger than 1000
    const scale = svgWidth > 2000 ? 1000 / svgWidth : 1
    const scaled = scale !== 1 ? norm.map(p => ({ x: p.x * scale, y: p.y * scale })) : norm
    const area = polygonArea(scaled)
    if (area < 1) return   // ignore tiny shapes
    const id = elem.id || `${baseName}-shape-${++idx}`
    shapes.push({ name: id, polygon: scaled, area })
  })

  return shapes
}

// ── Point-string parser ───────────────────────────────────────

function parsePointsAttr(raw: string): Polygon {
  const nums = raw.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n))
  const pts: Polygon = []
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] })
  }
  return pts
}

// ── Very simplified SVG path → polygon ───────────────────────

function pathToPolygon(d: string): Polygon {
  const pts: Polygon = []
  const tokens = d.trim().split(/(?=[MmLlHhVvCcSsQqTtAaZz])/)

  let cx = 0, cy = 0

  for (const token of tokens) {
    if (!token.trim()) continue
    const cmd = token[0]
    const nums = token.slice(1).trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n))

    switch (cmd) {
      case 'M':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cx = nums[i]; cy = nums[i + 1]
          pts.push({ x: cx, y: cy })
        }
        break
      case 'm':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cx += nums[i]; cy += nums[i + 1]
          pts.push({ x: cx, y: cy })
        }
        break
      case 'L':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cx = nums[i]; cy = nums[i + 1]
          pts.push({ x: cx, y: cy })
        }
        break
      case 'l':
        for (let i = 0; i + 1 < nums.length; i += 2) {
          cx += nums[i]; cy += nums[i + 1]
          pts.push({ x: cx, y: cy })
        }
        break
      case 'H':
        nums.forEach(n => { cx = n; pts.push({ x: cx, y: cy }) })
        break
      case 'h':
        nums.forEach(n => { cx += n; pts.push({ x: cx, y: cy }) })
        break
      case 'V':
        nums.forEach(n => { cy = n; pts.push({ x: cx, y: cy }) })
        break
      case 'v':
        nums.forEach(n => { cy += n; pts.push({ x: cx, y: cy }) })
        break
      case 'C':
        for (let i = 0; i + 5 < nums.length; i += 6) {
          // Just take end point of cubic bezier
          cx = nums[i + 4]; cy = nums[i + 5]
          pts.push({ x: cx, y: cy })
        }
        break
      case 'c':
        for (let i = 0; i + 5 < nums.length; i += 6) {
          cx += nums[i + 4]; cy += nums[i + 5]
          pts.push({ x: cx, y: cy })
        }
        break
    }
  }

  return pts
}

// ── Create rectangle part ─────────────────────────────────────

export function createRectPart(width: number, height: number): Polygon {
  return normalizePolygon([
    { x: 0, y: 0 }, { x: width, y: 0 },
    { x: width, y: height }, { x: 0, y: height },
  ])
}

// ── Create regular polygon ────────────────────────────────────

export function createRegularPolygon(sides: number, radius: number): Polygon {
  const pts: Polygon = []
  for (let i = 0; i < sides; i++) {
    const a = (2 * Math.PI * i) / sides - Math.PI / 2
    pts.push({ x: radius + radius * Math.cos(a), y: radius + radius * Math.sin(a) })
  }
  return normalizePolygon(pts)
}

// ── Create L-shape ─────────────────────────────────────────────

export function createLShape(w: number, h: number, cutW: number, cutH: number): Polygon {
  return normalizePolygon([
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h - cutH },
    { x: w - cutW, y: h - cutH },
    { x: w - cutW, y: h },
    { x: 0, y: h },
  ])
}
