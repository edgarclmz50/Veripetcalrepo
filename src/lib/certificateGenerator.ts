import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { CalibrationData, Measurement } from '../types';
import { formatDate } from './utils';

export async function generateDraftCertificate(data: CalibrationData) {
  const doc = new jsPDF();
  const primaryColor = '#141414';
  const accentColor = '#3B82F6';

  // --- HEADER ---
  doc.setFillColor(20, 20, 20);
  doc.rect(10, 10, 40, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(10);
  doc.text('METROLOGY', 15, 20);
  
  doc.setTextColor(primaryColor);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('INFORME DE CALIBRACIÓN', 60, 22);
  
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 100);
  doc.text(`ID Seguimiento: ${data.id}`, 60, 28);
  doc.text(`Fecha Generación: ${formatDate(Date.now())}`, 60, 32);

  const metadata = data.metadata as any;
  let y = 45;

  // --- CLIENT & INSTRUMENT INFO (Two Columns) ---
  autoTable(doc, {
    startY: y,
    head: [['INFORMACIÓN DEL CLIENTE', 'DATOS DEL INSTRUMENTO']],
    body: [[
      `Cliente: ${data.clientName}\nUbicación: ${metadata?.location || 'Planta Cliente'}\nSolicitud: ${data.workOrderId || 'N/A'}`,
      `Tag: ${data.instrumentTag}\nDesc: ${data.instrumentDescription}\nLugar Cal: ${metadata?.locationType || 'In Situ'}\nRango Nominal: ${(metadata)?.nominalRangeMin || 0} a ${(metadata)?.nominalRangeMax || 0}\nRango Cal: ${(metadata)?.calibrationRangeMin || 0} a ${(metadata)?.calibrationRangeMax || 0}\nNorma: ${(metadata)?.normaClase === 'ASME_B40_100' ? 'ASME B40.100 (FS)' : 'EN 837-1 (Span)'}\nRes: ${metadata?.resolution}\nClase: ${metadata?.accuracyClass}%`
    ]],
    theme: 'plain',
    headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold' },
    styles: { fontSize: 8, cellPadding: 4 }
  });

  y = (doc as any).lastAutoTable.finalY + 10;

  // --- CONDITIONS & STANDARDS ---
  const standardIds = metadata?.referenceStandardIds || [metadata?.referenceStandardId || 'NO ESPECIFICADO'];
  const inspection = metadata?.inspection;
  const inspectionSummary = inspection ? 
    `Estado: ${inspection.equipmentStatus || 'S/E'} | Limpieza: ${inspection.cleaning ? 'OK' : '--'} \nHermeticidad: ${inspection.leakTest?.performed ? `OK (${inspection.leakTest.duration} min)` : '--'} | Precarga: ${inspection.precharge?.performed ? `${inspection.precharge.cycles} ciclos` : '--'}\nComponentes: ${Object.entries(inspection.components || {}).filter(([_, v]) => v !== 'OK').map(([k, v]) => `${k}:${v}`).join(', ') || 'Todos OK'}` : 
    'No especificada';

  const auxInfo = [
    metadata?.thermohygrometerId ? `Monitor Amb: ${metadata.thermohygrometerId}` : null,
    metadata?.pressureGeneratorId ? `Generador: ${metadata.pressureGeneratorId}` : null,
    `Insp: ${inspectionSummary}`
  ].filter(Boolean).join('\n');

  autoTable(doc, {
    startY: y,
    head: [['CONDICIONES AMBIENTALES', 'EQUIPOS PATRÓN']],
    body: [[
      `Temperatura: ${metadata?.ambientTemp || '--'} °C\nHumedad: ${metadata?.humidity || '--'} %\nPresión Atm: ${metadata?.pressureAtmHpa || '--'} hPa\nGravedad: ${metadata?.gravity || '9.77'} m/s²`,
      `Patrones: ${standardIds.join(', ')}\n${auxInfo}\nFluido: ${metadata?.fluid || 'Aire'}`
    ]],
    theme: 'plain',
    headStyles: { fillColor: [240, 240, 240], textColor: [20, 20, 20], fontStyle: 'bold' },
    styles: { fontSize: 9, cellPadding: 5 }
  });

  y = (doc as any).lastAutoTable.finalY + 15;

  // --- RESULTS TABLE ---
  doc.setFontSize(11);
  doc.setTextColor(primaryColor);
  doc.text('RESULTADOS DE MEDICIÓN (DKD-R 6-1)', 15, y);
  y += 5;

  const nominalPoints = Array.from(new Set(data.measurements.map(m => m.nominalValue))).sort((a,b) => a-b);
  const tableRows = nominalPoints.map(nominal => {
    const asc = data.measurements.filter(m => m.nominalValue === nominal && m.direction === 'ascending')[0];
    const desc = data.measurements.filter(m => m.nominalValue === nominal && m.direction === 'descending')[0];
    
    if (!asc) {
      return [
        nominal.toFixed(2),
        '--',
        desc ? Number(desc.instrumentValue).toFixed(2) : '--',
        '--',
        '--',
        '--',
        '--'
      ];
    }

    const ascVal = Number(asc.instrumentValue);
    const descVal = desc ? Number(desc.instrumentValue) : null;
    
    const avg = descVal !== null ? (ascVal + descVal) / 2 : ascVal;
    const error = avg - nominal;
    const hist = descVal !== null ? Math.abs(ascVal - descVal) : 0;
    
    return [
      nominal.toFixed(2),
      ascVal.toFixed(2),
      descVal !== null ? descVal.toFixed(2) : '--',
      avg.toFixed(3),
      error.toFixed(4),
      hist.toFixed(4),
      data.uncertaintyResults ? `± ${data.uncertaintyResults.expanded.toFixed(4)}` : '--'
    ];
  });

  autoTable(doc, {
    startY: y,
    head: [['Nominal', 'Ascendente', 'Descendente', 'Promedio', 'Error', 'Hister.', 'U. Exp']],
    body: tableRows,
    headStyles: { fillColor: [20, 20, 20], textColor: [255, 255, 255], fontSize: 8, halign: 'center' },
    styles: { halign: 'center', fontSize: 8 },
    alternateRowStyles: { fillColor: [250, 250, 250] }
  });

  y = (doc as any).lastAutoTable.finalY + 20;

  // --- SIGNATURES ---
  if (y > 250) {
    doc.addPage();
    y = 30;
  }

  doc.setDrawColor(200);
  doc.line(20, y, 90, y);
  doc.line(120, y, 190, y);
  
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text('FIRMA DEL TÉCNICO', 40, y + 5);
  doc.text('VALIDACIÓN METROLÓGICA', 140, y + 5);

  doc.setTextColor(180);
  doc.setFontSize(7);
  doc.text('Este documento es un BORRADOR DE CAMPO generado automáticamente por el sistema de gestión de activos.', 15, 285);
  doc.text('Prohibida su reproducción parcial o total sin autorización.', 15, 288);

  return doc;
}
