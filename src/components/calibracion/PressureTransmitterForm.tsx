import React, { useState, useEffect } from 'react';
import { CalibrationData, Measurement, CalibrationMetadata, CalibrationStatus, LogEntry, UncertaintyResults } from '../../types';
import { 
  LineChart, 
  ComposedChart,
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  ReferenceLine,
  AreaChart,
  Area,
  ErrorBar
} from 'recharts';
import { Save, Plus, Trash2, Calculator, History, Clock, User, FileText, RefreshCw, Zap, Settings2, Wind, Thermometer, Droplets, MapPin, Ruler, AlertCircle, Send, ShieldCheck, CheckCircle2, Activity, ArrowBigUpDash, XCircle, ArrowLeft } from 'lucide-react';
import { db } from '../../lib/db';
import { cn } from '../../lib/utils';
import { getAuthUser } from '../../lib/auth';
import { syncService } from '../../lib/SyncService';
import { PressureCalibrator, generarPuntosCalibracion, determinarSecuencia, AireCIPM } from '../../services/calibrationLogic';
import { generateDraftCertificate } from '../../lib/certificateGenerator';

interface PressureTransmitterFormProps {
  initialData?: Partial<CalibrationData>;
  onCancel: () => void;
  onSuccess: () => void;
}

const STATUS_INFO: Record<CalibrationStatus, { label: string, description: string, color: string }> = {
  [CalibrationStatus.DRAFT]: {
    label: 'Borrador',
    description: 'Es el estado inicial. Se usa mientras el técnico está realizando las pruebas en sitio. Permite guardar cambios parciales incluso si faltan datos.',
    color: 'bg-gray-100 text-gray-600 border-gray-200'
  },
  [CalibrationStatus.PRELIMINARY]: {
    label: 'Preliminar',
    description: 'Indica que la toma de datos terminó. El sistema ya calculó errores e incertidumbres. Es el estado en que los revisores técnicos comienzan su trabajo.',
    color: 'bg-blue-50 text-blue-700 border-blue-200'
  },
  [CalibrationStatus.IN_REVIEW]: {
    label: 'En Revisión',
    description: 'El registro está siendo auditado por el responsable del laboratorio. Si hay dudas, se mantiene aquí hasta aclararlas.',
    color: 'bg-amber-50 text-amber-700 border-amber-200'
  },
  [CalibrationStatus.PUBLISHED]: {
    label: 'Publicado',
    description: 'El certificado final ha sido generado y firmado. No admite más modificaciones.',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200'
  }
};

const parseNum = (val: any): number => {
  if (val === undefined || val === null || val === '') return NaN;
  if (typeof val === 'number') return val;
  // Handle both dot and comma
  return parseFloat(val.toString().replace(',', '.'));
};

export function PressureTransmitterForm({ initialData, onCancel, onSuccess }: PressureTransmitterFormProps) {
  const user = getAuthUser();
  const [data, setData] = useState<Partial<CalibrationData>>({
    clientName: initialData?.clientName || '',
    instrumentTag: initialData?.instrumentTag || '',
    instrumentDescription: initialData?.instrumentDescription || '',
    workOrderId: initialData?.workOrderId || (initialData?.metadata as any)?.workOrderId || '',
    instrumentId: initialData?.instrumentId || '',
    magnitude: 'pressure_transmitter',
    calibrationDate: initialData?.calibrationDate || Date.now(),
    metadata: {
      rangeMin: (initialData?.metadata as any)?.rangeMin ?? 0,
      rangeMax: (initialData?.metadata as any)?.rangeMax ?? 100,
      nominalRangeMin: (initialData?.metadata as any)?.nominalRangeMin ?? (initialData?.metadata as any)?.rangeMin ?? 0,
      nominalRangeMax: (initialData?.metadata as any)?.nominalRangeMax ?? (initialData?.metadata as any)?.rangeMax ?? 100,
      calibrationRangeMin: (initialData?.metadata as any)?.calibrationRangeMin ?? (initialData?.metadata as any)?.rangeMin ?? 0,
      calibrationRangeMax: (initialData?.metadata as any)?.calibrationRangeMax ?? (initialData?.metadata as any)?.rangeMax ?? 100,
      
      // Transmitter specific
      outputRangeMin: (initialData?.metadata as any)?.outputRangeMin ?? 4,
      outputRangeMax: (initialData?.metadata as any)?.outputRangeMax ?? 20,
      outputUnit: (initialData?.metadata as any)?.outputUnit || 'mA',
      multimeterId: (initialData?.metadata as any)?.multimeterId || '',
      
      normaClase: (initialData?.metadata as any)?.normaClase || 'ASME_B40_100',
      locationType: (initialData?.metadata as any)?.locationType || 'IN_SITU',
      inspection: (initialData?.metadata as any)?.inspection || {
        cleaning: false,
        zeroAdjust: false,
        leakTest: { performed: false, duration: '', reference: '' },
        precharge: { performed: false, cycles: 0 },
        visualCheck: 'good',
        equipmentStatus: 'SERVICE',
        components: {
          thread: 'OK',
          dial: 'OK',
          casing: 'OK',
          glass: 'OK',
          needle: 'OK'
        },
        notes: ''
      },
      resolution: (initialData?.metadata as any)?.resolution || 0.001,
      accuracyClass: (initialData?.metadata as any)?.accuracyClass || '0.5',
      subcategory: (initialData?.metadata as any)?.subcategory || 'digital_transmitter',
      methodology: (initialData?.metadata as any)?.methodology || 'digital',
      ambientTemp: (initialData?.metadata as any)?.ambientTemp || 20,
      humidity: (initialData?.metadata as any)?.humidity || 50,
      pressureAtmHpa: (initialData?.metadata as any)?.pressureAtmHpa || 1013.25,
      gravity: (initialData?.metadata as any)?.gravity || 9.77,
      fluid: (initialData?.metadata as any)?.fluid || 'Aire',
      uncertaintyMethod: (initialData?.metadata as any)?.uncertaintyMethod || 'GUM',
      norm: (initialData?.metadata as any)?.norm || 'DKD-R 6-1',
      unit: (initialData?.metadata as any)?.unit || 'psi',
      heightPatternMm: (initialData?.metadata as any)?.heightPatternMm || 0,
      heightInstrumentMm: (initialData?.metadata as any)?.heightInstrumentMm || 0,
      instrumentType: (initialData?.metadata as any)?.instrumentType || 'TRANSMISOR DE PRESIÓN',
      location: (initialData?.metadata as any)?.location || '',
      size: (initialData?.metadata as any)?.size || '',
      prevCertificate: (initialData?.metadata as any)?.prevCertificate || '',
      mountingDependent: (initialData?.metadata as any)?.mountingDependent || false,
    },
    measurements: []
  });

  const [standards, setStandards] = useState<any[]>([]);
  const [selectedStandardIds, setSelectedStandardIds] = useState<string[]>(
    (initialData?.metadata as any)?.referenceStandardIds || [initialData?.metadata?.referenceStandardId || '']
  );
  const [auxEquipment, setAuxEquipment] = useState({
    thermohygrometerId: (initialData?.metadata as any)?.thermohygrometerId || '',
    barometerId: (initialData?.metadata as any)?.barometerId || '',
    pressureGeneratorId: (initialData?.metadata as any)?.pressureGeneratorId || ''
  });

  useEffect(() => {
    const seedStandards = async () => {
      const samples = [
        // PATRONES DE PRESIÓN (MANÓMETROS/CALIBRADORES)
        { id: 'PAT-001', alias: 'Balanza Pesos Muertos DWT-600', tipo: 'manometro', rangeMin: 0, rangeMax: 600, accuracyClass: '0.015', unidad: 'psi', brand: 'Fluke', model: 'P3124' },
        { id: 'PAT-002', alias: 'Calibrador Maestro 10K', tipo: 'manometro', rangeMin: 0, rangeMax: 10000, accuracyClass: '0.05', unidad: 'psi', brand: 'Additel', model: 'AD928' },
        { id: 'PAT-003', alias: 'Manómetro Patrón Proceso', tipo: 'manometro', rangeMin: 0, rangeMax: 300, accuracyClass: '0.1', unidad: 'psi', brand: 'Wika', model: 'CPG1500' },
        { id: 'PAT-004', alias: 'Módulo Baja Presión 30', tipo: 'manometro', rangeMin: 0, rangeMax: 30, accuracyClass: '0.05', unidad: 'psi', brand: 'Druck', model: 'DPI620' },
        { id: 'PAT-005', alias: 'Sensor Inteligente Multirango (XP2i)', tipo: 'manometro', rangeMin: 0, rangeMax: 10000, accuracyClass: '0.02', unidad: 'psi', brand: 'Crystal', model: 'XP2i' },
        { id: 'PAT-006', alias: 'Controlador Automático 6270A', tipo: 'manometro', rangeMin: 0, rangeMax: 3000, accuracyClass: '0.01', unidad: 'psi', brand: 'Fluke', model: '6270A' },
        { id: 'PAT-007', alias: 'Manómetro Digital Ref (1000 psi)', tipo: 'manometro', rangeMin: 0, rangeMax: 1000, accuracyClass: '0.02', unidad: 'psi', brand: 'Additel', model: 'ADT681' },
        
        // MULTÍMETROS / LECTORES DIGITALES (SOLICITADOS POR USUARIO)
        { id: 'ELE-001', alias: 'Multímetro Fluke 289 (Precisión)', tipo: 'multimetro', accuracyClass: '0.025', unit: 'mA', brand: 'Fluke', model: '289' },
        { id: 'ELE-002', alias: 'Procesador Documentador Fluke 754', tipo: 'multimetro', accuracyClass: '0.01', unit: 'mA', brand: 'Fluke', model: '754' },
        { id: 'ELE-003', alias: 'Lector Digital mA/V Beamex MC6', tipo: 'multimetro', accuracyClass: '0.005', unit: 'mA', brand: 'Beamex', model: 'MC6' },

        // EQUIPO AUXILIAR
        { id: 'AUX-001', alias: 'Termohigrómetro Ref (Vaisala)', tipo: 'termo', accuracyClass: '0.5', unit: '°C/%RH', brand: 'Vaisala', model: 'HM40' },
        { id: 'AUX-002', alias: 'Barómetro Precisión (Setra)', tipo: 'barometro', accuracyClass: '0.01', unit: 'hPa', brand: 'Setra', model: '270' },
        
        // GENERADORES DE PRESIÓN
        { id: 'GEN-001', alias: 'Bomba Neumática Precisión -14/600 psi', tipo: 'generador', brand: 'Additel', model: '916' },
        { id: 'GEN-002', alias: 'Bomba Hidráulica 15,000 psi', tipo: 'generador', brand: 'Additel', model: '937' },
        { id: 'GEN-003', alias: 'Comparador de Pesos Muertos Hidráulico', tipo: 'generador', brand: 'Ashcroft', model: '1305D' }
      ];

      for (const s of samples) {
        await db.standards.put(s);
      }

      const allStandards = await db.standards.toArray();
      setStandards(allStandards);
    };
    seedStandards();
  }, []);

  const [notes, setNotes] = useState(initialData?.notes || '');
  const [status, setStatus] = useState<CalibrationStatus>(initialData?.status || CalibrationStatus.DRAFT);
  const [uncertainty, setUncertainty] = useState<UncertaintyResults | undefined>(initialData?.uncertaintyResults);
  const [pointResults, setPointResults] = useState<any[]>([]);
  useEffect(() => {
    if (initialData?.measurements && initialData.measurements.length > 0) {
      // Small delay to ensure all state is settled before running calculations
      const timer = setTimeout(() => {
        runCalculations();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const loadExampleData = () => {
    // Fill configuration
    setData({
      ...data,
      metadata: {
        ...data.metadata!,
        accuracyClass: "0.1",
        rangeMin: 0,
        rangeMax: 100,
        unit: 'psi',
        nominalRangeMin: 0,
        nominalRangeMax: 100,
        calibrationRangeMin: 0,
        calibrationRangeMax: 100,
        outputUnit: 'mA',
        outputRangeMin: 4,
        outputRangeMax: 20,
        resolution: 0.0001,
        uncertaintyMethod: 'gum',
        norm: 'DKD-R 6-1',
        mountingDependent: false,
        ambientTemp: 22.5,
        humidity: 45,
        pressureAtmHpa: 1013.25,
        gravity: 9.77,
        heightPatternMm: 0,
        heightInstrumentMm: 0,
        multimeterId: standards.find(s => s.tipo === 'multimetro')?.id || 'DEMO-MM-01',
      } as any
    });

    // Fill points with realistic mA readings for 0-100 psi -> 4-20 mA
    const examplePoints = [
      { nominalValue: 0, standardValue: "0.00", instrumentValue: "4.002", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      { nominalValue: 25, standardValue: "25.01", instrumentValue: "8.005", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      { nominalValue: 50, standardValue: "50.00", instrumentValue: "12.008", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      { nominalValue: 75, standardValue: "75.02", instrumentValue: "16.012", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      { nominalValue: 100, standardValue: "100.00", instrumentValue: "20.015", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      
      { nominalValue: 100, standardValue: "100.00", instrumentValue: "20.012", series: "M2", direction: "descending" as const, timestamp: Date.now() },
      { nominalValue: 75, standardValue: "75.01", instrumentValue: "16.009", series: "M2", direction: "descending" as const, timestamp: Date.now() },
      { nominalValue: 50, standardValue: "50.02", instrumentValue: "12.005", series: "M2", direction: "descending" as const, timestamp: Date.now() },
      { nominalValue: 25, standardValue: "25.00", instrumentValue: "8.002", series: "M2", direction: "descending" as const, timestamp: Date.now() },
      { nominalValue: 0, standardValue: "0.00", instrumentValue: "3.998", series: "M2", direction: "descending" as const, timestamp: Date.now() },
    ];
    setPoints(examplePoints);
    setTimeout(() => runCalculations(), 500);
  };
  const [isCalculating, setIsCalculating] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(120);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(initialData?.updatedAt || null);

  const calculateIdealOutput = (pressureIn: number) => {
    const m = data.metadata as any;
    const pMin = (m.calibrationRangeMin !== undefined && m.calibrationRangeMin !== null && m.calibrationRangeMin !== '') ? parseNum(m.calibrationRangeMin) : (parseNum(m.nominalRangeMin) || 0);
    const pMax = (m.calibrationRangeMax !== undefined && m.calibrationRangeMax !== null && m.calibrationRangeMax !== '') ? parseNum(m.calibrationRangeMax) : (parseNum(m.nominalRangeMax) || 100);
    
    // Fix: Using correct property names outputRangeMin/Max
    const outMin = (m.outputRangeMin !== undefined && m.outputRangeMin !== null) ? parseNum(m.outputRangeMin) : 4;
    const outMax = (m.outputRangeMax !== undefined && m.outputRangeMax !== null) ? parseNum(m.outputRangeMax) : 20;
    
    const span = pMax - pMin;
    if (Math.abs(span) < 1e-12) return outMin;
    
    const outSpan = outMax - outMin;
    const value = outMin + ((pressureIn - pMin) / span) * outSpan;
    return value;
  };

  const calculatePressureEquivalent = (electricalVal: number) => {
    const m = data.metadata as any;
    const pMin = (m.calibrationRangeMin !== undefined && m.calibrationRangeMin !== null && m.calibrationRangeMin !== '') ? parseNum(m.calibrationRangeMin) : (parseNum(m.nominalRangeMin) || 0);
    const pMax = (m.calibrationRangeMax !== undefined && m.calibrationRangeMax !== null && m.calibrationRangeMax !== '') ? parseNum(m.calibrationRangeMax) : (parseNum(m.nominalRangeMax) || 100);
    const outMin = (m.outputMin !== undefined && m.outputMin !== null) ? parseNum(m.outputMin) : 4;
    const outMax = (m.outputMax !== undefined && m.outputMax !== null) ? parseNum(m.outputMax) : 20;
    
    const outSpan = outMax - outMin;
    if (Math.abs(outSpan) < 1e-12) return pMin;
    return pMin + ((pMax - pMin) * (electricalVal - outMin) / outSpan);
  };

  const airProperties = React.useMemo(() => {
    const t = data.metadata?.ambientTemp || 20;
    const p = (data.metadata?.pressureAtmHpa || 1013.25) * 100;
    const hr = data.metadata?.humidity || 50;
    return {
      rho: AireCIPM.calcularDensidad(t, p, hr),
      uRho: AireCIPM.calcularIncertidumbre(t, p, hr)
    };
  }, [data.metadata?.ambientTemp, data.metadata?.pressureAtmHpa, data.metadata?.humidity]);

  useEffect(() => {
    let interval: any;
    if (isTimerRunning && timerSeconds > 0) {
      interval = setInterval(() => {
        setTimerSeconds(s => s - 1);
      }, 1000);
    } else if (timerSeconds === 0) {
      setIsTimerRunning(false);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning, timerSeconds]);

  const formatTimer = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const [points, setPoints] = useState<any[]>(
    initialData?.measurements && initialData.measurements.length > 0 
    ? initialData.measurements.map((p: any) => ({ ...p, standardValue: p.standardValue.toString(), instrumentValue: p.instrumentValue.toString() }))
    : []
  );
  const [isTableMaximized, setIsTableMaximized] = useState(false);

  // Sync measurements with points for calculations and persistence
  useEffect(() => {
    setData(prev => ({
      ...prev,
      measurements: points
    }));
  }, [points]);

  const calibrationInfo = React.useMemo(() => {
    const m = data.metadata as any;
    const accuracy = parseNum(m.accuracyClass || '0.5');
    const norm = m.norm || 'DKD-R 6-1';
    const seq = determinarSecuencia(isNaN(accuracy) ? 0.5 : accuracy, norm);
    
    // Ensure nominalValue is treated as number
    const uniqueNominals = Array.from(new Set(points.map(p => Number(p.nominalValue)))).sort((a: number, b: number) => a - b);
    const hasM3 = seq.ciclosAsc >= 2;
    const hasM4 = seq.ciclosDesc >= 2;
    const hasM5 = seq.ciclosAsc >= 3 || (seq.secuencia === 'A' && m.mountingDependent);
    const hasM6 = seq.ciclosDesc >= 3 || (seq.secuencia === 'A' && m.mountingDependent);
    const showCycle2 = hasM3 || hasM4;
    const showCycle3 = hasM5 || hasM6;
    const totalCols = 1 + 2 + (hasM3 ? 1 : 0) + (hasM4 ? 1 : 0) + (hasM5 ? 1 : 0) + (hasM6 ? 1 : 0);

    return { seq, uniqueNominals, hasM3, hasM4, hasM5, hasM6, showCycle2, showCycle3, totalCols };
  }, [points, data.metadata?.norm, data.metadata?.accuracyClass, data.metadata?.mountingDependent]);

  const updateStandardId = (index: number, value: string) => {
    const newIds = [...selectedStandardIds];
    newIds[index] = value;
    setSelectedStandardIds(newIds.filter((id, i) => id !== '' || i === 0).slice(0, 3));
  };

  const addStandardSelector = () => {
    if (selectedStandardIds.length < 3) {
      setSelectedStandardIds([...selectedStandardIds, '']);
    }
  };

  const clearPoints = () => {
    // Confirmation omitted to avoid blocking in some environments, or can be replaced with a UI state if needed
    // The user specifically complained it doesn't work, which often means the dialog is being blocked
    setPoints([]);
    setPointResults([]);
    setUncertainty(undefined);
  };

  const generatePoints = () => {
    const m = data.metadata as any;
    
    // Explicitly parse values and handle defaults
    const rMax = !isNaN(parseNum(m.calibrationRangeMax)) ? parseNum(m.calibrationRangeMax) : (!isNaN(parseNum(m.nominalRangeMax)) ? parseNum(m.nominalRangeMax) : 100);
    const rMin = !isNaN(parseNum(m.calibrationRangeMin)) ? parseNum(m.calibrationRangeMin) : (!isNaN(parseNum(m.nominalRangeMin)) ? parseNum(m.nominalRangeMin) : 0);
    
    console.log('Generating points for range:', rMin, 'to', rMax);

    const accuracyVal = parseNum(m.accuracyClass);
    const norm = m.norm || 'DKD-R 6-1';
    
    if (isNaN(accuracyVal)) {
      alert('Error: Debe definir la Clase de Exactitud en la Sección 2.');
      return;
    }

    if (isNaN(rMax) || isNaN(rMin) || rMax <= rMin) {
      alert('Error: Rango de calibración inválido.');
      return;
    }

    const seq = determinarSecuencia(accuracyVal, norm);
    const isMountingDep = m.mountingDependent;
    
    const nominals = generarPuntosCalibracion(accuracyVal, rMax, rMin, norm);
    if (!nominals || nominals.length === 0) {
      alert('Error: No se pudieron generar puntos.');
      return;
    }

    const newPoints: any[] = [];
    const outputUnit = m.outputUnit || 'mA';
    
    nominals.forEach(n => {
      newPoints.push({ series: 'M1', nominalValue: n, standardValue: n.toString(), instrumentValue: "", unit: outputUnit, direction: 'ascending' as const, timestamp: Date.now() });
    });
    if (seq.ciclosDesc >= 1) {
      [...nominals].reverse().forEach(n => {
        newPoints.push({ series: 'M2', nominalValue: n, standardValue: n.toString(), instrumentValue: "", unit: outputUnit, direction: 'descending' as const, timestamp: Date.now() });
      });
    }

    if (seq.ciclosAsc >= 2) {
      nominals.forEach(n => {
        newPoints.push({ series: 'M3', nominalValue: n, standardValue: n.toString(), instrumentValue: "", unit: outputUnit, direction: 'ascending' as const, timestamp: Date.now() });
      });
    }
    if (seq.ciclosDesc >= 2) {
      [...nominals].reverse().forEach(n => {
        newPoints.push({ series: 'M4', nominalValue: n, standardValue: n.toString(), instrumentValue: "", unit: outputUnit, direction: 'descending' as const, timestamp: Date.now() });
      });
    }

    if (seq.ciclosAsc >= 3 || (seq.secuencia === 'A' && isMountingDep)) {
      nominals.forEach(n => {
        newPoints.push({ series: 'M5', nominalValue: n, standardValue: n.toString(), instrumentValue: "", unit: outputUnit, direction: 'ascending' as const, timestamp: Date.now() });
      });
      [...nominals].reverse().forEach(n => {
        newPoints.push({ series: 'M6', nominalValue: n, standardValue: n.toString(), instrumentValue: "", unit: outputUnit, direction: 'descending' as const, timestamp: Date.now() });
      });
    }

    setPointResults([]);
    setUncertainty(undefined);
    setPoints(newPoints);
    
    setData(prev => ({
      ...prev,
      metadata: {
        ...prev.metadata!, 
        inspection: {
          ...(prev.metadata as any).inspection,
          precharge: { ...(prev.metadata as any).inspection.precharge, cycles: seq.precargas, performed: true }
        }
      } as any,
      measurements: newPoints,
      uncertaintyResults: undefined
    }));
  };

  const addPoint = () => {
    const m = data.metadata as any;
    const accuracy = parseNum(m.accuracyClass || '0.5');
    const norm = m.norm || 'DKD-R 6-1';
    const seq = determinarSecuencia(accuracy, norm);
    const outputUnit = m.outputUnit || 'mA';
    const isMountingDep = m.mountingDependent;
    
    const currentNominals = points.map(p => p.nominalValue);
    const maxNominal = currentNominals.length > 0 ? Math.max(...currentNominals) : 0;
    const rMax = m.calibrationRangeMax !== undefined ? m.calibrationRangeMax : m.rangeMax;
    const nextNominal = maxNominal < rMax ? Math.min(rMax, maxNominal + (rMax / (seq.minPuntos - 1 || 1))) : maxNominal + 1;

    const newPointsRow: any[] = [];
    let count = seq.ciclosAsc + seq.ciclosDesc;
    if (seq.secuencia === 'A' && isMountingDep && count < 6) count = 6;
    
    for (let i = 1; i <= count; i++) {
      const isAsc = i % 2 !== 0;
      const seriesName = `M${i}`;
      newPointsRow.push({
        nominalValue: nextNominal,
        standardValue: nextNominal.toString(),
        instrumentValue: "", 
        series: seriesName,
        unit: outputUnit,
        direction: isAsc ? 'ascending' : 'descending',
        timestamp: Date.now()
      });
    }
    
    setPoints([...points, ...newPointsRow]);
  };

  const updatePointValue = (nom: number, series: string, field: string, value: string) => {
    setPoints(prev => {
      const idx = prev.findIndex(p => Number(p.nominalValue) === Number(nom) && p.series === series);
      if (idx >= 0) {
        const newPoints = [...prev];
        newPoints[idx] = { ...newPoints[idx], [field]: value };
        return newPoints;
      } else {
        const isAsc = ['M1', 'M3', 'M5'].includes(series);
        return [...prev, {
          nominalValue: nom,
          standardValue: field === 'standardValue' ? value : nom.toString(),
          instrumentValue: field === 'instrumentValue' ? value : "",
          series,
          direction: isAsc ? 'ascending' : 'descending',
          timestamp: Date.now(),
          unit: (data.metadata as any).outputUnit || 'mA'
        }];
      }
    });
  };

  const updateNominalValue = (oldNominal: number, newNominal: number) => {
    setPoints(prev => prev.map(p => 
      Number(p.nominalValue) === Number(oldNominal) 
      ? { 
          ...p, 
          nominalValue: newNominal, 
          // Si el valor del patrón es igual al nominal anterior (con tolerancia), lo actualizamos también
          standardValue: Math.abs(Number(p.standardValue) - oldNominal) < 1e-10 ? newNominal.toString() : p.standardValue 
        } 
      : p
    ));
  };

  const removePoint = (index: number) => {
    setPoints(points.filter((_, i) => i !== index));
  };

  const updatePoint = (index: number, field: string, value: string) => {
    const newPoints = [...points];
    newPoints[index] = { ...newPoints[index], [field]: value };
    setPoints(newPoints);
  };

  const [errors, setErrors] = useState<string[]>([]);

  const validateForm = () => {
    const errs: string[] = [];
    const meta = data.metadata as any;

    // Sección 0: Identificación Principal
    if (!data.clientName?.trim()) errs.push('Identificación: El nombre del cliente es obligatorio.');
    if (!data.calibrationDate) errs.push('Identificación: La fecha de calibración es obligatoria.');
    if (!data.workOrderId?.trim()) errs.push('Identificación: El N° de Orden de Trabajo es obligatorio.');

    // Sección 1: Datos del Instrumento (IBC)
    if (!meta?.instrumentType) errs.push('Sección 1: Seleccione el Tipo de Instrumento.');
    if (!data.instrumentTag?.trim()) errs.push('Sección 1: El TAG / N° Serie es obligatorio.');
    if (!data.instrumentDescription?.trim()) errs.push('Sección 1: La Marca / Modelo es obligatoria.');
    if (!meta?.location?.trim()) errs.push('Sección 1: La Ubicación es obligatoria.');

    // Sección 2: Parámetros de Presión y Metodología
    const effectiveNorm = meta?.norm || 'DKD-R 6-1';
    const effectiveUnit = meta?.unit || 'psi';
    
    if (!effectiveNorm) errs.push('Sección 2: Seleccione la Norma de Referencia.');
    if (!effectiveUnit) errs.push('Sección 2: Seleccione la Unidad de Presión.');
    
    if (meta?.nominalRangeMin === undefined || meta?.nominalRangeMin === null || isNaN(meta?.nominalRangeMin)) 
      errs.push('Sección 2: Ingrese el Rango Nominal Mínimo.');
    if (meta?.nominalRangeMax === undefined || meta?.nominalRangeMax === null || isNaN(meta?.nominalRangeMax)) 
      errs.push('Sección 2: Ingrese el Rango Nominal Máximo.');
    if (meta?.nominalRangeMax <= meta?.nominalRangeMin)
      errs.push('Sección 2: El Rango Nominal Máximo debe ser mayor al Mínimo.');

    if (meta?.calibrationRangeMin === undefined || meta?.calibrationRangeMin === null || isNaN(meta?.calibrationRangeMin)) 
      errs.push('Sección 2: Ingrese el Rango de Calibración Mínimo.');
    if (meta?.calibrationRangeMax === undefined || meta?.calibrationRangeMax === null || isNaN(meta?.calibrationRangeMax)) 
      errs.push('Sección 2: Ingrese el Rango de Calibración Máximo.');
    if (meta?.calibrationRangeMax <= meta?.calibrationRangeMin)
      errs.push('Sección 2: El Rango de Calibración Máximo debe ser mayor al Mínimo.');

    if (!meta?.accuracyClass || isNaN(parseNum(meta?.accuracyClass))) 
      errs.push('Sección 2: La Clase de Exactitud es obligatoria y debe ser un número.');

    // Sección 2.1: Configuración de Salida Eléctrica
    if (!meta?.outputUnit) errs.push('Sección 2.1: Seleccione la Unidad de Salida.');
    
    if (meta?.outputRangeMin === undefined || meta?.outputRangeMin === null || isNaN(meta?.outputRangeMin)) 
      errs.push('Sección 2.1: Ingrese la Salida Nominal Mínima.');
    if (meta?.outputRangeMax === undefined || meta?.outputRangeMax === null || isNaN(meta?.outputRangeMax)) 
      errs.push('Sección 2.1: Ingrese la Salida Nominal Máxima.');
    if (meta?.outputRangeMax <= meta?.outputRangeMin)
      errs.push('Sección 2.1: La Salida Nominal Máxima debe ser mayor a la Mínima.');

    if (!meta?.resolution || isNaN(parseNum(meta?.resolution)) || parseNum(meta?.resolution) <= 0) 
      errs.push('Sección 2.1: La Resolución del Multímetro es obligatoria y debe ser mayor que 0.');

    // Sección 3: Equipamiento
    if (!selectedStandardIds[0]) errs.push('Sección 3: Debe seleccionar al menos un patrón de presión.');
    if (!meta?.multimeterId) errs.push('Sección 3: Seleccione el multímetro / lector digital.');
    if (!auxEquipment.thermohygrometerId) errs.push('Sección 3: Seleccione un Termohigrómetro.');

    // Sección 6: Captura
    if (points.length === 0) errs.push('Sección 6: Debe generar o registrar puntos de medición.');
    
    const incompletePoints = points.filter(p => p.standardValue === "" || p.instrumentValue === "");
    if (incompletePoints.length > 0) {
      errs.push(`Sección 6: Hay ${incompletePoints.length} puntos de medición incompletos.`);
    }

    setErrors(errs);
    return errs;
  };

  const runCalculations = async () => {
    const validationErrors = validateForm();
    if (validationErrors.filter(e => !e.includes('Sección 6')).length > 0) {
      alert('Por favor complete todos los datos requeridos en las secciones 1, 2 y 3 antes de realizar cálculos.');
      return;
    }

    if (points.length === 0) {
      alert('Debe registrar al menos un punto de medición en la sección 6.');
      return;
    }

    setIsCalculating(true);
    setTimeout(async () => {
      try {
        const uncertaintyMethod = (data.metadata as any)?.uncertaintyMethod || 'GUM';
        const methodology = (data.metadata as any)?.methodology || 'digital';
        const selectedStandard = standards.find(s => s.id === selectedStandardIds[0]);
        const thermoStandard = standards.find(s => s.id === auxEquipment.thermohygrometerId);
        const baroStandard = standards.find(s => s.id === auxEquipment.barometerId);

        const calibrator = new PressureCalibrator(
          { ...data.metadata, unidad: (data.metadata as any)?.unit || 'psi' }, 
          { presion: selectedStandard, termo: thermoStandard, barometro: baroStandard },
          data.metadata,
          { 
            metodo_incertidumbre: uncertaintyMethod, 
            methodology: methodology, 
            norm: (data.metadata as any)?.norm || 'DKD-R 6-1',
            magnitude: 'pressure_transmitter' // CRITICAL: Indica que es transmisor para BFSL
          }
        );

        // Transmitter specific influence coefficients (from UI or defaults)
        const meta = data.metadata as any;
        calibrator.setTransmitterConfig({
          resoDut: parseNum(meta?.resolution || '0.001'),
          coefTempDut: parseNum(meta?.tempCoeffDut || '0.015'),
          coefTempPat: parseNum(meta?.tempCoeffPat || '0.005'),
          deltaT: Math.abs((meta?.ambientTemp || 20) - 20) || 1.0 // Delta T respecto a referencia
        });

        const rawPoints = points.map(p => ({
          nominal: (parseNum(p.nominalValue) || 0),
          standard: (parseNum(p.standardValue) || 0),
          reading: (parseNum(p.instrumentValue) || 0)
        }));

        // 1. Pre-procesar BFSL con lecturas ELÉCTRICAS promedio
        const bfslData = Array.from(new Set(rawPoints.map(p => p.nominal))).map((n: any) => {
          const nom = n as number;
          const group = rawPoints.filter(p => p.nominal === nom);
          const meanI = group.reduce((acc, curr) => acc + curr.reading, 0) / group.length;
          return { nominal: nom, readings: [meanI] };
        });
        calibrator.prepareTransmitterBFSL(bfslData as { nominal: number, readings: number[] }[]);

        // 2. Procesar puntos metrológicos
        const nominalPoints = (Array.from(new Set(rawPoints.map(p => p.nominal))) as number[]).sort((a,b) => a - b);
        const results = nominalPoints.map((n: number) => {
          const group = rawPoints.filter(p => p.nominal === n);
          if (group.length === 0) return null;

          const refReadings = group.map(p => p.standard);
          const meanRef = refReadings.reduce((a, b) => a + b, 0) / refReadings.length;

          const asc = rawPoints.filter(p => p.nominal === n && points[rawPoints.indexOf(p)].direction === 'ascending').map(p => p.reading);
          const desc = rawPoints.filter(p => p.nominal === n && points[rawPoints.indexOf(p)].direction === 'descending').map(p => p.reading);
          
          const res = calibrator.procesarPunto(meanRef, asc, desc);
          if (!res) return null;
          
          return { ...res, nominal: n };
        }).filter(Boolean);

        if (results.length > 0) {
          setPointResults(results);
          const avgExp = results.reduce((acc, r) => acc + r!.uExp, 0) / results.length;
          setUncertainty({
            combined: avgExp / 2,
            expanded: avgExp,
            coverageFactor: 2,
            iterations: (uncertaintyMethod === 'Monte Carlo' || uncertaintyMethod === 'monte_carlo') ? 100000 : 1,
            method: (uncertaintyMethod === 'Monte Carlo' || uncertaintyMethod === 'monte_carlo') ? 'monte_carlo' : 'gum',
            bfsl: calibrator.bfsl,
            contributions: results[0]!.uncertaintyComps ? [
              { source: 'Incertidumbre Patrón (Ucal)', value: results[0]!.uncertaintyComps.uPat, distribution: 'normal' },
              { source: 'Repetibilidad (s)', value: results[0]!.uncertaintyComps.uRep, distribution: 'normal' },
              { source: 'Histéresis (h)', value: results[0]!.uncertaintyComps.uHist, distribution: 'rectangular' },
              { source: 'Resolución DUT/Lector', value: results[0]!.uncertaintyComps.uResInst, distribution: 'rectangular' },
              { source: 'Efectos Cero (f0)', value: results[0]!.uncertaintyComps.uZero, distribution: 'rectangular' }
            ] : []
          });
        }
      } catch (error) {
        console.error(error);
        setErrors(['Error en cálculos metrológicos.']);
      } finally {
        setIsCalculating(false);
      }
    }, 1000);
  };

  const exportToXML = () => {
    const escape = (str: any) => {
      if (str === null || str === undefined) return '';
      return str.toString()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
    };

    const buildNode = (name: string, value: any): string => {
      const tagName = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (value === null || value === undefined) return `<${tagName}/>`;
      if (Array.isArray(value)) return `<${tagName}>${value.map(item => buildNode('Item', item)).join('')}</${tagName}>`;
      if (typeof value === 'object') return `<${tagName}>${Object.entries(value).map(([k, v]) => buildNode(k, v)).join('')}</${tagName}>`;
      return `<${tagName}>${escape(value)}</${tagName}>`;
    };

    const xmlData = {
      Header: { RecordId: data.id, Timestamp: new Date().toISOString(), Technician: user?.name },
      Instrument: { Tag: data.instrumentTag, Magnitude: 'pressure_transmitter' },
      ElectricalConfig: { 
        Unit: (data.metadata as any).outputUnit, 
        Range: `${(data.metadata as any).outputRangeMin} - ${(data.metadata as any).outputRangeMax}` 
      },
      Measurements: points.map(p => ({
        Nominal: p.nominalValue,
        Standard: p.standardValue,
        ElectricalReading: p.instrumentValue,
        IdealOutput: (calculateIdealOutput(parseNum(p.standardValue)) || 0).toFixed(4)
      }))
    };

    const xmlString = `<?xml version="1.0" encoding="UTF-8"?>\n<PressureTransmitterRecord>\n${Object.entries(xmlData).map(([k, v]) => buildNode(k, v)).join('')}\n</PressureTransmitterRecord>`;
    const blob = new Blob([xmlString], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `CAL-${data.instrumentTag}-${Date.now()}.xml`;
    link.click();
  };

  const previewCertificate = async () => {
    try {
      const doc = await generateDraftCertificate({
        ...data,
        measurements: points.map(p => ({
          ...p,
          standardValue: parseNum(p.standardValue) || 0,
          instrumentValue: parseNum(p.instrumentValue) || 0
        })),
        uncertaintyResults: uncertainty
      } as any);
      doc.save(`BORRADOR-${data.instrumentTag}.pdf`);
    } catch (err) { alert('Error generando PDF: ' + err); }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const validationErrors = validateForm();
    if (validationErrors.length > 0) return;
    
    try {
      const id = initialData?.id || crypto.randomUUID();
      const calibration: CalibrationData = {
        ...data,
        id,
        status: CalibrationStatus.PRELIMINARY,
        metadata: {
          ...data.metadata,
          referenceStandardIds: selectedStandardIds,
          ...auxEquipment
        } as any,
        measurements: points.map(p => ({
          ...p,
          standardValue: parseNum(p.standardValue) || 0,
          instrumentValue: parseNum(p.instrumentValue) || 0
        })),
        uncertaintyResults: uncertainty,
        updatedAt: Date.now(),
        technicianId: user?.id || 'anonymous',
        technicianName: user?.name,
        technicianEmail: user?.email,
        history: [
          ...(initialData?.history || []),
          {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            author: user?.name || 'Sistema',
            message: `Captura de transmisor finalizada.`,
            type: 'system'
          }
        ]
      } as any;
      
      await db.calibrations.put(calibration);
      
      if (data.workOrderId && data.instrumentId) {
        const order = await db.workOrders.get(data.workOrderId);
        if (order) {
          const updatedInstruments = order.instruments.map(inst => 
            inst.id === data.instrumentId ? { ...inst, status: 'completed' as const } : inst
          );
          await db.workOrders.update(order.id, { instruments: updatedInstruments as any, updatedAt: Date.now() });
        }
      }
      
      alert('Captura Finalizada Exitostamente.');
      exportToXML();
      onSuccess();
    } catch (err) { 
      alert('Error guardando: ' + err); 
    }
  };

  return (
    <div className="bg-white border border-[#141414]/10 rounded-3xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-300 mb-10">
      <div className="p-8 border-b border-[#141414]/10 bg-[#F5F5F0]/30 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <button 
            type="button" 
            onClick={onCancel}
            className="group flex flex-col items-center gap-1 transition-all"
          >
            <div className="p-3 bg-white border border-red-100 rounded-2xl group-hover:bg-red-50 group-hover:border-red-300 transition-all shadow-sm">
              <ArrowLeft className="w-5 h-5 text-red-400 group-hover:text-red-600 transition-colors" />
            </div>
            <span className="text-[8px] font-black uppercase tracking-widest text-[#141414]/30 group-hover:text-red-600 transition-colors">Regresar</span>
          </button>
          <div>
            <h3 className="text-xl font-bold text-[#141414]">Transmisor de Presión (DKD R-6)</h3>
            <p className="text-sm text-[#141414]/60">Gestión eléctrica y metrológica integrada bajo norma</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <select 
            className={cn("border p-2 rounded-xl text-[10px] font-black uppercase shadow-sm outline-none transition-all", STATUS_INFO[status].color)}
            value={status}
            onChange={e => setStatus(e.target.value as CalibrationStatus)}
          >
            {Object.entries(STATUS_INFO).map(([value, info]) => <option key={value} value={value}>{info.label}</option>)}
          </select>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-8 space-y-10">
        <fieldset disabled={status === CalibrationStatus.PUBLISHED} className="space-y-10 contents">
          {/* Errors */}
          {errors.length > 0 && (
            <div className="p-6 bg-red-50 border border-red-200 rounded-2xl space-y-3">
               <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                {errors.map((err, i) => <li key={i} className="text-[10px] font-bold text-red-500 flex items-center gap-2"><span className="w-1 h-1 rounded-full bg-red-400" />{err}</li>)}
              </ul>
            </div>
          )}

          {/* TOP HEADER: IDENTIFICACIÓN PRINCIPAL */}
          <section className="p-8 bg-[#F5F5F0]/50 rounded-[2.5rem] border border-[#141414]/5 grid grid-cols-1 md:grid-cols-4 gap-6 shadow-inner">
            <div className="space-y-1">
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Cliente / Solicitante</label>
              <input 
                className="w-full p-3.5 bg-white border border-[#141414]/10 rounded-2xl outline-none text-sm font-black shadow-sm focus:border-blue-500 transition-all" 
                value={data.clientName ?? ''} 
                onChange={e => setData({...data, clientName: e.target.value})} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Fecha de Calibración</label>
              <input 
                type="date"
                className="w-full p-3.5 bg-white border border-[#141414]/10 rounded-2xl outline-none text-sm font-bold shadow-sm focus:border-blue-500 transition-all" 
                value={data.calibrationDate ? new Date(data.calibrationDate).toISOString().split('T')[0] : ''} 
                onChange={e => {
                  const date = new Date(e.target.value);
                  // Ensure we use the correct local date or UTC? 
                  // For a simple date picker, setting to noon avoids timezone shifts
                  date.setMinutes(date.getMinutes() + date.getTimezoneOffset());
                  setData({...data, calibrationDate: date.getTime()});
                }} 
              />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">N° Orden de Trabajo</label>
              <input 
                className="w-full p-3.5 bg-white border border-[#141414]/10 rounded-2xl outline-none text-sm font-mono font-bold text-blue-600 shadow-sm focus:border-blue-500 transition-all" 
                value={data.workOrderId ?? ''} 
                onChange={e => setData({...data, workOrderId: e.target.value})}
                placeholder="Ej. OT-2024-001"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">ID Registro (Sistema)</label>
              <div className="w-full p-3.5 bg-white/50 border border-[#141414]/5 rounded-2xl text-[10px] font-mono text-[#141414]/30 truncate">
                {data.id}
              </div>
            </div>
          </section>

          {/* Section 1: Instrument Data */}
          <section className="space-y-6">
            <div className="flex items-center gap-2 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-[#141414]" />
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">1. Datos del Instrumento (IBC)</h4>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
               {/* Identificación Básica */}
               <div className="space-y-1">
                 <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Tipo de Instrumento</label>
                 <select 
                   className="w-full p-3.5 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none text-sm font-bold"
                   value={(data.metadata as any)?.instrumentType}
                   onChange={e => setData({...data, metadata: {...data.metadata!, instrumentType: e.target.value} as any})}
                 >
                   {["TRANSMISOR DE PRESIÓN", "TRANSMISOR DIFERENCIAL", "TRANSDUCTOR DE PRESIÓN", "TRANSMISOR ELECTRÓNICO", "SWITCH DE PRESIÓN"].map(opt => (
                     <option key={opt} value={opt}>{opt}</option>
                   ))}
                 </select>
               </div>

               <div className="space-y-1">
                 <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">TAG / N° Serie</label>
                 <input 
                   className="w-full p-3.5 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none text-sm font-black" 
                   value={data.instrumentTag ?? ''} 
                   onChange={e => setData({...data, instrumentTag: e.target.value})} 
                   placeholder="SN-2024-X"
                 />
               </div>

               <div className="space-y-1">
                 <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Marca / Modelo</label>
                 <input 
                   className="w-full p-3.5 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none text-sm font-medium" 
                   value={data.instrumentDescription ?? ''} 
                   onChange={e => setData({...data, instrumentDescription: e.target.value})} 
                   placeholder="Ej. Emerson Rosemount 3051"
                 />
               </div>

               {/* Ubicación y Detalles Físicos */}
               <div className="space-y-1">
                 <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Ubicación (Sede/Planta/Área)</label>
                 <input 
                   className="w-full p-3.5 bg-white border border-[#141414]/10 rounded-2xl outline-none text-sm font-medium" 
                   value={(data.metadata as any)?.location ?? ''} 
                   onChange={e => setData({...data, metadata: {...data.metadata!, location: e.target.value} as any})} 
                   placeholder="Planta 2 - Compresores"
                 />
               </div>

               <div className="space-y-1">
                 <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Tamaño / Conexión</label>
                 <input 
                   className="w-full p-3.5 bg-white border border-[#141414]/10 rounded-2xl outline-none text-sm font-medium" 
                   value={(data.metadata as any)?.size ?? ''} 
                   onChange={e => setData({...data, metadata: {...data.metadata!, size: e.target.value} as any})} 
                   placeholder="1/2 NPT"
                 />
               </div>

               <div className="space-y-1">
                 <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Lugar de Calibración</label>
                 <select 
                    className="w-full p-3.5 bg-white border border-[#141414]/10 rounded-2xl outline-none text-sm font-bold"
                    value={(data.metadata as any)?.locationType || 'IN_SITU'}
                    onChange={e => setData({...data, metadata: {...data.metadata!, locationType: e.target.value} as any})}
                  >
                    <option value="IN_SITU">In Situ</option>
                    <option value="LABORATORIO">Laboratorio</option>
                  </select>
               </div>

               <div className="space-y-1 lg:col-span-1">
                 <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Certificado Anterior</label>
                 <input 
                   className="w-full p-3.5 bg-white border border-[#141414]/10 rounded-2xl outline-none text-sm font-mono" 
                   value={(data.metadata as any)?.prevCertificate ?? ''} 
                   onChange={e => setData({...data, metadata: {...data.metadata!, prevCertificate: e.target.value} as any})} 
                   placeholder="N° CERT-2023"
                 />
               </div>
            </div>
          </section>

          {/* Section 2: Pressure Metrology */}
          <section className="space-y-6">
            <div className="flex items-center gap-2 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]" />
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">2. Parámetros de Presión y Metodología</h4>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-8 bg-blue-50/20 rounded-[2rem] border border-blue-100/50">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-blue-600 px-1">Norma de Referencia</label>
                <select 
                  className="w-full p-3 bg-white border border-blue-100 rounded-xl outline-none text-xs font-bold shadow-sm" 
                  value={(data.metadata as any)?.norm || 'DKD-R 6-1'} 
                  onChange={e => setData({...data, metadata: {...data.metadata!, norm: e.target.value} as any})}
                >
                  <option value="DKD-R 6-1">DKD-R 6-1 (Exactitud)</option>
                  <option value="CEM ME-017">CEM ME-017 (Transmisores)</option>
                  <option value="NTE INEN 1825">NTE INEN 1825 (Elastic Sensor)</option>
                  <option value="PROC-TC-012">PROC-TC-012 (Interno)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-blue-600 px-1">Unidad de Presión</label>
                <select className="w-full p-3 bg-white border border-blue-100 rounded-xl outline-none text-xs font-bold shadow-sm" value={(data.metadata as any)?.unit} onChange={e => setData({...data, metadata: {...data.metadata!, unit: e.target.value} as any})}>
                  {["psi", "bar", "kPa", "MPa", "kgf/cm2", "mmHg", "inHg"].map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black tracking-widest text-[#141414]/40 uppercase flex justify-between items-center px-1">
                      <span>Rango Nominal (IBC)</span>
                      <button 
                        type="button"
                        onClick={() => {
                          const m = data.metadata as any;
                          setData(prev => ({
                            ...prev,
                            metadata: {
                              ...prev.metadata!,
                              calibrationRangeMin: m.nominalRangeMin,
                              calibrationRangeMax: m.nominalRangeMax
                            } as any
                          }));
                        }}
                        className="text-[8px] text-blue-600 hover:underline"
                        title="Copiar valores nominales al rango de calibración"
                      >
                        Copiar a Calibración
                      </button>
                    </label>
                    <div className="flex gap-2">
                       <input 
                        type="number" 
                        step="any"
                        className="w-1/2 p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-xs font-mono focus:border-blue-300 transition-all" 
                        value={(data.metadata as any)?.nominalRangeMin ?? ''} 
                        placeholder="Min" 
                        onChange={e => {
                          const val = parseNum(e.target.value);
                          setData(prev => {
                            const meta = prev.metadata as any;
                            const numericVal = isNaN(val) ? undefined : val;
                            const newMeta = { ...meta, nominalRangeMin: numericVal };
                            // Sincronizar si el rango de calibración es igual al nominal (comportamiento por defecto)
                            if (meta.calibrationRangeMin === meta.nominalRangeMin || meta.calibrationRangeMin === undefined) {
                              newMeta.calibrationRangeMin = numericVal;
                            }
                            return { ...prev, metadata: newMeta };
                          });
                        }} 
                       />
                       <input 
                        type="number" 
                        step="any"
                        className="w-1/2 p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-xs font-mono focus:border-blue-300 transition-all" 
                        value={(data.metadata as any)?.nominalRangeMax ?? ''} 
                        placeholder="Max" 
                        onChange={e => {
                          const val = parseNum(e.target.value);
                          setData(prev => {
                            const meta = prev.metadata as any;
                            const numericVal = isNaN(val) ? undefined : val;
                            const newMeta = { ...meta, nominalRangeMax: numericVal };
                            // Sincronizar si el rango de calibración es igual al nominal
                            if (meta.calibrationRangeMax === meta.nominalRangeMax || meta.calibrationRangeMax === undefined) {
                              newMeta.calibrationRangeMax = numericVal;
                            }
                            return { ...prev, metadata: newMeta };
                          });
                        }} 
                       />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 px-1 flex justify-between items-center">
                      <span>Rango Calibración</span>
                      <button 
                        type="button"
                        onClick={generatePoints}
                        className="text-[8px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full hover:bg-emerald-200"
                      >
                        Generar Sequence
                      </button>
                    </label>
                    <div className="flex gap-2">
                       <input 
                        type="number" 
                        step="any"
                        className="w-1/2 p-3 bg-white border border-emerald-100 rounded-xl outline-none text-xs font-mono focus:border-emerald-400 transition-all" 
                        value={(data.metadata as any)?.calibrationRangeMin ?? ''} 
                        placeholder="Min" 
                        onChange={e => {
                          const val = parseNum(e.target.value);
                          setData(prev => ({...prev, metadata: {...prev.metadata!, calibrationRangeMin: isNaN(val) ? undefined : val} as any}));
                        }} 
                       />
                       <input 
                        type="number" 
                        step="any"
                        className="w-1/2 p-3 bg-white border border-emerald-100 rounded-xl outline-none text-xs font-mono focus:border-emerald-400 transition-all" 
                        value={(data.metadata as any)?.calibrationRangeMax ?? ''} 
                        placeholder="Max" 
                        onChange={e => {
                          const val = parseNum(e.target.value);
                          setData(prev => ({...prev, metadata: {...prev.metadata!, calibrationRangeMax: isNaN(val) ? undefined : val} as any}));
                        }} 
                       />
                    </div>
                  </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Clase Exactitud (%)</label>
                <input className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-xs font-mono font-black" value={data.metadata?.accuracyClass} placeholder="Ej. 0.05" onChange={e => setData({...data, metadata: {...data.metadata!, accuracyClass: e.target.value}})} />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Fluido de Trabajo</label>
                <select className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-xs font-medium" value={data.metadata?.fluid} onChange={e => setData({...data, metadata: {...data.metadata!, fluid: e.target.value}})}>
                  <option value="Aire">Aire</option>
                  <option value="Aceite">Aceite</option>
                  <option value="Nitrógeno">Nitrógeno</option>
                  <option value="Agua">Agua</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Método Incertidumbre</label>
                <select className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-xs font-bold" value={(data.metadata as any)?.uncertaintyMethod || 'GUM'} onChange={e => setData({...data, metadata: {...data.metadata!, uncertaintyMethod: e.target.value} as any})}>
                   <option value="GUM">GUM (Analítico)</option>
                   <option value="Monte Carlo">Monte Carlo (Numérico)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Efecto por Montaje</label>
                <div className="flex items-center h-[42px] px-3 bg-white border border-[#141414]/10 rounded-xl shadow-sm">
                  <label className="flex items-center gap-2 cursor-pointer w-full">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-[#141414]/20 text-blue-600 focus:ring-blue-500"
                      checked={(data.metadata as any)?.mountingDependent || false}
                      onChange={e => setData({...data, metadata: {...data.metadata!, mountingDependent: e.target.checked} as any})}
                    />
                    <span className="text-[9px] font-black uppercase text-[#141414]/50 leading-none">Sí (Efecto A±)</span>
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Section 2.1: Electrical Config */}
          <section className="space-y-6">
            <div className="flex items-center gap-2 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">2.1 Configuración de Salida Eléctrica</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-6 bg-amber-50/20 rounded-2xl border border-amber-100">
               <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-amber-600 uppercase">Unidad de Salida</label>
                <select 
                  className="w-full p-3 bg-white border border-amber-200 rounded-xl font-bold text-xs outline-none shadow-sm"
                  value={(data.metadata as any).outputUnit}
                  onChange={e => setData({...data, metadata: {...data.metadata!, outputUnit: e.target.value} as any})}
                >
                  <option value="mA">miliAmperios (mA)</option>
                  <option value="V">Voltios (V)</option>
                  <option value="mV">miliVoltios (mV)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-amber-600 uppercase">Salida Nominal Min</label>
                <input type="number" step="any" className="w-full p-3 bg-white border border-amber-200 rounded-xl font-mono text-xs" value={(data.metadata as any).outputRangeMin} onChange={e => setData({...data, metadata: {...data.metadata!, outputRangeMin: parseNum(e.target.value)} as any})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-amber-600 uppercase">Salida Nominal Max</label>
                <input type="number" step="any" className="w-full p-3 bg-white border border-amber-200 rounded-xl font-mono text-xs" value={(data.metadata as any).outputRangeMax} onChange={e => setData({...data, metadata: {...data.metadata!, outputRangeMax: parseNum(e.target.value)} as any})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-black tracking-widest text-amber-600 uppercase">Res. Multímetro</label>
                <input type="number" step="any" className="w-full p-3 bg-white border border-amber-200 rounded-xl font-mono text-xs" value={data.metadata?.resolution ?? ''} onChange={e => setData({...data, metadata: {...data.metadata!, resolution: parseNum(e.target.value)}})} />
              </div>
            </div>
          </section>

          {/* Section 3: Standards Selector (Advanced like PressureForm) */}
          <section className="space-y-6">
            <div className="flex items-center gap-2 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">3. Equipamiento de Medición</h4>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
               <div className="p-6 bg-[#F5F5F0]/50 rounded-3xl border border-[#141414]/5 space-y-4">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60">Relación de Patrones de Presión</label>
                    <button type="button" onClick={addStandardSelector} disabled={selectedStandardIds.length >= 3} className="text-[9px] font-black uppercase text-blue-600 hover:scale-105 transition-all">+ Añadir</button>
                  </div>
                  {selectedStandardIds.map((id, idx) => (
                    <div key={idx} className="flex gap-2">
                       <select className="flex-1 p-3 bg-white border border-[#141414]/10 rounded-xl text-xs font-medium outline-none shadow-sm" value={id} onChange={e => updateStandardId(idx, e.target.value)}>
                          <option value="">Seleccione patrón...</option>
                          {standards.filter(s => s.tipo === 'manometro').map(s => <option key={s.id} value={s.id}>{s.alias} ({s.rangeMax} {s.unidad})</option>)}
                       </select>
                       {idx > 0 && <button type="button" onClick={() => updateStandardId(idx, '')} className="p-2 text-red-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  ))}
               </div>

               <div className="p-6 bg-[#F5F5F0]/50 rounded-3xl border border-[#141414]/5 space-y-4">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60 block mb-2">Monitor Eléctrico, Ambiente y Generación</label>
                  <div className="grid grid-cols-1 gap-3">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="space-y-1">
                           <span className="text-[9px] font-bold text-[#141414]/40 uppercase ml-1">Multímetro / Lector Digital</span>
                           <select className="w-full p-2.5 bg-white border border-[#141414]/10 rounded-xl text-xs outline-none shadow-sm font-bold" value={(data.metadata as any).multimeterId} onChange={e => setData({...data, metadata: {...data.metadata!, multimeterId: e.target.value} as any})}>
                              <option value="">Seleccione equipo...</option>
                              {standards.filter(s => s.tipo === 'multimetro' || s.unit === 'mA' || s.unit === 'V').map(s => <option key={s.id} value={s.id}>{s.alias} ({s.brand} {s.model})</option>)}
                           </select>
                        </div>
                        <div className="space-y-1">
                           <span className="text-[9px] font-bold text-[#141414]/40 uppercase ml-1">Bomba / Generador</span>
                           <select className="w-full p-2.5 bg-white border border-[#141414]/10 rounded-xl text-xs outline-none shadow-sm font-bold" value={auxEquipment.pressureGeneratorId} onChange={e => setAuxEquipment({...auxEquipment, pressureGeneratorId: e.target.value})}>
                              <option value="">Seleccione generador...</option>
                              {standards.filter(s => s.tipo === 'bomba' || s.tipo === 'controlador' || s.tipo === 'generador').map(s => <option key={s.id} value={s.id}>{s.alias} ({s.brand} {s.model})</option>)}
                           </select>
                        </div>
                     </div>
                     <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                           <span className="text-[9px] font-bold text-[#141414]/40 uppercase ml-1">Termohigrómetro</span>
                           <select className="w-full p-2.5 bg-white border border-[#141414]/10 rounded-xl text-xs outline-none shadow-sm" value={auxEquipment.thermohygrometerId} onChange={e => setAuxEquipment({...auxEquipment, thermohygrometerId: e.target.value})}>
                             <option value="">Seleccione...</option>
                             {standards.filter(s => s.tipo === 'termo').map(s => <option key={s.id} value={s.id}>{s.alias}</option>)}
                           </select>
                        </div>
                        <div className="space-y-1">
                           <span className="text-[9px] font-bold text-[#141414]/40 uppercase ml-1">Barómetro</span>
                           <select className="w-full p-2.5 bg-white border border-[#141414]/10 rounded-xl text-xs outline-none shadow-sm" value={auxEquipment.barometerId} onChange={e => setAuxEquipment({...auxEquipment, barometerId: e.target.value})}>
                             <option value="">Seleccione...</option>
                             {standards.filter(s => s.tipo === 'barometro').map(s => <option key={s.id} value={s.id}>{s.alias}</option>)}
                           </select>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
          </section>

          {/* Section 4: Physical Inspection */}
          <section className="space-y-6">
            <div className="flex items-center gap-2 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.4)]" />
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">4. Preparación e Inspección Física</h4>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <div className="lg:col-span-1 space-y-4">
                 {[
                   { key: 'cleaning', label: 'Limpieza Exterior', icon: Wind },
                   { key: 'leakTest', label: 'Hermeticidad', icon: ShieldCheck },
                   { key: 'precharge', label: 'Ciclos de Precarga', icon: RefreshCw },
                   { key: 'zeroAdjust', label: 'Ajuste de Cero', icon: Settings2 }
                 ].map(item => (
                   <label key={item.key} className="flex items-center justify-between p-4 bg-white border border-[#141414]/10 rounded-2xl hover:border-blue-200 cursor-pointer transition-all shadow-sm group">
                      <div className="flex items-center gap-3">
                        <item.icon className="w-4 h-4 text-[#141414]/30" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60">{item.label}</span>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={item.key === 'leakTest' || item.key === 'precharge' ? (data.metadata?.inspection as any)?.[item.key]?.performed : (data.metadata?.inspection as any)?.[item.key]} 
                        onChange={e => {
                          const insp = (data.metadata?.inspection as any);
                          if (item.key === 'leakTest' || item.key === 'precharge') {
                            setData({...data, metadata: {...data.metadata!, inspection: {...insp, [item.key]: {...insp[item.key], performed: e.target.checked}}} as any});
                          } else {
                            setData({...data, metadata: {...data.metadata!, inspection: {...insp, [item.key]: e.target.checked}} as any});
                          }
                        }}
                        className="w-4 h-4 rounded text-blue-600"
                      />
                   </label>
                 ))}
                 
                 <div className="p-4 bg-purple-50/50 rounded-2xl border border-purple-100 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <Clock className={cn("w-3.5 h-3.5", isTimerRunning && "animate-spin text-purple-600")} />
                      <span className="text-sm font-mono font-black">{formatTimer(timerSeconds)}</span>
                    </div>
                    <button type="button" onClick={() => setIsTimerRunning(!isTimerRunning)} className="text-[9px] font-black uppercase text-purple-600 bg-white px-3 py-1.5 rounded-lg shadow-sm border border-purple-100 hover:bg-purple-100 transition-all">{isTimerRunning ? 'Pausar' : 'Iniciar Timer'}</button>
                 </div>
              </div>

              <div className="lg:col-span-3 bg-[#F5F5F0]/30 rounded-3xl border border-[#141414]/5 p-6 shadow-inner">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <h5 className="text-[9px] font-black uppercase text-[#141414]/30 tracking-[0.2em] mb-2 flex items-center gap-2"><Settings2 className="w-3 h-3" /> Estado de Componentes</h5>
                    {Object.entries((data.metadata as any).inspection.components).map(([key, val]) => (
                      <div key={key} className="flex items-center justify-between group">
                        <span className="text-[10px] font-bold uppercase text-[#141414]/60 tracking-wider capitalize">{key}</span>
                        <select 
                          className="bg-transparent border-none text-[10px] font-black text-blue-600 text-right outline-none cursor-pointer"
                          value={val as string}
                          onChange={e => {
                            const newComps = { ...(data.metadata as any).inspection.components, [key]: e.target.value };
                            setData({...data, metadata: {...data.metadata!, inspection: {...(data.metadata as any).inspection, components: newComps}} as any});
                          }}
                        >
                          <option value="OK">OK (SIN DAÑOS)</option>
                          <option value="REGULAR">DAÑO MENOR</option>
                          <option value="FAIL">CRÍTICO</option>
                        </select>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-4">
                    <h5 className="text-[9px] font-black uppercase text-[#141414]/30 tracking-[0.2em] mb-2 flex items-center gap-2"><ArrowBigUpDash className="w-3 h-3" /> Dictamen Inicial</h5>
                    <div className="space-y-2">
                      <select 
                        className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl text-xs font-bold shadow-sm"
                        value={(data.metadata as any).inspection.visualCheck}
                        onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {...(data.metadata as any).inspection, visualCheck: e.target.value}} as any})}
                      >
                         <option value="good">Estructuralmente Íntegro</option>
                         <option value="fair">Aceptable con Observación</option>
                         <option value="poor">No Apto para Uso</option>
                      </select>
                      <select 
                        className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl text-xs font-bold shadow-sm"
                        value={(data.metadata as any).inspection.equipmentStatus}
                        onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {...(data.metadata as any).inspection, equipmentStatus: e.target.value}} as any})}
                      >
                         <option value="SERVICE">En Servicio</option>
                         <option value="REPAIR">Requiere Ajuste/Reparación</option>
                         <option value="RETIRED">Fuera de Uso</option>
                      </select>
                      <textarea 
                        className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl text-xs min-h-[96px] outline-none shadow-sm focus:border-blue-500 transition-all"
                        placeholder="Observaciones adicionales de inspección..."
                        value={(data.metadata as any).inspection.notes}
                        onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {...(data.metadata as any).inspection, notes: e.target.value}} as any})}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-1 bg-[#141414] rounded-3xl p-6 flex flex-col justify-center items-center text-center group overflow-hidden relative shadow-2xl">
                 <div className="absolute inset-0 bg-blue-600/10 group-hover:bg-blue-600/20 transition-all opacity-0 group-hover:opacity-100" />
                 <CheckCircle2 className="w-8 h-8 text-emerald-400 mb-3 relative z-10" />
                 <h4 className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] mb-1 relative z-10">Estado Global</h4>
                 <div className="text-xl font-black text-white uppercase tracking-tighter relative z-10">APROBADO</div>
                 <div className="text-[9px] font-bold text-white/30 uppercase mt-4 relative z-10">Listo para Calibración</div>
              </div>
            </div>
          </section>

          {/* Section 5: Environmental Conditions */}
          <section className="space-y-6">
            <div className="flex items-center gap-2 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
              <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">5. Entorno Crítico y Alturas (CIPM-2007)</h4>
            </div>
            
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
               <div className="xl:col-span-3 grid grid-cols-2 lg:grid-cols-4 gap-4 p-8 bg-emerald-50/20 rounded-[2.5rem] border border-emerald-100/50">
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-black tracking-widest text-[#141414]/40 uppercase flex items-center gap-1.5"><Thermometer className="w-3 h-3 text-emerald-600" /> T. Ambiente (°C)</span>
                    <input type="number" step="any" className="w-full p-3 bg-white border border-emerald-100 rounded-xl font-mono text-sm shadow-sm" value={data.metadata?.ambientTemp ?? ''} onChange={e => setData({...data, metadata: {...data.metadata!, ambientTemp: parseNum(e.target.value) || 0}})} />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-black tracking-widest text-[#141414]/40 uppercase flex items-center gap-1.5"><Droplets className="w-3 h-3 text-emerald-600" /> Humedad (%)</span>
                    <input type="number" step="any" className="w-full p-3 bg-white border border-emerald-100 rounded-xl font-mono text-sm shadow-sm" value={data.metadata?.humidity ?? ''} onChange={e => setData({...data, metadata: {...data.metadata!, humidity: parseNum(e.target.value) || 0}})} />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-black tracking-widest text-[#141414]/40 uppercase flex items-center gap-1.5"><MapPin className="w-3 h-3 text-emerald-600" /> P. Atm. (hPa)</span>
                    <input type="number" step="any" className="w-full p-3 bg-white border border-emerald-100 rounded-xl font-mono text-sm shadow-sm" value={data.metadata?.pressureAtmHpa ?? ''} onChange={e => setData({...data, metadata: {...data.metadata!, pressureAtmHpa: parseNum(e.target.value) || 1013.25}})} />
                  </div>
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-black tracking-widest text-[#141414]/40 uppercase flex items-center gap-1.5"><Activity className="w-3 h-3 text-emerald-600" /> Gravedad (m/s²)</span>
                    <input type="number" step="any" className="w-full p-3 bg-white border border-emerald-100 rounded-xl font-mono text-sm shadow-sm" value={data.metadata?.gravity} onChange={e => setData({...data, metadata: {...data.metadata!, gravity: parseNum(e.target.value) || 9.77}})} />
                  </div>
               </div>

               <div className="xl:col-span-2 bg-[#F5F5F0]/50 rounded-[2.5rem] border border-[#141414]/5 p-8 flex flex-col justify-between shadow-inner">
                  <div className="grid grid-cols-2 gap-8">
                     <div>
                        <h5 className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-1 group flex items-center gap-2">
                          <Wind className="w-3.5 h-3.5" /> Densidad Aire
                        </h5>
                        <p className="text-xl font-mono font-black text-[#141414]">{(airProperties?.rho || 1.2).toFixed(4)} <span className="text-[10px] text-[#141414]/30">kg/m³</span></p>
                        <p className="text-[8px] font-bold text-[#141414]/30 uppercase mt-1">u(ρ): ±{(airProperties?.uRho || 0.001).toFixed(6)}</p>
                     </div>
                     <div className="text-right">
                        <div className="inline-block px-3 py-1 bg-emerald-100 rounded-lg text-[8px] font-black text-emerald-700 tracking-tighter uppercase mb-2">CÁLCULO AUTOMÁTICO CIPM-2007</div>
                        <p className="text-[8px] font-bold text-[#141414]/30 uppercase leading-tight">Masa molar, compresibilidad y<br/>humedad integrados</p>
                     </div>
                  </div>
               </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 bg-white p-6 rounded-3xl border border-[#141414]/5 shadow-sm">
               <div className="space-y-4">
                  <h5 className="text-[9px] font-black uppercase text-[#141414]/30 tracking-widest flex items-center gap-2"><Ruler className="w-3.5 h-3.5 text-blue-500" /> Diferencia de Alturas (Cabezal)</h5>
                  <div className="grid grid-cols-2 gap-4">
                     <div className="space-y-1.5">
                        <span className="text-[9px] font-bold text-[#141414]/40 uppercase ml-1">H. Referencia (mm)</span>
                        <input type="number" step="any" className="w-full p-2.5 bg-[#F5F5F0]/20 border border-[#141414]/10 rounded-xl font-mono text-xs focus:bg-white transition-all shadow-inner" value={data.metadata?.heightPatternMm} onChange={e => setData({...data, metadata: {...data.metadata!, heightPatternMm: parseNum(e.target.value) || 0}})} />
                     </div>
                     <div className="space-y-1.5">
                        <span className="text-[9px] font-bold text-[#141414]/40 uppercase ml-1">H. Instrumento (mm)</span>
                        <input type="number" step="any" className="w-full p-2.5 bg-[#F5F5F0]/20 border border-[#141414]/10 rounded-xl font-mono text-xs focus:bg-white transition-all shadow-inner" value={data.metadata?.heightInstrumentMm} onChange={e => setData({...data, metadata: {...data.metadata!, heightInstrumentMm: parseNum(e.target.value) || 0}})} />
                     </div>
                  </div>
               </div>
               <div className="space-y-4">
                  <h5 className="text-[9px] font-black uppercase text-[#141414]/30 tracking-widest flex items-center gap-2"><FileText className="w-3.5 h-3.5 text-amber-500" /> Notas de Calibración</h5>
                  <textarea 
                    className="w-full p-3 bg-[#F5F5F0]/20 border border-[#141414]/10 rounded-xl text-xs min-h-[64px] outline-none shadow-inner focus:bg-white transition-all"
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                  />
               </div>
            </div>
          </section>

          {/* Section 6: Capture / Measurements */}
          <section className="space-y-6">
            <div className="flex items-center justify-between px-1 bg-white/40 p-4 rounded-3xl border border-[#141414]/5 mb-4">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-[#141414] rounded-2xl shadow-xl">
                  <Calculator className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h4 className="text-[14px] font-black uppercase tracking-[0.2em] text-[#141414]">6. Captura Metrológica Transmisor</h4>
                  <p className="text-[10px] font-bold text-[#141414]/30 uppercase tracking-widest mt-0.5">
                    Instrumento: {data.instrumentTag || 'SIN TAG'} | Norma: {(data.metadata as any)?.norm || 'DKD-R 6-1'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                 <button 
                  type="button" 
                  onClick={() => setIsTableMaximized(!isTableMaximized)} 
                  className={cn(
                    "px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all shadow-xl active:scale-95 flex items-center gap-3",
                    isTableMaximized ? "bg-red-500 text-white" : "bg-[#141414] text-white hover:bg-[#141414]/90"
                  )}
                 >
                   {isTableMaximized ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Settings2 className="w-4 h-4" />}
                   {isTableMaximized ? 'Cerrar Vista Expandida' : 'Maximizar Tabla'}
                 </button>
                 <button 
                  type="button" 
                  onClick={loadExampleData} 
                  className="px-5 py-3 bg-white text-[#141414]/60 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-gray-50 transition-all shadow-sm border border-[#141414]/10"
                 >
                   <Zap className="w-3 h-3 inline-block mr-2" /> Ejemplo
                 </button>
                 <button type="button" onClick={generatePoints} className="px-5 py-3 bg-white text-[#141414]/60 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-gray-50 transition-all shadow-sm border border-[#141414]/10"><RefreshCw className="w-3 h-3 inline-block mr-2" /> Auto-Secuencia</button>
                 <button type="button" onClick={clearPoints} className="px-5 py-3 bg-red-50 text-red-600 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-red-100 transition-all shadow-sm border border-red-100"><Trash2 className="w-3 h-3 inline-block mr-2" /> Borrar Puntos</button>
                 <button type="button" onClick={runCalculations} disabled={isCalculating} className="px-6 py-3 bg-blue-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] hover:scale-105 transition-all shadow-xl active:scale-95 flex items-center gap-2">{isCalculating ? 'Procesando...' : <><Calculator className="w-3 h-3" /> Calcular Resultados</>}</button>
              </div>
            </div>

            <div className={cn(
                "border border-[#141414]/10 rounded-[2.5rem] overflow-hidden bg-white/50 backdrop-blur-sm shadow-xl relative transition-all duration-500",
                isTableMaximized ? "fixed inset-8 z-[100] bg-white overflow-auto p-8 shadow-[0_0_100px_rgba(0,0,0,0.5)] border-none" : "relative"
              )}>
               {isTableMaximized && (
                 <div className="flex justify-between items-center mb-10 px-4">
                   <div className="flex items-center gap-4">
                     <div className="w-4 h-4 rounded-full bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.8)] animate-pulse" />
                     <h4 className="text-2xl font-black uppercase tracking-[0.3em] text-[#141414]">Consola de Captura de Datos</h4>
                   </div>
                   <div className="flex items-center gap-3">
                     <button 
                       type="button" 
                       onClick={generatePoints} 
                       className="px-6 py-3 bg-blue-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl hover:scale-105 transition-all flex items-center gap-2"
                     >
                       <RefreshCw className="w-3 h-3" /> AUTO-SECUENCIA
                     </button>
                     <button 
                       type="button" 
                       onClick={clearPoints} 
                       className="px-6 py-3 bg-red-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl hover:scale-105 transition-all flex items-center gap-2"
                     >
                       <Trash2 className="w-3 h-3" /> BORRAR TABLA
                     </button>
                     <button 
                       onClick={() => setIsTableMaximized(false)}
                       className="px-6 py-3 bg-[#141414] text-white rounded-2xl text-[11px] font-black uppercase tracking-widest shadow-xl hover:scale-105 transition-all flex items-center gap-2"
                     >
                       <RefreshCw className="w-4 h-4 rotate-45" /> Volver al Formulario
                     </button>
                   </div>
                 </div>
               )}
               <div className="absolute top-0 right-0 p-4 pointer-events-none opacity-5">
                  <History className="w-32 h-32 text-[#141414]" />
               </div>
               <div className={cn(isTableMaximized ? "w-full overflow-x-auto" : "w-full")}>
                 <table className="w-full border-collapse relative z-10">
                  <thead>
                     <tr className="bg-[#141414]">
                        <th rowSpan={2} className="py-6 px-4 text-[10px] font-black uppercase tracking-widest text-white/40 text-center border-r border-white/5">Puntos Nominales</th>
                        <th rowSpan={2} className="py-6 px-4 text-[10px] font-black uppercase tracking-widest text-white/20 text-center border-r border-white/5">V. Ideal</th>
                        <th colSpan={2} className="py-3 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-blue-400 text-center border-b border-white/5 border-r border-white/5">Ciclo 1 (M1-M2)</th>
                        {calibrationInfo.showCycle2 && (
                          <th colSpan={calibrationInfo.hasM4 ? 2 : 1} className="py-3 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-purple-400 text-center border-b border-white/5 border-r border-white/5">
                            {calibrationInfo.hasM4 ? 'Ciclo 2 (M3-M4)' : 'Serie M3'}
                          </th>
                        )}
                        {calibrationInfo.showCycle3 && (
                          <th colSpan={calibrationInfo.hasM6 ? 2 : 1} className="py-3 px-4 text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400 text-center border-b border-white/5">
                            {calibrationInfo.hasM6 ? 'Ciclo 3 (M5-M6)' : 'Serie M5'}
                          </th>
                        )}
                     </tr>
                     <tr className="bg-[#141414] border-b border-[#141414]/10 shadow-lg">
                        <th className="py-3 px-4 text-[8px] font-bold uppercase text-blue-200/50 text-center border-r border-white/5">M1 (↑)</th>
                        <th className="py-3 px-4 text-[8px] font-bold uppercase text-blue-200/50 text-center border-r border-white/5">M2 (↓)</th>
                        {calibrationInfo.hasM3 && <th className="py-3 px-4 text-[8px] font-bold uppercase text-purple-200/50 text-center border-r border-white/5">M3 (↑)</th>}
                        {calibrationInfo.hasM4 && <th className="py-3 px-4 text-[8px] font-bold uppercase text-purple-200/50 text-center border-r border-white/5">M4 (↓)</th>}
                        {calibrationInfo.hasM5 && <th className="py-3 px-4 text-[8px] font-bold uppercase text-emerald-200/50 text-center border-r border-white/5">M5 (↑)</th>}
                        {calibrationInfo.hasM6 && <th className="py-3 px-4 text-[8px] font-bold uppercase text-emerald-200/50 text-center">M6 (↓)</th>}
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/5">
                     {(() => {
                        const { uniqueNominals, totalCols } = calibrationInfo;
                        const numN = uniqueNominals.length;
                                    return uniqueNominals.map((nom, rowIdx) => {
                          const idealValue = calculateIdealOutput(nom);

                          const renderCell = (series: string, typeColor: string) => {
                            const p = points.find(p => Number(p.nominalValue) === Number(nom) && p.series === series);
                            const standardVal = p?.standardValue ?? '';
                            const instrumentVal = p?.instrumentValue ?? '';
                            
                            // Color logic for focus states
                            let focusColor = "focus-within:border-blue-400";
                            if (series === 'M3' || series === 'M4') focusColor = "focus-within:border-purple-400";
                            if (series === 'M5' || series === 'M6') focusColor = "focus-within:border-emerald-400";

                            return (
                              <td key={series} className={cn(
                                "p-2 border-r border-[#141414]/5 relative group min-w-[130px] bg-white hover:bg-gray-50 transition-colors",
                                isTableMaximized && "min-w-[170px]"
                              )}>
                                <div className="space-y-2">
                                  <div className="flex items-center gap-1.5 px-1 py-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                                    <span className="text-[7px] font-black text-[#141414]/20 uppercase w-6">Patrón</span>
                                    <input 
                                      type="text" 
                                      className="flex-1 bg-transparent border-b border-[#141414]/10 text-center font-mono text-[10px] font-bold text-[#141414] outline-none focus:border-blue-400 transition-all px-1"
                                      value={standardVal}
                                      placeholder={nom.toString()}
                                      onChange={e => updatePointValue(nom, series, 'standardValue', e.target.value)}
                                    />
                                  </div>
                                  <div className={cn(
                                    "flex items-center gap-1.5 bg-[#F5F5F0]/40 rounded-xl p-2.5 border-2 border-transparent transition-all",
                                    focusColor,
                                    "group-hover:border-[#141414]/5"
                                  )}>
                                    <span className={cn("text-[7px] font-black uppercase w-6", typeColor)}>Lector</span>
                                    <input 
                                      type="text" 
                                      className={cn(
                                        "w-full bg-transparent text-center font-mono text-[14px] font-black outline-none",
                                        typeColor
                                      )}
                                      value={instrumentVal}
                                      placeholder="0.000"
                                      onChange={e => updatePointValue(nom, series, 'instrumentValue', e.target.value)}
                                    />
                                  </div>
                                </div>
                              </td>
                            );
                          };

                          return (
                            <tr key={rowIdx} className="group hover:bg-blue-50/5 transition-all">
                               <td className="py-4 px-4 text-center border-r border-[#141414]/5 bg-[#F5F5F0]/20 min-w-[100px]">
                                  <div className="flex flex-col items-center gap-1">
                                     <input 
                                       type="number" 
                                       step="any"
                                       className="w-full bg-transparent text-center font-mono text-xs font-black text-[#141414] border-b border-transparent hover:border-[#141414]/10 focus:border-blue-400 outline-none transition-all"
                                       value={nom}
                                       onChange={e => {
                                         const val = parseNum(e.target.value);
                                         if (!isNaN(val)) updateNominalValue(nom, val);
                                       }}
                                     />
                                     <span className="text-[8px] font-bold text-[#141414]/20 uppercase">{(data.metadata as any).unit}</span>
                                  </div>
                               </td>
                               <td className="py-4 px-4 text-center border-r border-[#141414]/5 font-mono text-[10px] font-black text-[#141414]/30 bg-gray-50/30">
                                  {idealValue.toFixed(4)}
                                  <span className="block text-[7px] font-bold uppercase mt-0.5">{(data.metadata as any).outputUnit}</span>
                               </td>
                               {renderCell("M1", "text-blue-700")}
                               {renderCell("M2", "text-blue-500")}
                               {calibrationInfo.hasM3 && renderCell("M3", "text-purple-700")}
                               {calibrationInfo.hasM4 && renderCell("M4", "text-purple-500")}
                               {calibrationInfo.hasM5 && renderCell("M5", "text-emerald-700")}
                               {calibrationInfo.hasM6 && renderCell("M6", "text-emerald-500")}
                            </tr>
                          );
                        });
                     })()}
                  </tbody>
               </table>
              </div>
            </div>

            {/* Linearity Trend Chart */}
            {points.length > 0 && points.some(p => p.instrumentValue) && (
              <div className="p-8 bg-blue-50/10 rounded-[2.5rem] border border-blue-100/50 space-y-4">
                <div className="flex items-center gap-2 px-1">
                  <Activity className="w-4 h-4 text-blue-500" />
                  <h5 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#141414]">Tendencia de Calibración (Linealidad)</h5>
                </div>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={points
                      .filter(p => p.instrumentValue && !isNaN(parseFloat(p.instrumentValue)))
                      .map(p => ({ 
                        standard: parseFloat(p.standardValue) || 0, 
                        instrument: parseFloat(p.instrumentValue) || 0,
                        series: p.series 
                      }))
                      .sort((a,b) => a.standard - b.standard)
                    }>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} strokeOpacity={0.1} />
                      <XAxis 
                        dataKey="standard" 
                        type="number" 
                        domain={points.length > 0 ? ['dataMin', 'dataMax'] : [0, 100]}
                        tick={{fontSize: 10, fontWeight: 700}} 
                        label={{ value: (data.metadata as any).unit || '', position: 'insideBottomRight', offset: -5, fontSize: 10, fontWeight: 900 }}
                        strokeOpacity={0.1}
                      />
                      <YAxis 
                        type="number" 
                        domain={points.length > 0 ? ['dataMin', 'dataMax'] : [4, 20]}
                        tick={{fontSize: 10, fontWeight: 700}} 
                        label={{ value: (data.metadata as any).outputUnit || 'mA', angle: -90, position: 'insideLeft', fontSize: 10, fontWeight: 900 }}
                        strokeOpacity={0.1}
                      />
                      <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontSize: '10px', fontWeight: 700 }} />
                      <Legend iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase' }} />
                      <Line name="Instrumento (mA/V)" type="monotone" dataKey="instrument" stroke="#2563eb" strokeWidth={3} dot={{r: 4, fill: '#2563eb', strokeWidth: 0}} activeDot={{r: 6}} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between px-4">
               <button type="button" onClick={addPoint} className="flex items-center gap-2 px-6 py-3 bg-white border border-[#141414]/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[#141414]/40 hover:text-blue-600 hover:border-blue-200 transition-all shadow-sm"><Plus className="w-3.5 h-3.5" /> Punto Manual</button>
               <p className="text-[9px] font-bold text-[#141414]/20 uppercase tracking-widest">
                  Secuencias: M1/M3/M5 (Ascendente) | M2/M4/M6 (Descendente) según {(data.metadata as any)?.norm || 'DKD-R 6-1'}
               </p>
            </div>
          </section>

          {/* Section 7: Informe de Resultados (ISO 17025) */}
          {pointResults.length > 0 && (
            <section className="space-y-6 pt-10 border-t border-[#141414]/10">
              <div className="flex items-center gap-2 px-1">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.5)]" />
                <h4 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#141414]">7. Informe de Resultados (ISO/IEC 17025)</h4>
              </div>

              <div className="overflow-hidden bg-white rounded-[2rem] border border-[#141414]/10 shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#141414]/5 border-b border-[#141414]/10">
                        <th className="py-5 px-8 text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Punto Nominal</th>
                        <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Val. Referencia</th>
                        <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-amber-600">Corriente (mA)</th>
                        <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-blue-600">Equiv. Presión</th>
                        <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-red-600 text-center">Error</th>
                        <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-emerald-600 text-center">Incertidumbre (U)</th>
                        <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-purple-600 text-center">EMP (Tol.)</th>
                        <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-[#141414]/40 text-center">Conformidad</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#141414]/5">
                      {pointResults.map((res: any, i: number) => {
                        // 1. DETERMINISTIC EMP CALCULATION (NORMAS)
                        const standard = (data.metadata as any)?.norm || 'IEC 60770';
                        const accuracyClass = data.metadata?.accuracyClass || '0.5';
                        
                        const rangeMax = parseFloat((data.metadata as any).calibrationRangeMax || data.metadata?.rangeMax || '100');
                        const rangeMin = parseFloat((data.metadata as any).calibrationRangeMin || data.metadata?.rangeMin || '0');
                        const span = Math.abs(rangeMax - rangeMin);
                        
                        let emp = 0;
                        const accuracy = parseFloat(accuracyClass);

                        if (standard.includes('ASME')) {
                          const grade = accuracyClass.toString().toUpperCase();
                          const percentOfSpan = ((res.nominal - rangeMin) / span) * 100;
                          if (grade === 'B' || grade === '2/3/2') emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.03 * span : 0.02 * span;
                          else if (grade === 'A' || grade === '1/2/1') emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.02 * span : 0.01 * span;
                          else if (grade === 'C' || grade === '3/4/3') emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.04 * span : 0.03 * span;
                          else if (grade === 'D' || grade === '5/5/5') emp = 0.05 * span;
                          else emp = (accuracy / 100) * span;
                        } else {
                          emp = (accuracy / 100) * span;
                        }
                        
                        const isCompliant = (Math.abs(res.error) + res.uExp) <= (emp + 1e-10);
                        
                        const group = points.filter(p => p.nominalValue === res.nominal);
                        const maReadings = group.map(p => parseFloat(p.instrumentValue.toString().replace(',','.')) || 0).filter(v => !isNaN(v));
                        const meanMA = maReadings.length > 0 ? maReadings.reduce((a,b) => a+b, 0) / maReadings.length : 0;

                        return (
                          <tr key={i} className="group hover:bg-[#F5F5F0]/30 transition-all">
                            <td className="py-4 px-8 font-mono text-xs font-bold text-[#141414]">
                              {(res.nominal || 0).toFixed(2)} <span className="text-[10px] opacity-20 ml-1">{(data.metadata as any).unit}</span>
                            </td>
                            <td className="py-4 px-4 font-mono text-xs text-[#141414]/70">{(res.refCorrected || 0).toFixed(5)}</td>
                            <td className="py-4 px-4 font-mono text-xs font-bold text-amber-700 bg-amber-50/10">{(meanMA || 0).toFixed(5)}</td>
                            <td className="py-4 px-4 font-mono text-xs font-bold text-blue-700 bg-blue-50/10">{(res.pressureEquivalent || 0).toFixed(5)}</td>
                            <td className="py-4 px-4 font-mono text-xs font-black text-red-600 text-center bg-red-50/10">
                              {res.error > 0 ? '+' : ''}{(res.error || 0).toFixed(5)}
                            </td>
                            <td className="py-4 px-4 font-mono text-xs font-black text-emerald-600 text-center bg-emerald-50/10">±{(res.uExp || 0).toFixed(5)}</td>
                            <td className="py-4 px-4 font-mono text-xs font-bold text-purple-600 text-center bg-purple-50/10">{(emp || 0).toFixed(5)}</td>
                            <td className="py-4 px-4 text-center">
                              <span className={cn(
                                "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter",
                                isCompliant ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                              )}>
                                {isCompliant ? 'Conforme' : 'No Conforme'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#141414] p-6 rounded-[2rem] text-white space-y-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Status Metrológico</span>
                  </div>
                  <div>
                    <p className="text-2xl font-black italic uppercase tracking-tighter">
                      {pointResults.every((res: any) => {
                        const accuracyClass = data.metadata?.accuracyClass || '0.5';
                        const rangeMax = parseFloat((data.metadata as any).calibrationRangeMax || data.metadata?.rangeMax || '100');
                        const rangeMin = parseFloat((data.metadata as any).calibrationRangeMin || data.metadata?.rangeMin || '0');
                        const span = Math.abs(rangeMax - rangeMin);
                        const emp = (parseFloat(accuracyClass) / 100) * span;
                        return (Math.abs(res.error) + res.uExp) <= (emp + 1e-10);
                      }) ? 'APTO' : 'NO APTO'}
                    </p>
                    <span className="text-[8px] font-bold opacity-40 uppercase">Veredicto Global ISO 17025</span>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[2rem] border border-[#141414]/10 space-y-4">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3 h-3 text-[#141414]/40" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#141414]/40">Parámetros BFSL</span>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-[#141414] uppercase leading-tight italic">
                      y = {uncertainty.bfsl?.m?.toFixed(6) || '0.000000'}x + {uncertainty.bfsl?.b?.toFixed(6) || '0.000000'}
                    </p>
                    <p className="text-[8px] font-bold text-[#141414]/40 uppercase mt-1">
                      Error Cero (f0): {uncertainty.contributions?.find((c: any) => c.source.includes('Cero'))?.value?.toFixed(4) || '0.0000'} {(data.metadata as any).outputUnit}
                    </p>
                    <p className="text-[8px] font-bold text-[#141414]/40 uppercase">
                      R²: {uncertainty.bfsl?.r2?.toFixed(6) || '0.000000'}
                    </p>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-[2rem] border border-[#141414]/10 space-y-4">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3 h-3 text-[#141414]/40" />
                    <span className="text-[9px] font-black uppercase tracking-widest text-[#141414]/40">Regla de Decisión / TUR</span>
                  </div>
                  <div>
                    <p className="text-[12px] font-black text-[#141414] uppercase leading-tight italic">
                      TUR: {(pointResults.reduce((acc: number, res: any) => {
                        const accuracyClass = data.metadata?.accuracyClass || '0.5';
                        const rangeMax = parseFloat((data.metadata as any).calibrationRangeMax || data.metadata?.rangeMax || '100');
                        const rangeMin = parseFloat((data.metadata as any).calibrationRangeMin || data.metadata?.rangeMin || '0');
                        const span = Math.abs(rangeMax - rangeMin);
                        const emp = (parseFloat(accuracyClass) / 100) * span;
                        return acc + (emp / (res.uExp || 0.0001));
                      }, 0) / pointResults.length).toFixed(1)}:1
                    </p>
                    <p className="text-[8px] font-bold text-[#141414]/40 uppercase mt-1">
                      ILAC-G8 / Banda de Guarda
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-amber-50/50 rounded-2xl border border-amber-100/50">
                <p className="text-[10px] text-amber-900/60 font-medium leading-relaxed uppercase tracking-tight">
                  * El error se calcula como la diferencia entre la indicación equivalente en presión del transmisor y el valor de referencia patrón corregido. 
                  La incertidumbre expandida se basa en un factor de cobertura k=2.
                  Unidad de medida: {(data.metadata as any).unit}.
                </p>
              </div>
            </section>
          )}

          {/* Section 8: Análisis Gráfico Metrológico */}
          {pointResults.length > 0 && (
            <section className="space-y-12">
              <div className="flex items-center gap-2 px-1">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-600 shadow-[0_0_8px_rgba(147,51,234,0.5)]" />
                <h4 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#141414]">8. Análisis Gráfico Metrológico</h4>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_0.6fr] gap-8">
                {/* 1. Curva de Error de Indicación */}
                <div className="bg-white p-8 rounded-[2.5rem] border border-[#141414]/10 shadow-sm space-y-6 flex flex-col h-full overflow-hidden">
                  <div>
                    <h5 className="text-[10px] font-black uppercase tracking-widest text-[#141414]">1. Curva de Error de Indicación</h5>
                    <p className="text-[9px] text-[#141414]/40 uppercase font-bold tracking-tight">Desviación frente a límites EMP</p>
                  </div>
                  
                  <div className="h-[480px] w-full flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      {(() => {
                        const rangeMax = parseFloat((data.metadata as any).calibrationRangeMax || data.metadata?.rangeMax || '100') || 100;
                        const rangeMin = parseFloat((data.metadata as any).calibrationRangeMin || data.metadata?.rangeMin || '0') || 0;
                        const span = Math.abs(rangeMax - rangeMin) || 1;
                        const accuracyVal = parseFloat((data.metadata as any).accuracyClass || '0.5');
                        const accuracy = isNaN(accuracyVal) ? 0.5 : accuracyVal;
                        
                        // Normalizamos datos para Graficar en % de SPAN
                        const chartData = [...pointResults]
                          .sort((a,b) => a.nominal - b.nominal)
                          .map(p => ({
                            ...p,
                            errorPercent: (p.error / span) * 100,
                            uPercent: (p.uExp / span) * 100
                          }))
                          .filter(p => !isNaN(p.errorPercent) && !isNaN(p.uPercent) && isFinite(p.errorPercent) && isFinite(p.uPercent));

                        return (
                          <LineChart
                            data={chartData}
                            margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#141414" strokeOpacity={0.05} />
                            <XAxis 
                              dataKey="nominal" 
                              type="number" 
                              domain={['auto', 'auto']} 
                              tick={{ fontSize: 9, fontWeight: 900, fill: '#141414' }}
                              tickFormatter={(value) => (value ?? 0).toFixed(1)}
                              axisLine={{ stroke: '#141414', strokeOpacity: 0.1 }}
                              label={{ value: (data.metadata as any).unit, position: 'insideBottomRight', offset: -5, fontSize: 10, fontWeight: 900 }}
                            />
                            <YAxis 
                              tick={{ fontSize: 9, fontWeight: 900, fill: '#141414' }}
                              tickFormatter={(value) => {
                                const val = parseFloat(value);
                                return isNaN(val) ? "0.000" : val.toFixed(3);
                              }}
                              axisLine={{ stroke: '#141414', strokeOpacity: 0.1 }}
                              domain={[-(accuracy || 0.5) * 1.5, (accuracy || 0.5) * 1.5]}
                              label={{ value: 'ERROR (%)', angle: -90, position: 'insideLeft', fontSize: 10, fontWeight: 900, offset: 0 }}
                            />
                            <Tooltip 
                              cursor={{ stroke: '#141414', strokeOpacity: 0.1 }}
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const d = payload[0].payload;
                                  return (
                                    <div className="bg-[#141414] border border-none p-3 rounded-2xl shadow-2xl space-y-1">
                                      <div className="text-[8px] font-black text-white/40 uppercase tracking-widest leading-none">Punto: {d.nominal} {(data.metadata as any).unit}</div>
                                      <div className="text-[10px] font-black text-white italic">Error: {d.errorPercent.toFixed(4)}%</div>
                                      <div className="text-[9px] font-bold text-white/60">U(k=2): ±{d.uPercent.toFixed(4)}%</div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <ReferenceLine y={0} stroke="#141414" strokeWidth={1} strokeDasharray="5 5" strokeOpacity={0.1} />
                            <ReferenceLine y={accuracy} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 4" strokeOpacity={0.3} label={{ value: '+EMP', position: 'right', fontSize: 7, fontWeight: 900, fill: '#ef4444' }} />
                            <ReferenceLine y={-accuracy} stroke="#ef4444" strokeWidth={1} strokeDasharray="4 4" strokeOpacity={0.3} label={{ value: '-EMP', position: 'right', fontSize: 7, fontWeight: 900, fill: '#ef4444' }} />
                            
                            <Line 
                              name="Error" 
                              type="linear" 
                              dataKey="errorPercent" 
                              stroke="#2563eb" 
                              strokeWidth={3} 
                              dot={{ r: 4, fill: '#fff', stroke: '#2563eb', strokeWidth: 2 }}
                              activeDot={{ r: 6, fill: '#2563eb', stroke: '#fff', strokeWidth: 2 }}
                            >
                              <ErrorBar dataKey="uPercent" width={10} strokeWidth={2} stroke="#2563eb" strokeOpacity={0.3} />
                            </Line>
                          </LineChart>
                        );
                      })()}
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* 2. Analizador de Recta Real (BFSL) */}
                <div className="bg-[#141414] p-8 rounded-[2.5rem] border border-white/5 shadow-2xl space-y-6 flex flex-col h-full">
                  <div className="flex justify-between items-start">
                    <div>
                      <h5 className="text-[10px] font-black uppercase tracking-widest text-white/40">2. Analizador de Linealidad BFSL</h5>
                      <p className="text-[11px] text-white font-black uppercase tracking-tight mt-1">Comparativa Electrónica (4-20 mA)</p>
                    </div>
                  </div>

                  {/* Ecuación y Resultados en tiempo real (Estilo Imagen 2) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-white/5 rounded-2xl border border-white/10">
                    {(() => {
                      const sortedPoints = [...pointResults].sort((a,b) => a.nominal - b.nominal);
                      const lastP = sortedPoints[sortedPoints.length - 1];
                      const rangeMaxVal = parseFloat((data.metadata as any).calibrationRangeMax || '100');
                      const rangeMax = isNaN(rangeMaxVal) || rangeMaxVal === 0 ? 100 : rangeMaxVal;
                      const iNom = lastP ? (4 + (lastP.nominal / rangeMax * 16)) : 20.0;
                      const iReal = lastP?.meanReading || 20.0;
                      
                      return (
                        <>
                          <div className="space-y-1">
                             <span className="block text-[7px] text-white/40 uppercase font-black tracking-widest leading-none">Ecuación Real</span>
                             <span className="text-[9px] text-blue-400 font-mono font-black italic whitespace-nowrap overflow-hidden text-ellipsis">I={uncertainty.bfsl?.m?.toFixed(5)}·P+{uncertainty.bfsl?.b?.toFixed(4)}</span>
                          </div>
                          <div className="space-y-1">
                             <span className="block text-[7px] text-white/40 uppercase font-black tracking-widest leading-none">I Nominal</span>
                             <span className="text-[9px] text-white/60 font-mono font-black">{(iNom || 0).toFixed(3)} mA</span>
                          </div>
                          <div className="space-y-1">
                             <span className="block text-[7px] text-white/40 uppercase font-black tracking-widest leading-none">I Real (mA)</span>
                             <span className="text-[9px] text-white font-mono font-black">{(iReal || 0).toFixed(3)} mA</span>
                          </div>
                          <div className="space-y-1 text-right">
                             <span className="block text-[7px] text-white/40 uppercase font-black tracking-widest leading-none text-right">Error Máx</span>
                             <span className="text-[9px] text-red-500 font-mono font-black">
                               {uncertainty.bfsl?.maxDeviationPercent?.toFixed(3) || '0.000'}%
                             </span>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  <div className="h-[200px] w-full flex-1">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart
                        data={[...pointResults].sort((a,b) => a.nominal - b.nominal).map(p => {
                          const rMaxVal = parseFloat((data.metadata as any).calibrationRangeMax || '100');
                          const rMax = isNaN(rMaxVal) || rMaxVal === 0 ? 100 : rMaxVal;
                          return {
                            ...p,
                            nominalCurrent: 4 + (p.nominal / rMax * 16),
                            realCurrent: p.meanReading,
                            bfslTrend: (uncertainty.bfsl?.m || 0) * p.nominal + (uncertainty.bfsl?.b || 0)
                          };
                        })}
                        margin={{ top: 20, right: 30, left: 10, bottom: 20 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={true} horizontal={true} stroke="#ffffff" strokeOpacity={0.05} />
                        <XAxis 
                          dataKey="nominal" 
                          type="number"
                          tick={{ fontSize: 9, fontWeight: 700, fill: '#ffffff', opacity: 0.4 }}
                          axisLine={false}
                          label={{ value: `PRESIÓN`, position: 'bottom', fontSize: 9, fontWeight: 900, fill: '#ffffff', opacity: 0.2 }}
                        />
                        <YAxis 
                          domain={[4, 22]}
                          tick={{ fontSize: 9, fontWeight: 700, fill: '#ffffff', opacity: 0.4 }}
                          axisLine={false}
                          label={{ value: 'mA', angle: -90, position: 'left', fontSize: 9, fontWeight: 900, fill: '#ffffff', opacity: 0.2 }}
                        />
                        <Tooltip 
                          cursor={{ stroke: '#ffffff', strokeOpacity: 0.1 }}
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const data = payload[0].payload;
                              return (
                                <div className="bg-[#141414] border border-white/10 p-3 rounded-2xl shadow-2xl space-y-1">
                                  <div className="text-[8px] font-black text-white/40 uppercase tracking-widest text-center">Punto: {data.nominal}</div>
                                  <div className="flex flex-col items-center gap-1">
                                    <div className="text-[10px] font-black text-blue-400 italic">REAL: {(data.realCurrent || 0).toFixed(3)} mA</div>
                                    <div className="text-[9px] font-bold text-white/60">Nominal: {(data.nominalCurrent || 0).toFixed(3)} mA</div>
                                  </div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        
                        {/* Recta Ideal 4-20mA (Dashed) */}
                        <Line 
                          name="Respuesta Ideal (4-20mA)" 
                          type="monotone" 
                          dataKey="nominalCurrent" 
                          stroke="#ffffff" 
                          strokeWidth={1} 
                          strokeDasharray="5 5" 
                          strokeOpacity={0.2}
                          dot={false}
                        />

                        {/* Recta Real BFSL (Trend Line) */}
                        <Line 
                          name="Regresión BFSL" 
                          type="monotone" 
                          dataKey="bfslTrend" 
                          stroke="#2563eb" 
                          strokeWidth={1} 
                          strokeOpacity={0.4}
                          dot={false}
                        />
                        
                        {/* Lecturas Reales (Puntos) */}
                        <Line 
                          name="Respuesta Real" 
                          type="monotone" 
                          dataKey="realCurrent" 
                          stroke="#2563eb" 
                          strokeWidth={3} 
                          dot={{ r: 4, fill: '#141414', stroke: '#2563eb', strokeWidth: 2 }}
                          activeDot={{ r: 6, fill: '#2563eb', stroke: '#fff', strokeWidth: 2 }}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Panel de Fórmulas para PLC */}
                  <div className="bg-white/5 rounded-[2rem] p-5 border border-white/10 space-y-4">
                     <div className="flex items-center gap-2">
                        <Zap className="w-3 h-3 text-blue-400" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-white/60">Escalado PLC</span>
                     </div>
                     <div className="space-y-3">
                        <div className="space-y-1">
                          <p className="text-[7px] font-bold text-white/30 uppercase tracking-widest">Opción 1: Ideal</p>
                          <div className="font-mono text-[9px] text-white/80 p-2 bg-white/5 rounded-xl border border-white/5">
                            P = (I - 4.0) / {((16) / (parseFloat((data.metadata as any).calibrationRangeMax || '100'))).toFixed(6)}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[7px] font-bold text-blue-400/50 uppercase tracking-widest">Opción 2: Corregida BFSL</p>
                          <div className="font-mono text-[9px] text-blue-400 p-2 bg-blue-500/10 rounded-xl border border-blue-400/20">
                            P = (I - {uncertainty.bfsl?.b?.toFixed(4) || '4.0000'}) / {uncertainty.bfsl?.m?.toFixed(6) || '0.160000'}
                          </div>
                        </div>
                     </div>
                     <p className="text-[8px] text-white/20 uppercase font-medium italic">
                        * Utilizar los valores reales (BFSL) permite compensar desviaciones sistemáticas de cero y spam mediante software sin necesidad de ajuste físico del hardware.
                     </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Action Footer */}
          <div className="pt-10 border-t border-[#141414]/10 flex flex-wrap justify-between items-center gap-6">
            <div className="flex gap-4">
              <button type="button" onClick={onCancel} className="px-8 py-5 text-xs font-black uppercase tracking-widest text-[#141414]/40 hover:text-[#141414] transition-colors">Cancelar</button>
              <button type="button" onClick={previewCertificate} className="px-8 py-5 border-2 border-[#141414]/10 rounded-3xl text-xs font-black uppercase tracking-widest text-[#141414]/60 hover:bg-[#F5F5F0] transition-all flex items-center gap-2"><FileText className="w-3.5 h-3.5" /> Previa PDF</button>
              <button type="button" onClick={exportToXML} className="px-8 py-5 bg-emerald-50 border-2 border-emerald-100 rounded-3xl text-xs font-black uppercase tracking-widest text-emerald-700 hover:bg-emerald-100 transition-all flex items-center gap-2 shadow-sm"><Zap className="w-3.5 h-3.5" /> Exportar XML</button>
            </div>
            
            <div className="flex gap-4">
              {lastSaved && <span className="text-[10px] font-black text-emerald-600 self-center uppercase tracking-widest mr-4 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100">Autoguardado: {new Date(lastSaved).toLocaleTimeString()}</span>}
              <button type="button" onClick={handleSaveDraft} disabled={isSavingDraft || status === CalibrationStatus.PUBLISHED} className="px-10 py-5 bg-white border-4 border-[#141414] rounded-full font-black text-xs uppercase tracking-[0.3em] hover:bg-[#141414] hover:text-white transition-all shadow-xl">{isSavingDraft ? 'Procesando...' : 'Guardar Progreso'}</button>
              <button type="submit" disabled={status === CalibrationStatus.PUBLISHED} className="bg-[#141414] text-white px-14 py-5 rounded-full font-black text-xs uppercase tracking-[0.3em] shadow-2xl hover:scale-105 active:scale-95 transition-all overflow-hidden relative group">
                <span className="relative z-10">Finalizar Captura</span>
                <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 opacity-0 group-hover:opacity-20 transition-opacity" />
              </button>
            </div>
          </div>
        </fieldset>
      </form>
    </div>
  );

  async function handleSaveDraft() {
    setIsSavingDraft(true);
    try {
      const id = initialData?.id || crypto.randomUUID();
      const calibration: CalibrationData = {
        ...data,
        id,
        status: CalibrationStatus.DRAFT,
        metadata: {
          ...data.metadata,
          referenceStandardIds: selectedStandardIds,
          ...auxEquipment
        } as any,
        measurements: points.map(p => ({
          ...p,
          standardValue: parseFloat(p.standardValue.toString()) || 0,
          instrumentValue: parseFloat(p.instrumentValue.toString()) || 0
        })),
        updatedAt: Date.now(),
        technicianId: user?.id || 'anonymous',
        technicianName: user?.name,
        technicianEmail: user?.email
      } as any;
      await db.calibrations.put(calibration);
      setLastSaved(Date.now());
      alert('Borrador guardado exitosamente.');
    } finally { 
      setIsSavingDraft(false); 
    }
  }
}
