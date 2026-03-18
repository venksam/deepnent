/**
 * Report Generator – creates a PDF summary report using jsPDF.
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { NestingResult } from '../types'
import { SHEET_SIZES } from '../types'

export function generatePDFReport(result: NestingResult, svgDataUrls: string[]): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const sheet = SHEET_SIZES[result.settings.sheetSize]
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 15

  // ── Cover page ────────────────────────────────────────────
  doc.setFillColor(30, 64, 175)
  doc.rect(0, 0, pageW, 40, 'F')

  doc.setTextColor(255, 255, 255)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text('DeepNest Web', margin, 18)
  doc.setFontSize(12)
  doc.setFont('helvetica', 'normal')
  doc.text('Sheet Nesting Optimization Report', margin, 28)

  doc.setTextColor(100, 100, 100)
  doc.setFontSize(9)
  doc.text(`Generated: ${new Date(result.timestamp).toLocaleString()}`, margin, 46)
  doc.text(`Processing Time: ${result.processingTime} ms`, margin, 52)

  // ── Summary box ───────────────────────────────────────────
  let y = 62

  doc.setFillColor(241, 245, 249)
  doc.roundedRect(margin, y, pageW - 2 * margin, 50, 3, 3, 'F')

  doc.setTextColor(30, 41, 59)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Summary', margin + 5, y + 8)

  const summaryData = [
    ['Sheet Size', sheet.label],
    ['Total Sheets Used', String(result.totalSheets)],
    ['Total Parts', String(result.totalParts)],
    ['Parts Placed', String(result.placedCount)],
    ['Parts Unplaced', String(result.totalParts - result.placedCount)],
    ['Overall Efficiency', `${result.overallEfficiency.toFixed(1)} %`],
    ['Edge Gap', `${result.settings.edgeGap} mm`],
    ['Part Gap', `${result.settings.partGap} mm`],
    ['Kerf', `${result.settings.kerf} mm`],
  ]

  autoTable(doc, {
    startY: y + 12,
    head: [],
    body: summaryData,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 55 },
      1: { cellWidth: 55 },
    },
    margin: { left: margin + 5, right: margin + 5 },
  })

  y = (doc as any).lastAutoTable.finalY + 10

  // ── Per-sheet summary table ───────────────────────────────

  doc.setTextColor(30, 41, 59)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Per-Sheet Breakdown', margin, y)
  y += 4

  const sheetRows = result.sheetResults.map(s => [
    `Sheet ${s.sheetIndex + 1}`,
    `${s.sheetWidth} × ${s.sheetHeight} mm`,
    String(s.placements.length),
    `${(s.usedArea / 100).toFixed(0)} cm²`,
    `${s.efficiency.toFixed(1)} %`,
  ])

  autoTable(doc, {
    startY: y,
    head: [['Sheet', 'Size', 'Parts', 'Used Area', 'Efficiency']],
    body: sheetRows,
    theme: 'striped',
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    margin: { left: margin, right: margin },
  })

  y = (doc as any).lastAutoTable.finalY + 10

  // ── Parts list ────────────────────────────────────────────

  if (y > pageH - 60) { doc.addPage(); y = margin }

  doc.setTextColor(30, 41, 59)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text('Parts List', margin, y)
  y += 4

  // Build unique parts from all placements
  const partMap = new Map<string, { name: string; count: number }>()
  for (const s of result.sheetResults) {
    for (const p of s.placements) {
      const entry = partMap.get(p.partId) ?? { name: p.name, count: 0 }
      entry.count++
      partMap.set(p.partId, entry)
    }
  }

  const partsRows = Array.from(partMap.values()).map(v => [v.name, String(v.count), 'Placed'])
  if (result.unplaced.length > 0) {
    result.unplaced.forEach(u => partsRows.push([u.name, String(u.remaining), 'UNPLACED']))
  }

  autoTable(doc, {
    startY: y,
    head: [['Part Name', 'Qty', 'Status']],
    body: partsRows,
    theme: 'striped',
    headStyles: { fillColor: [30, 64, 175], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 9 },
    margin: { left: margin, right: margin },
  })

  y = (doc as any).lastAutoTable.finalY + 10

  // ── Sheet drawings ────────────────────────────────────────

  for (let i = 0; i < svgDataUrls.length; i++) {
    if (i > 0 || y > pageH - 80) {
      doc.addPage()
      y = margin
    }

    doc.setTextColor(30, 41, 59)
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text(`Sheet ${i + 1} Layout`, margin, y)
    y += 4

    const imgW = pageW - 2 * margin
    // Maintain aspect ratio of sheet
    const sheetRatio = result.sheetResults[i]?.sheetHeight / result.sheetResults[i]?.sheetWidth || 2
    const imgH = Math.min(imgW * sheetRatio, pageH - y - 20)

    try {
      doc.addImage(svgDataUrls[i], 'PNG', margin, y, imgW, imgH)
    } catch {
      doc.setFontSize(8)
      doc.setTextColor(150, 150, 150)
      doc.text('[Sheet image unavailable]', margin + 5, y + 10)
    }
    y += imgH + 10
  }

  // ── Settings appendix ─────────────────────────────────────

  doc.addPage()
  y = margin
  doc.setTextColor(30, 64, 175)
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text('Nesting Settings Used', margin, y)
  y += 8

  const settingsRows = [
    ['Sheet Size', sheet.label],
    ['Edge Gap', `${result.settings.edgeGap} mm`],
    ['Part Gap', `${result.settings.partGap} mm`],
    ['Kerf', `${result.settings.kerf} mm`],
    ['Rotation Steps', String(result.settings.rotationSteps)],
    ['GA Population', String(result.settings.populationSize)],
    ['GA Generations', String(result.settings.generations)],
    ['Mutation Rate', `${(result.settings.mutationRate * 100).toFixed(0)} %`],
  ]

  autoTable(doc, {
    startY: y,
    head: [['Setting', 'Value']],
    body: settingsRows,
    theme: 'striped',
    headStyles: { fillColor: [30, 64, 175], textColor: 255 },
    margin: { left: margin, right: margin },
  })

  doc.save(`nesting-report-${Date.now()}.pdf`)
}

// ── Export sheet as PNG data URL ──────────────────────────────

export async function sheetToDataUrl(svgElement: SVGSVGElement): Promise<string> {
  const canvas = document.createElement('canvas')
  const svgStr = new XMLSerializer().serializeToString(svgElement)
  const blob = new Blob([svgStr], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(blob)

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = url
  })
}
