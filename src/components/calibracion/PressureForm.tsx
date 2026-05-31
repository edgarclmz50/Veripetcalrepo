import React, { useState, useEffect } from 'react';
import { CalibrationData, Measurement, CalibrationMetadata, CalibrationStatus, LogEntry, UncertaintyResults } from '../../types';
import { 
  LineChart, 
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
import { Save, Plus, Trash2, Calculator, History, Clock, User, FileText, RefreshCw, Zap, Settings2, Wind, Thermometer, Droplets, MapPin, Ruler, AlertCircle, Send, ShieldCheck, CheckCircle2, XCircle, Activity, ArrowLeft } from 'lucide-react';
import { db } from '../../lib/db';
import { cn } from '../../lib/utils';
import { getAuthUser } from '../../lib/auth';
import { syncService } from '../../lib/SyncService';
import { PressureCalibrator, generarPuntosCalibracion, determinarSecuenciaDKD, AireCIPM } from '../../services/calibrationLogic';
import { generateDraftCertificate } from '../../lib/certificateGenerator';

interface PressureFormProps {
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

export function PressureForm({ initialData, onCancel, onSuccess }: PressureFormProps) {
  const user = getAuthUser();
  const [data, setData] = useState<Partial<CalibrationData>>({
    clientName: initialData?.clientName || '',
    instrumentTag: initialData?.instrumentTag || '',
    instrumentDescription: initialData?.instrumentDescription || '',
    workOrderId: initialData?.workOrderId || (initialData?.metadata as any)?.workOrderId || '',
    instrumentId: initialData?.instrumentId || '',
    magnitude: 'pressure',
    metadata: {
      rangeMin: (initialData?.metadata as any)?.rangeMin ?? 0,
      rangeMax: (initialData?.metadata as any)?.rangeMax ?? 100,
      nominalRangeMin: (initialData?.metadata as any)?.nominalRangeMin ?? (initialData?.metadata as any)?.rangeMin ?? 0,
      nominalRangeMax: (initialData?.metadata as any)?.nominalRangeMax ?? (initialData?.metadata as any)?.rangeMax ?? 100,
      calibrationRangeMin: (initialData?.metadata as any)?.calibrationRangeMin ?? (initialData?.metadata as any)?.rangeMin ?? 0,
      calibrationRangeMax: (initialData?.metadata as any)?.calibrationRangeMax ?? (initialData?.metadata as any)?.rangeMax ?? 100,
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
      resolution: (initialData?.metadata as any)?.resolution || 0.1,
      accuracyClass: (initialData?.metadata as any)?.accuracyClass || '1.0',
      subcategory: (initialData?.metadata as any)?.subcategory || 'analog_gauge',
      methodology: (initialData?.metadata as any)?.methodology || 
                   ((initialData?.metadata as any)?.subcategory === 'digital_gauge' ? 'digital' : 'analog'),
      ambientTemp: (initialData?.metadata as any)?.ambientTemp || 20,
      humidity: (initialData?.metadata as any)?.humidity || 50,
      pressureAtmHpa: (initialData?.metadata as any)?.pressureAtmHpa || 1013.25,
      gravity: (initialData?.metadata as any)?.gravity || 9.77,
      fluid: (initialData?.metadata as any)?.fluid || 'Aire',
      uncertaintyMethod: (initialData?.metadata as any)?.uncertaintyMethod || 'GUM',
      heightPatternMm: (initialData?.metadata as any)?.heightPatternMm || 0,
      heightInstrumentMm: (initialData?.metadata as any)?.heightInstrumentMm || 0,
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
        
        // EQUIPO AUXILIAR
        { id: 'AUX-001', alias: 'Termohigrómetro Ref (Vaisala)', tipo: 'termo', accuracyClass: '0.5', unit: '°C/%RH', brand: 'Vaisala', model: 'HM40' },
        { id: 'AUX-002', alias: 'Barómetro Precisión (Setra)', tipo: 'barometro', accuracyClass: '0.01', unit: 'hPa', brand: 'Setra', model: '270' },
        
        // GENERADORES DE PRESIÓN
        { id: 'GEN-001', alias: 'Bomba Neumática Precisión -14/600 psi', tipo: 'generador', brand: 'Additel', model: '916' },
        { id: 'GEN-002', alias: 'Bomba Hidráulica 15,000 psi', tipo: 'generador', brand: 'Additel', model: '937' },
        { id: 'GEN-003', alias: 'Comparador de Pesos Muertos Hidráulico', tipo: 'generador', brand: 'Ashcroft', model: '1305D' }
      ];
      
      // Use put to ensure these specific IDs exist without wiping other user data
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
    // Fill configuration for an analog gauge example
    setData({
      ...data,
      metadata: {
        ...data.metadata!,
        accuracyClass: "1.0",
        rangeMin: 0,
        rangeMax: 100,
        unit: 'psi',
        resolution: 1,
        uncertaintyMethod: 'gum',
        ambientTemp: 21.8,
        humidity: 50,
        pressureAtmHpa: 1012,
        gravity: 9.77,
        heightPatternMm: 150,
        heightInstrumentMm: 150,
        standard: 'EN 837-1',
        methodology: 'analog'
      } as any
    });

    // Fill points with realistic gauge readings
    const examplePoints = [
      { nominalValue: 0, instrumentValue: "0", standardValue: "0.00", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      { nominalValue: 20, instrumentValue: "20", standardValue: "20.15", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      { nominalValue: 40, instrumentValue: "40", standardValue: "40.25", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      { nominalValue: 60, instrumentValue: "60", standardValue: "60.30", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      { nominalValue: 80, instrumentValue: "80", standardValue: "80.10", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      { nominalValue: 100, instrumentValue: "100", standardValue: "99.85", series: "M1", direction: "ascending" as const, timestamp: Date.now() },
      
      { nominalValue: 100, instrumentValue: "100", standardValue: "99.75", series: "M2", direction: "descending" as const, timestamp: Date.now() },
      { nominalValue: 80, instrumentValue: "80", standardValue: "79.95", series: "M2", direction: "descending" as const, timestamp: Date.now() },
      { nominalValue: 60, instrumentValue: "60", standardValue: "60.10", series: "M2", direction: "descending" as const, timestamp: Date.now() },
      { nominalValue: 40, instrumentValue: "40", standardValue: "40.05", series: "M2", direction: "descending" as const, timestamp: Date.now() },
      { nominalValue: 20, instrumentValue: "20", standardValue: "19.98", series: "M2", direction: "descending" as const, timestamp: Date.now() },
      { nominalValue: 0, instrumentValue: "0", standardValue: "0.05", series: "M2", direction: "descending" as const, timestamp: Date.now() },
    ];
    setPoints(examplePoints);
    setTimeout(() => runCalculations(), 500);
  };

  const [isCalculating, setIsCalculating] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(120);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [lastSaved, setLastSaved] = useState<number | null>(initialData?.updatedAt || null);

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

  const generatePoints = () => {
    const m = data.metadata as any;
    const rMax = m.calibrationRangeMax !== undefined ? m.calibrationRangeMax : m.rangeMax;
    const rMin = m.calibrationRangeMin !== undefined ? m.calibrationRangeMin : m.rangeMin;
    const accuracy = parseFloat(m.accuracyClass);
    const seq = determinarSecuenciaDKD(accuracy);
    
    // Set suggested precharge cycles
    setData({
      ...data, 
      metadata: {
        ...data.metadata!, 
        inspection: {
          ...(data.metadata as any).inspection,
          precharge: { ...(data.metadata as any).inspection.precharge, cycles: seq.precargas, performed: true }
        }
      } as any
    });

    const nominals = generarPuntosCalibracion(accuracy, rMax, rMin);
    const newPoints: any[] = [];
    const isAnalog = (data.metadata as any)?.methodology === 'analog';
    
    // M1: Ascending Series
    nominals.forEach(n => {
      newPoints.push({ 
        nominalValue: n, 
        standardValue: "", 
        instrumentValue: "", 
        unit: (m.unit || 'psi'), 
        direction: 'ascending' as const, 
        timestamp: Date.now() 
      });
    });

    // M2: Descending Series
    [...nominals].reverse().forEach(n => {
      newPoints.push({ 
        nominalValue: n, 
        standardValue: "", 
        instrumentValue: "", 
        unit: (m.unit || 'psi'), 
        direction: 'descending' as const, 
        timestamp: Date.now() 
      });
    });

    // M3: Second Ascending Series (Only for A and B)
    if (seq.secuencia === 'A' || seq.secuencia === 'B') {
      nominals.forEach(n => {
        newPoints.push({ 
          nominalValue: n, 
          standardValue: "", 
          instrumentValue: "", 
          unit: (m.unit || 'psi'), 
          direction: 'ascending' as const, 
          timestamp: Date.now() 
        });
      });
    }

    // M4: Second Descending Series (Only for A)
    if (seq.secuencia === 'A') {
      [...nominals].reverse().forEach(n => {
        newPoints.push({ 
          nominalValue: n, 
          standardValue: "", 
          instrumentValue: "", 
          unit: (m.unit || 'psi'), 
          direction: 'descending' as const, 
          timestamp: Date.now() 
        });
      });
    }

    // M5 & M6: Third Cycle (Only for A if mounting dependent)
    if (seq.secuencia === 'A' && m.mountingDependent) {
      nominals.forEach(n => {
        newPoints.push({ nominalValue: n, standardValue: "", instrumentValue: "", unit: (m.unit || 'psi'), direction: 'ascending' as const, timestamp: Date.now() });
      });
      [...nominals].reverse().forEach(n => {
        newPoints.push({ nominalValue: n, standardValue: "", instrumentValue: "", unit: (m.unit || 'psi'), direction: 'descending' as const, timestamp: Date.now() });
      });
    }
    
    setPoints(newPoints);
  };

  const addPoint = () => {
    const m = data.metadata as any;
    const accuracy = parseFloat(m.accuracyClass || '1.0');
    const seq = determinarSecuenciaDKD(accuracy);
    const unit = m.unit || 'psi';
    const isMountingDep = m.mountingDependent;
    
    // Suggest next nominal based on range or existing points
    const currentNominals = points.map(p => p.nominalValue);
    const maxNominal = currentNominals.length > 0 ? Math.max(...currentNominals) : 0;
    const rMax = m.calibrationRangeMax !== undefined ? m.calibrationRangeMax : m.rangeMax;
    const nextNominal = maxNominal < rMax ? Math.min(rMax, maxNominal + (rMax / (seq.minPuntos - 1))) : maxNominal + 1;

    const newPointsRow: any[] = [];
    const count = isMountingDep ? (seq.secuencia === 'A' ? 6 : (seq.secuencia === 'B' ? 3 : 2)) : (seq.secuencia === 'A' ? 4 : (seq.secuencia === 'B' ? 3 : 2));
    
    for (let i = 1; i <= count; i++) {
      const isAsc = i % 2 !== 0;
      newPointsRow.push({
        nominalValue: nextNominal,
        standardValue: "", // Clean for manual input
        instrumentValue: "", // Clean for manual input
        unit: unit,
        direction: isAsc ? 'ascending' : 'descending',
        timestamp: Date.now()
      });
    }
    
    setPoints([...points, ...newPointsRow]);
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
    
    // SECTION 1: Datos del Instrumento
    if (!data.clientName?.trim()) errs.push('Identificación: El nombre del cliente es obligatorio.');
    if (!data.instrumentDescription?.trim()) errs.push('Sección 1: La Marca/Modelo del instrumento es obligatoria.');
    if (!data.instrumentTag?.trim()) errs.push('Sección 1: El N° Serie/Código del instrumento es obligatorio.');
    
    // SECTION 2: Metrología y Configuración
    const rNomMin = (data.metadata as any)?.nominalRangeMin ?? 0;
    const rNomMax = (data.metadata as any)?.nominalRangeMax ?? 0;
    if (rNomMin >= rNomMax && rNomMax !== 0) errs.push('Sección 2: El rango nominal mínimo debe ser menor al máximo.');
    if (rNomMax === 0 && !(data.metadata as any)?.nominalRangeMax) errs.push('Sección 2: El rango nominal máximo es obligatorio.');

    const rCalMin = (data.metadata as any)?.calibrationRangeMin ?? 0;
    const rCalMax = (data.metadata as any)?.calibrationRangeMax ?? 0;
    if (rCalMin >= rCalMax && rCalMax !== 0) errs.push('Sección 2: El rango de calibración mínimo debe ser menor al máximo.');
    
    if ((data.metadata?.resolution ?? 0) <= 0) errs.push('Sección 2: La resolución/división es obligatoria y debe ser positiva.');
    if (!data.metadata?.accuracyClass?.trim()) errs.push('Sección 2: La clase de exactitud es obligatoria.');
    if (!data.metadata?.fluid) errs.push('Sección 2: El fluido de trabajo es obligatorio.');

    // SECTION 3: Selección de Patrones y Equipos
    if (!selectedStandardIds[0]) errs.push('Sección 3: Debe seleccionar al menos un patrón de presión principal.');
    if (!auxEquipment.thermohygrometerId) errs.push('Sección 3: El termohigrómetro es obligatorio.');
    if (!auxEquipment.barometerId) errs.push('Sección 3: El barómetro es obligatorio.');
    if (!auxEquipment.pressureGeneratorId) errs.push('Sección 3: El generador de presión/bomba es obligatorio.');
    
    // SECTION 5: Condiciones Ambientales y Correcciones
    if ((data.metadata?.ambientTemp ?? 0) === 0) errs.push('Sección 5: La temperatura ambiente es obligatoria.');
    if ((data.metadata?.humidity ?? 0) <= 0) errs.push('Sección 5: La humedad relativa es obligatoria.');
    if ((data.metadata?.pressureAtmHpa ?? 0) <= 0) errs.push('Sección 5: La presión atmosférica es obligatoria.');
    if ((data.metadata?.gravity ?? 0) <= 0) errs.push('Sección 5: La gravedad local es obligatoria.');

    // SECTION 6: Mediciones
    if (points.length === 0) errs.push('Sección 6: Debe registrar al menos un punto de medición.');
    
    const pointsWithoutData = points.filter(p => {
      const sVal = parseFloat(p.standardValue?.toString() || "");
      const iVal = parseFloat(p.instrumentValue?.toString() || "");
      return isNaN(sVal) || isNaN(iVal) || p.standardValue === "" || p.instrumentValue === "";
    }).length;

    if (pointsWithoutData > 0) {
      errs.push(`Sección 6: Hay ${pointsWithoutData} mediciones con valores incompletos o vacíos.`);
    }

    setErrors(errs);
    return errs;
  };

  const runCalculations = async () => {
    setIsCalculating(true);
    setTimeout(async () => {
      try {
        // Use the first selected standard for primary correction logic for now
        const uncertaintyMethod = (data.metadata as any)?.uncertaintyMethod || 'GUM';
        const methodology = (data.metadata as any)?.methodology || 'digital';
        const isAnalog = methodology === 'analog';
        const selectedStandard = standards.find(s => s.id === selectedStandardIds[0]);
        const thermoStandard = standards.find(s => s.id === auxEquipment.thermohygrometerId);
        const baroStandard = standards.find(s => s.id === auxEquipment.barometerId);

        const calibrator = new PressureCalibrator(
          { ...data.metadata, unidad: (data.metadata as any)?.unit || 'psi' }, 
          { 
            presion: selectedStandard,
            termo: thermoStandard,
            barometro: baroStandard
          },
          data.metadata,
          { 
            metodo_incertidumbre: uncertaintyMethod,
            methodology: methodology
          }
        );

        const processedPoints = points.map(p => ({
          ...p,
          standardValue: parseFloat(p.standardValue.toString().replace(',', '.')) || 0,
          instrumentValue: parseFloat(p.instrumentValue.toString().replace(',', '.')) || 0
        }));

        const nominalPoints = (Array.from(new Set(processedPoints.map(p => p.nominalValue))) as number[]).sort((a,b) => a - b);
        const results = nominalPoints.map((n: number) => {
          const group = processedPoints.filter(p => p.nominalValue === n);
          if (group.length === 0) return null;

          // El valor nominal para el cálculo es el valor ajustado en la columna de referencia
          const referenceField = isAnalog ? 'instrumentValue' : 'standardValue';
          const readingField = isAnalog ? 'standardValue' : 'instrumentValue';
          
          const adjustedReference = group[0][referenceField as keyof typeof group[0]] as number;
          
          const asc = group.filter(p => p.direction === 'ascending').map(p => p[readingField as keyof typeof p] as number);
          const desc = group.filter(p => p.direction === 'descending').map(p => p[readingField as keyof typeof p] as number);
          
          return calibrator.procesarPunto(adjustedReference, asc, desc);
        }).filter(Boolean);

        if (results.length > 0) {
          setPointResults(results);
          const avgExp = results.reduce((acc, r) => acc + r!.uExp, 0) / results.length;
          setUncertainty({
            combined: avgExp / 2,
            expanded: avgExp,
            coverageFactor: 2,
            iterations: uncertaintyMethod === 'Monte Carlo' ? 20000 : 1,
            method: uncertaintyMethod === 'Monte Carlo' ? 'monte_carlo' : 'gum',
            contributions: results[0]!.uncertaintyComps ? [
              { source: 'Resolución Patrón', value: results[0]!.uncertaintyComps.uPat, distribution: 'rectangular' },
              { source: 'Repetibilidad', value: results[0]!.uncertaintyComps.uRep, distribution: 'normal' },
              { source: 'Histéresis', value: results[0]!.uncertaintyComps.uHist, distribution: 'rectangular' }
            ] : []
          });
        }
      } catch (error) {
        console.error("Calculation Error:", error);
        setErrors(['Error durante el cálculo metrológico. Verifique los datos de entrada.']);
      } finally {
        setIsCalculating(false);
      }
    }, 1000);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    // Si ya está publicado, no permitir cambios generales por este medio
    if (status === CalibrationStatus.PUBLISHED) {
      alert('Este registro ya está publicado y no admite modificaciones.');
      return;
    }

    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      alert(`⚠️ NO SE PUEDE FINALIZAR LA CAPTURA\nExisten errores críticos que deben corregirse.`);
      return;
    }
    
    const id = initialData?.id || crypto.randomUUID();
    
    try {
      const calibration: CalibrationData = {
        ...data,
        id,
        metadata: { 
          ...data.metadata, 
          referenceStandardId: selectedStandardIds[0],
          referenceStandardIds: selectedStandardIds,
          ...auxEquipment
        } as any,
        measurements: points.map(p => ({
          ...p,
          standardValue: parseFloat(p.standardValue.toString().replace(',', '.')) || 0,
          instrumentValue: parseFloat(p.instrumentValue.toString().replace(',', '.')) || 0
        })),
        status: CalibrationStatus.PRELIMINARY,
        uncertaintyResults: uncertainty,
        createdAt: initialData?.createdAt || Date.now(),
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
            message: `Captura finalizada exitosamente. Estado cambiado a PRELIMINAR.`,
            type: 'system'
          }
        ],
        notes
      } as any;
      
      // 1. Guardar calibración
      await db.calibrations.put(calibration);
      
      // 2. ACTUALIZAR ÓRDEN DE TRABAJO
      if (data.workOrderId && data.instrumentId) {
        const order = await db.workOrders.get(data.workOrderId);
        if (order) {
          const updatedInstruments = order.instruments.map(inst => 
            inst.id === data.instrumentId ? { ...inst, status: 'completed' as const } : inst
          );
          
          await db.workOrders.update(order.id, { 
            instruments: updatedInstruments as any,
            status: 'in_progress', // A segura que la orden esté marcada como iniciada
            updatedAt: Date.now()
          });
          
          // Registrar log en la orden
          const log: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: Date.now(),
            author: user?.name || 'Técnico',
            message: `Calibración finalizada para el equipo ${data.instrumentTag}. Estado: Preliminar.`,
            type: 'info'
          };
          await db.workOrders.update(order.id, { logs: [...(order.logs || []), log] });
        }
      }
      
      alert('✅ CAPTURA FINALIZADA EXITOSAMENTE\n\nEl registro ha sido guardado y movido al estado: PRELIMINAR.\nEl equipo ha sido marcado como COMPLETADO en la orden.');
      
      // Auto-generate XML on finish as requested
      exportToXML();
      
      onSuccess();
    } catch (err) {
      alert('❌ ERROR AL GUARDAR: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleStatusChange = async (newStatus: CalibrationStatus) => {
    if (!initialData?.id) {
      alert('Primero debe guardar el registro antes de cambiar de fase.');
      return;
    }

    const messageMap: Record<CalibrationStatus, string> = {
      [CalibrationStatus.DRAFT]: 'Retornado a Borrador',
      [CalibrationStatus.PRELIMINARY]: 'Captura Finalizada (Preliminar)',
      [CalibrationStatus.IN_REVIEW]: 'Enviado a Revisión de Calidad',
      [CalibrationStatus.PUBLISHED]: 'Calibración Aprobada y Publicada'
    };

    try {
      const historyEntry: LogEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        author: user?.name || 'Usuario',
        message: `Fase cambiada a: ${messageMap[newStatus]}`,
        type: 'system'
      };

      await db.calibrations.update(initialData.id, {
        status: newStatus,
        updatedAt: Date.now(),
        history: [...(initialData.history || []), historyEntry]
      });

      // Encolar sincronización si es un estado que requiere envío al servidor
      if (newStatus === CalibrationStatus.IN_REVIEW || newStatus === CalibrationStatus.PUBLISHED) {
        await syncService.enqueue('save_calibration', { 
          calibrationId: initialData.id,
          workOrderId: initialData.workOrderId 
        });
      }

      setStatus(newStatus);
      alert(`✅ Tránsito exitoso: ${messageMap[newStatus]}`);
      
      if (newStatus === CalibrationStatus.PUBLISHED || newStatus === CalibrationStatus.IN_REVIEW) {
        onSuccess();
      }
    } catch (err) {
      alert('Error al cambiar de fase: ' + err);
    }
  };

  const handleSaveDraft = async () => {
    const validationErrors = validateForm();
    if (validationErrors.length > 0) {
      alert('⚠️ NO SE PUEDE GUARDAR EL BORRADOR\n\nDebe completar primero todos los campos críticos en las secciones 1, 2 y 5.');
      return;
    }

    setIsSavingDraft(true);
    const id = initialData?.id || crypto.randomUUID();
    const now = Date.now();
    
    try {
      const calibration: CalibrationData = {
        ...data,
        id,
        metadata: { 
          ...data.metadata, 
          referenceStandardId: selectedStandardIds[0],
          referenceStandardIds: selectedStandardIds,
          ...auxEquipment
        } as any,
        measurements: points.map(p => ({
          ...p,
          standardValue: p.standardValue ? (parseFloat(p.standardValue.toString().replace(',', '.')) || 0) : 0,
          instrumentValue: p.instrumentValue ? (parseFloat(p.instrumentValue.toString().replace(',', '.')) || 0) : 0
        })),
        status: CalibrationStatus.DRAFT,
        uncertaintyResults: uncertainty,
        createdAt: initialData?.createdAt || now,
        updatedAt: now,
        technicianId: user?.id || 'anonymous',
        technicianName: user?.name,
        technicianEmail: user?.email,
        notes
      } as any;

      await db.calibrations.put(calibration);
      
      setLastSaved(now);
      alert('💾 BORRADOR GUARDADO\n\nEl registro se mantiene en estado: BORRADOR y está disponible para continuar después.');
    } catch (err) {
      alert('❌ ERROR AL GUARDAR BORRADOR: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSavingDraft(false);
    }
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

    const sanitizeTagName = (name: string) => {
      if (!name) return 'field';
      let sanitized = name.replace(/[^a-zA-Z0-9_.-]/g, '_');
      if (/^[0-9.-]/.test(sanitized)) sanitized = 'field_' + sanitized;
      return sanitized;
    };

    const buildNode = (name: string, value: any): string => {
      const tagName = sanitizeTagName(name);
      if (value === null || value === undefined) return `<${tagName}/>`;
      
      if (Array.isArray(value)) {
        return `<${tagName}>${value.map(item => buildNode('Item', item)).join('')}</${tagName}>`;
      }
      
      if (typeof value === 'object') {
        const entries = Object.entries(value);
        if (entries.length === 0) return `<${tagName}/>`;
        return `<${tagName}>${entries.map(([k, v]) => buildNode(k, v)).join('')}</${tagName}>`;
      }
      
      return `<${tagName}>${escape(value)}</${tagName}>`;
    };

    const xmlData = {
      Header: {
        IsPrimaryRecord: 'true',
        Version: '2.0',
        RecordId: data.id,
        GenerationTimestamp: new Date().toISOString(),
        Technician: {
          Id: user?.id || 'unknown',
          Name: user?.name || 'Anonymous'
        }
      },
      GeneralInfo: {
        Status: status,
        Client: data.clientName,
        WorkOrderId: data.workOrderId,
        Magnitude: data.magnitude,
        Notes: notes
      },
      Instrument: {
        Tag: data.instrumentTag,
        Description: data.instrumentDescription,
        Id: data.instrumentId,
        Manufacturer: (data.metadata as any)?.manufacturer || 'N/A',
        Model: (data.metadata as any)?.model || 'N/A',
        Serial: (data.metadata as any)?.serialNumber || 'N/A',
        Type: (data.metadata as any)?.instrumentType || 'Analog/Digital',
        NominalRange: {
          Min: (data.metadata as any)?.nominalRangeMin,
          Max: (data.metadata as any)?.nominalRangeMax,
          Unit: (data.metadata as any)?.unit
        },
        CalibrationRange: {
          Min: (data.metadata as any)?.calibrationRangeMin,
          Max: (data.metadata as any)?.calibrationRangeMax,
          Unit: (data.metadata as any)?.unit
        },
        Metrology: {
          AccuracyClass: data.metadata?.accuracyClass,
          Resolution: data.metadata?.resolution,
          Methodology: (data.metadata as any)?.methodology,
          Subcategory: data.metadata?.subcategory
        }
      },
      EnvironmentalConditions: {
        AmbientTempC: data.metadata?.ambientTemp,
        HumidityPct: data.metadata?.humidity,
        PressureAtmHpa: data.metadata?.pressureAtmHpa,
        GravityMs2: data.metadata?.gravity,
        Fluid: {
          Name: data.metadata?.fluid,
          DensityKgM3: data.metadata?.fluidDensity || 1.18, // Default for air
          HeightCorrectionMm: {
            Pattern: data.metadata?.heightPatternMm,
            Instrument: data.metadata?.heightInstrumentMm,
            Net: ((data.metadata?.heightPatternMm || 0) - (data.metadata?.heightInstrumentMm || 0)).toFixed(2)
          }
        }
      },
      QualityChecklist: {
        VisualInspection: data.metadata?.inspectionVisualOk ? 'Passed' : 'Pending/Failed',
        LeakTest: data.metadata?.leakTestOk ? 'Passed' : 'Pending/Failed',
        Preloads: data.metadata?.preloadsOk ? 'Passed' : 'Pending/Failed'
      },
      Measurements: {
        PointCount: points.length,
        Unit: (data.metadata as any)?.unit,
        Data: points.map(p => {
          const error = p.instrumentValue - p.standardValue;
          return {
            Nominal: p.nominalValue,
            Standard: p.standardValue,
            Instrument: p.instrumentValue,
            Error: error.toFixed(4),
            Direction: p.direction,
            Timestamp: new Date(p.timestamp).toISOString()
          };
        })
      },
      SummaryResults: {
        MaxError: points.length > 0 ? Math.max(...points.map(p => Math.abs(p.instrumentValue - p.standardValue))).toFixed(4) : "0.0000",
        MeanError: points.length > 0 ? (points.reduce((acc, p) => acc + (p.instrumentValue - p.standardValue), 0) / points.length).toFixed(4) : "0.0000",
        Compliance: (data.metadata as any)?.complianceStatus || 'Not Evaluated',
        StabilityTest: data.metadata?.leakTestOk ? 'Stable' : 'Unstable/Not Tested'
      },
      UncertaintyAnalysis: uncertainty ? {
        Method: uncertainty.method || 'GUM',
        CoverageFactorV: (uncertainty.coverageFactor || 2).toFixed(2),
        CombinedUncertaintyUc: (uncertainty.combined || 0).toFixed(6),
        ExpandedUncertaintyU: (uncertainty.expanded || 0).toFixed(6),
        ConfidenceLevel: '95.45%',
        Budget: (uncertainty.contributions || []).map(c => ({
          Source: c.source,
          Value: (c.value || 0).toFixed(6),
          Distribution: c.distribution,
          Sensitivity: (c.sensitivityFactor || 1).toFixed(4),
          UncertaintyContribution: ((c.value || 0) * (c.sensitivityFactor || 1)).toFixed(6)
        }))
      } : 'No Calculated Uncertainty',
      FullMetadataDump: data.metadata // Keeping the original structure for compatibility
    };

    const xmlString = `<?xml version="1.0" encoding="UTF-8"?>\n<CalibrationPrimaryRecord>\n${Object.entries(xmlData).map(([k, v]) => buildNode(k, v)).join('')}\n</CalibrationPrimaryRecord>`;
    
    // Auto-download XML
    const blob = new Blob([xmlString], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PRIMARY_RECORD_${data.instrumentTag || 'INST'}_${new Date().toISOString().split('T')[0]}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const previewCertificate = async () => {
    const numericPoints = points.map(p => ({
      ...p,
      standardValue: parseFloat(p.standardValue.toString().replace(',', '.')) || 0,
      instrumentValue: parseFloat(p.instrumentValue.toString().replace(',', '.')) || 0
    }));
    const doc = await generateDraftCertificate({ ...data, measurements: numericPoints, uncertaintyResults: uncertainty } as any);
    window.open(doc.output('bloburl'), '_blank');
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
            <h3 className="text-xl font-bold text-[#141414]">Calibración de Presión</h3>
            <p className="text-sm text-[#141414]/60">Módulo metrológico avanzado - Instrumento Bajo Prueba (IBC)</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
            <select 
              className={cn(
                "border p-2 rounded-xl text-[10px] font-black uppercase outline-none transition-all shadow-sm",
                STATUS_INFO[status].color
              )}
              value={status}
              onChange={e => setStatus(e.target.value as CalibrationStatus)}
            >
              {Object.entries(STATUS_INFO).map(([value, info]) => (
                <option key={value} value={value}>{info.label}</option>
              ))}
            </select>
            <p className="text-[8px] text-[#141414]/40 max-w-[200px] text-right leading-tight font-medium">
              {STATUS_INFO[status].description}
            </p>
          </div>
      </div>

      <form onSubmit={handleSubmit} className="p-8 space-y-10">
        <fieldset disabled={status === CalibrationStatus.PUBLISHED} className="space-y-10 contents">
          {errors.length > 0 && (
            <div className="p-6 bg-red-50 border border-red-200 rounded-2xl space-y-3 animate-in slide-in-from-top-4 duration-300">
              <div className="flex items-center gap-2 text-red-600">
                <AlertCircle className="w-4 h-4" />
                <h5 className="text-[11px] font-black uppercase tracking-widest">Atención: Datos Faltantes o Inválidos</h5>
              </div>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
                {errors.map((err, i) => (
                  <li key={i} className="text-[10px] font-bold text-red-500 flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-red-400" />
                    {err}
                  </li>
                ))}
              </ul>
              <p className="text-[9px] font-medium text-red-400 pt-1 border-t border-red-100">
                Por favor, corrija estos puntos antes de finalizar la captura para asegurar la integridad de los resultados.
              </p>
            </div>
          )}

          {/* Datos de Cliente (Simplificado) */}
          <section className="p-6 bg-[#F5F5F0]/50 rounded-2xl border border-[#141414]/5">
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Nombre del Cliente</label>
                <input 
                  className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-sm"
                  value={data.clientName ?? ''}
                  onChange={e => setData({...data, clientName: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Orden de Trabajo</label>
                <input 
                  className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-mono text-sm"
                  value={data.workOrderId ?? ''}
                  onChange={e => setData({...data, workOrderId: e.target.value})}
                />
              </div>
            </div>
          </section>

        {/* SECTION 1: IDENTIFICACIÓN DEL INSTRUMENTO (IBC) */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-[#141414]" />
            <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">1. Datos del Instrumento (IBC)</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Instrumento</label>
              <select 
                className="w-full p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none font-medium text-sm"
                value={(data.metadata as any)?.instrumentType || 'MANÓMETRO'}
                onChange={e => setData({...data, metadata: {...data.metadata!, instrumentType: e.target.value} as any})}
              >
                {[
                  "MANÓMETRO ANÁLOGO", 
                  "MANÓMETRO DIGITAL", 
                  "MANOVACUÓMETRO", 
                  "VACUÓMETRO", 
                  "TRANSMISOR DE PRESIÓN",
                  "TRANSDUCTOR DE PRESIÓN",
                  "PRESOSTATO",
                  "REGISTRADOR DE PRESIÓN CARTOGRÁFICO",
                  "INDICADOR DE PRESIÓN",
                  "COLUMNA DE LÍQUIDO"
                ].map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Marca/Modelo</label>
              <input 
                className="w-full p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none font-medium text-sm"
                value={data.instrumentDescription ?? ''}
                onChange={e => setData({...data, instrumentDescription: e.target.value})}
                placeholder="Ej. Wika 232.50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">N° Serie/Código</label>
              <input 
                className="w-full p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none font-medium text-sm"
                value={data.instrumentTag ?? ''}
                onChange={e => setData({...data, instrumentTag: e.target.value})}
                placeholder="Ej. S/N 2024-001"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Ubicación</label>
              <input 
                className="w-full p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none font-medium text-sm"
                value={(data.metadata as any)?.location ?? ''}
                onChange={e => setData({...data, metadata: {...data.metadata!, location: e.target.value} as any})}
                placeholder="Sala de Compresores"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Tamaño/Diámetro</label>
              <input 
                className="w-full p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none font-medium text-sm"
                value={(data.metadata as any)?.size ?? ''}
                onChange={e => setData({...data, metadata: {...data.metadata!, size: e.target.value} as any})}
                placeholder="4 in"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Lugar de Calibración</label>
              <select 
                className="w-full p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none font-medium text-sm"
                value={(data.metadata as any)?.locationType || 'IN_SITU'}
                onChange={e => setData({...data, metadata: {...data.metadata!, locationType: e.target.value} as any})}
              >
                <option value="IN_SITU">In Situ</option>
                <option value="LABORATORIO">Laboratorio</option>
              </select>
            </div>
          </div>
        </section>

        {/* SECTION 2: METROLOGÍA Y CONFIGURACIÓN */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
            <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">2. Metrología y Configuración</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-4 gap-y-6">
            {/* Row 1: Basic Config */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Tipo de Indicación</label>
              <select 
                className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-xs h-[42px]"
                value={data.metadata?.subcategory}
                onChange={e => {
                  const val = e.target.value;
                  const methodology = val === 'analog_gauge' ? 'analog' : 'digital';
                  setData({
                    ...data, 
                    metadata: {
                      ...data.metadata!, 
                      subcategory: val,
                      methodology: methodology,
                      // Clear accuracy if switching to digital to prompt manual entry
                      accuracyClass: methodology === 'digital' ? '' : data.metadata?.accuracyClass
                    } as any
                  });
                }}
              >
                <option value="analog_gauge">Análogo (Aguja)</option>
                <option value="digital_gauge">Digital (Pantalla)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Metodología de Captura</label>
              <select 
                className="w-full h-[42px] px-3 bg-white border border-blue-100 rounded-xl outline-none text-[10px] font-black uppercase appearance-none"
                value={(data.metadata as any)?.methodology || 'digital'}
                onChange={e => {
                  const val = e.target.value;
                  setData({
                    ...data, 
                    metadata: {
                      ...data.metadata!, 
                      methodology: val,
                      accuracyClass: val === 'digital' ? '' : data.metadata?.accuracyClass
                    } as any
                  });
                }}
              >
                <option value="digital">Caso B: Set Patrón (Leer IBC)</option>
                <option value="analog">Caso A: Trazo IBC (Leer Patrón)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-blue-600 px-1">Unidad de Trabajo</label>
              <div className="relative p-1 bg-blue-50/30 border border-blue-100 rounded-xl">
                <select 
                  className="w-full px-3 bg-white border border-blue-200/50 rounded-lg outline-none font-bold text-xs h-[34px] appearance-none cursor-pointer pr-8"
                  value={(data.metadata as any)?.unit || 'psi'}
                  onChange={e => setData({...data, metadata: {...data.metadata!, unit: e.target.value} as any})}
                >
                  {["psi", "bar", "kPa", "MPa", "kgf/cm2", "mmHg", "inHg"].map(u => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                  <svg className="w-3 h-3 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Fluido de Trabajo</label>
              <select 
                className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-xs h-[42px]"
                value={data.metadata?.fluid}
                onChange={e => setData({...data, metadata: {...data.metadata!, fluid: e.target.value}})}
              >
                <option value="Aire">Aire</option>
                <option value="Aceite">Aceite</option>
                <option value="Nitrógeno">Nitrógeno</option>
                <option value="Agua">Agua</option>
              </select>
            </div>

            {/* Row 2: Ranges & Metrology */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-blue-600 px-1">Rango Nominal (IBC)</label>
              <div className="flex items-center gap-2">
                <input 
                  type="number" step="any"
                  className="w-1/2 p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-mono text-xs h-[42px]"
                  placeholder="Min"
                  value={(data.metadata as any)?.nominalRangeMin ?? ''}
                  onChange={e => {
                    const min = parseFloat(e.target.value) || 0;
                    const max = (data.metadata as any)?.nominalRangeMax || 0;
                    const res = data.metadata?.resolution || 0;
                    const span = Math.abs(max - min);
                    const isAnalog = (data.metadata as any)?.methodology === 'analog';
                    
                    let newAcc = data.metadata?.accuracyClass || '';
                    if (isAnalog && res > 0 && span > 0) {
                      newAcc = ((res / span) * 100).toFixed(2);
                    } else if (!isAnalog) {
                      newAcc = '';
                    }
                    
                    setData({...data, metadata: {...data.metadata!, nominalRangeMin: min, accuracyClass: newAcc} as any});
                  }}
                />
                <input 
                  type="number" step="any"
                  className="w-1/2 p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-mono text-xs h-[42px]"
                  placeholder="Max"
                  value={(data.metadata as any)?.nominalRangeMax ?? ''}
                  onChange={e => {
                    const max = parseFloat(e.target.value) || 0;
                    const min = (data.metadata as any)?.nominalRangeMin || 0;
                    const res = data.metadata?.resolution || 0;
                    const span = Math.abs(max - min);
                    const isAnalog = (data.metadata as any)?.methodology === 'analog';
                    
                    let newAcc = data.metadata?.accuracyClass || '';
                    if (isAnalog && res > 0 && span > 0) {
                      newAcc = ((res / span) * 100).toFixed(2);
                    } else if (!isAnalog) {
                      newAcc = '';
                    }
                    
                    setData({...data, metadata: {...data.metadata!, nominalRangeMax: max, accuracyClass: newAcc} as any});
                  }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 px-1">Rango Real de Calibración</label>
              <div className="flex items-center gap-2 p-1 bg-emerald-50/30 border border-emerald-100 rounded-xl">
                <input 
                  type="number" step="any"
                  className="w-1/2 px-3 bg-white border border-emerald-200/50 rounded-lg outline-none font-mono text-xs h-[34px]"
                  placeholder="Min"
                  value={(data.metadata as any)?.calibrationRangeMin ?? ''}
                  onChange={e => setData({...data, metadata: {...data.metadata!, calibrationRangeMin: parseFloat(e.target.value) || 0, rangeMin: parseFloat(e.target.value) || 0} as any})}
                />
                <input 
                  type="number" step="any"
                  className="w-1/2 px-3 bg-white border border-emerald-200/50 rounded-lg outline-none font-mono text-xs h-[34px]"
                  placeholder="Max"
                  value={(data.metadata as any)?.calibrationRangeMax ?? ''}
                  onChange={e => setData({...data, metadata: {...data.metadata!, calibrationRangeMax: parseFloat(e.target.value) || 0, rangeMax: parseFloat(e.target.value) || 0} as any})}
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">
                {(data.metadata as any)?.methodology === 'analog' ? 'Valor de División' : 'Resolución'}
              </label>
              <div className="relative">
                <input 
                  type="number" step="any"
                  className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-mono text-xs h-[42px]"
                  value={data.metadata?.resolution ?? ''}
                  onChange={e => {
                    const res = parseFloat(e.target.value) || 0;
                    const rMax = (data.metadata as any)?.nominalRangeMax || 1;
                    const rMin = (data.metadata as any)?.nominalRangeMin || 0;
                    const span = Math.abs(rMax - rMin);
                    const isAnalog = (data.metadata as any)?.methodology === 'analog';
                    
                    let newAccuracy = data.metadata?.accuracyClass || '';
                    if (isAnalog && res > 0 && span > 0) {
                      newAccuracy = ((res / span) * 100).toFixed(2);
                    } else if (!isAnalog) {
                      newAccuracy = '';
                    }
                    
                    setData({
                      ...data, 
                      metadata: {
                        ...data.metadata!, 
                        resolution: res,
                        accuracyClass: newAccuracy
                      }
                    });
                  }}
                />
                {(data.metadata as any)?.methodology === 'analog' && (data.metadata?.resolution ?? 0) > 0 && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[8px] font-black text-blue-600 bg-blue-50 px-2 py-1 rounded">
                    DIV
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">
                {(data.metadata as any)?.methodology === 'analog' ? 'Clase de Exactitud' : 'Exactitud (% FS)'}
              </label>
              <div className="relative">
                <input 
                  className={`w-full p-3 bg-white border rounded-xl outline-none font-mono text-xs h-[42px] ${
                    !(data.metadata as any)?.accuracyClass && (data.metadata as any)?.methodology === 'digital' 
                    ? 'border-red-500 bg-red-50' 
                    : 'border-[#141414]/10'
                  }`}
                  placeholder="Ej. 1.0"
                  value={data.metadata?.accuracyClass ?? ''}
                  onChange={e => setData({...data, metadata: {...data.metadata!, accuracyClass: e.target.value}})}
                />
                {(data.metadata as any)?.methodology === 'analog' && (
                  <button 
                    type="button"
                    onClick={() => {
                      const res = data.metadata?.resolution || 0;
                      const rMax = (data.metadata as any)?.nominalRangeMax || 1;
                      const rMin = (data.metadata as any)?.nominalRangeMin || 0;
                      const span = Math.abs(rMax - rMin);
                      if (res > 0 && span > 0) {
                        const calculated = (res / span) * 100;
                        setData({...data, metadata: {...data.metadata!, accuracyClass: calculated.toFixed(2)}});
                      }
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] underline text-blue-600 font-bold bg-blue-50 px-2 py-1 rounded"
                  >
                    Calcular
                  </button>
                )}
              </div>
            </div>

            {/* Row 3: Standards & Methods */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Normativa de Clase</label>
              <select 
                className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-xs h-[42px]"
                value={(data.metadata as any)?.normaClase || 'ASME_B40_100'}
                onChange={e => setData({...data, metadata: {...data.metadata!, normaClase: e.target.value} as any})}
              >
                <option value="ASME_B40_100">ASME B40.100 (F.S.)</option>
                <option value="EN_837_1">EN 837-1 (Span)</option>
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Efecto por Montaje</label>
              <div className="flex items-center h-[42px] px-3 bg-white border border-[#141414]/10 rounded-xl">
                <label className="flex items-center gap-2 cursor-pointer w-full">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded border-[#141414]/20"
                    checked={(data.metadata as any)?.mountingDependent || false}
                    onChange={e => setData({...data, metadata: {...data.metadata!, mountingDependent: e.target.checked} as any})}
                  />
                  <span className="text-[9px] font-black uppercase text-[#141414]/40 leading-none">Sí (Efecto A±)</span>
                </label>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Método de Incertidumbre</label>
              <select 
                className="w-full h-[42px] px-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-[10px] font-black uppercase appearance-none"
                value={(data.metadata as any)?.uncertaintyMethod || 'GUM'}
                onChange={e => setData({...data, metadata: {...data.metadata!, uncertaintyMethod: e.target.value} as any})}
              >
                <option value="GUM">GUM (Analítico)</option>
                <option value="Monte Carlo">Monte Carlo (Simulación)</option>
              </select>
            </div>
          </div>
        </section>

        {/* SECTION 3: SELECCIÓN DE PATRONES Y EQUIPOS */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">3. Selección de Patrones y Equipos</h4>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Patrones de Presión */}
            <div className="space-y-4 p-6 bg-[#F5F5F0]/50 rounded-2xl border border-[#141414]/5">
              <div className="flex justify-between items-center mb-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60">Patrones de Presión (Hasta 3)</label>
                <button 
                  type="button" 
                  onClick={addStandardSelector}
                  disabled={selectedStandardIds.length >= 3}
                  className="text-[9px] font-black uppercase text-blue-600 hover:underline disabled:opacity-30"
                >
                  + Añadir Patrón
                </button>
              </div>
              <div className="space-y-3">
                {selectedStandardIds.map((id, idx) => (
                  <div key={idx} className="flex flex-col gap-1">
                    <div className="flex gap-2">
                      <select 
                        className={`flex-1 p-3 bg-white border ${id && standards.find(s => s.id === id)?.rangeMax < parseFloat((data.metadata as any)?.nominalRangeMax || data.metadata?.rangeMax || '0') ? 'border-red-500 bg-red-50' : 'border-[#141414]/10'} rounded-xl outline-none font-medium text-xs shadow-sm`}
                        value={id}
                        onChange={e => updateStandardId(idx, e.target.value)}
                      >
                        <option value="">Seleccione patrón {idx + 1}...</option>
                        {standards
                          .filter(s => s.tipo === 'manometro')
                          .sort((a, b) => {
                            const met = data.metadata as any;
                            const nMax = parseFloat(met?.nominalRangeMax ?? met?.rangeMax ?? '0');
                            const coversA = (a.rangeMax >= nMax) ? 1 : 0;
                            const coversB = (b.rangeMax >= nMax) ? 1 : 0;
                            if (coversA !== coversB) return coversB - coversA;
                            return parseFloat(a.accuracyClass || '5') - parseFloat(b.accuracyClass || '5');
                          })
                          .map(s => {
                            const met = data.metadata as any;
                            const nMax = parseFloat(met?.nominalRangeMax ?? met?.rangeMax ?? '0');
                            const nMin = parseFloat(met?.nominalRangeMin ?? met?.rangeMin ?? '0');
                            const nSpan = Math.abs(nMax - nMin) || 100;
                            const accClass = data.metadata?.accuracyClass || '1.0';
                            
                            let uutEmp = 0;
                            const uutAcc = parseFloat(accClass);
                            if (isNaN(uutAcc)) {
                              const g = accClass.toString().toUpperCase();
                              if (g.includes('B') || g.includes('2/3/2')) uutEmp = 0.02 * nSpan;
                              else if (g.includes('A') || g.includes('1/2/1')) uutEmp = 0.01 * nSpan;
                              else if (g.includes('C') || g.includes('3/4/3')) uutEmp = 0.03 * nSpan;
                              else if (g.includes('D') || g.includes('5/5/5')) uutEmp = 0.05 * nSpan;
                              else uutEmp = 0.01 * nSpan;
                            } else {
                              uutEmp = (uutAcc / 100) * nSpan;
                            }
                            
                            const patAcc = parseFloat(s.accuracyClass || '1.0');
                            const patSpan = Math.abs(s.rangeMax - s.rangeMin) || 1;
                            const patUnc = (patAcc / 100) * patSpan;
                            const turMultiplier = patUnc > 0 ? (uutEmp / patUnc) : 0;
                            const displayTUR = turMultiplier >= 10 ? Math.round(turMultiplier).toString() : turMultiplier.toFixed(1);
                            
                            const covers = nMax > 0 && s.rangeMax >= (nMax * 0.95);
                            const isRecommended = covers && turMultiplier >= 3.9;
                            
                            return (
                              <option key={s.id} value={s.id}>
                                {isRecommended ? '⭐ ' : (!covers && nMax > 0 ? '⚠️ ' : '')}
                                {s.alias} ({s.rangeMax} {s.unidad}) - TUR {displayTUR}:1
                              </option>
                            );
                          })}
                      </select>
                      {idx > 0 && (
                        <button 
                          type="button" 
                          onClick={() => updateStandardId(idx, '')}
                          className="p-3 text-red-400 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    {id && (() => {
                      const selected = standards.find(s => s.id === id);
                      const met = data.metadata as any;
                      const nMax = parseFloat(met?.nominalRangeMax ?? met?.rangeMax ?? '0');
                      if (selected && nMax > 0 && selected.rangeMax < nMax) {
                        return <p className="text-[9px] text-red-600 font-black uppercase tracking-tighter ml-1 animate-pulse">⚠️ ¡ERROR CRÍTICO! Patrón ({selected.rangeMax}) insuficiente para equipo ({nMax})</p>;
                      }
                      return null;
                    })()}
                  </div>
                ))}
              </div>
            </div>

            {/* Equipos Auxiliares */}
            <div className="space-y-4 p-6 bg-[#F5F5F0]/50 rounded-2xl border border-[#141414]/5">
              <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60 block mb-2">Equipos Auxiliares y Soporte</label>
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1">
                  <span className="text-[9px] font-bold text-[#141414]/40 uppercase ml-1">Monitor Ambiental (Termohigrómetro)</span>
                  <select 
                    className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-xs shadow-sm"
                    value={auxEquipment.thermohygrometerId}
                    onChange={e => setAuxEquipment({...auxEquipment, thermohygrometerId: e.target.value})}
                  >
                    <option value="">Seleccione equipo...</option>
                    {standards.filter(s => s.tipo === 'termo').map(s => (
                      <option key={s.id} value={s.id}>{s.alias} ({s.brand} {s.model})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-bold text-[#141414]/40 uppercase ml-1">Referencia Atmosférica (Barómetro)</span>
                  <select 
                    className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-xs shadow-sm"
                    value={auxEquipment.barometerId}
                    onChange={e => setAuxEquipment({...auxEquipment, barometerId: e.target.value})}
                  >
                    <option value="">Seleccione equipo...</option>
                    {standards.filter(s => s.tipo === 'barometro').map(s => (
                      <option key={s.id} value={s.id}>{s.alias} ({s.brand} {s.model})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-bold text-[#141414]/40 uppercase ml-1">Generador de Presión / Bomba</span>
                  <select 
                    className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-xs shadow-sm"
                    value={auxEquipment.pressureGeneratorId}
                    onChange={e => setAuxEquipment({...auxEquipment, pressureGeneratorId: e.target.value})}
                  >
                    <option value="">Seleccione equipo...</option>
                    {standards.filter(s => s.tipo === 'generador').map(s => (
                      <option key={s.id} value={s.id}>{s.alias} ({s.brand} {s.model})</option>
                    ))}
                    {/* Fallback to legacy options if needed */}
                    {!standards.some(s => s.tipo === 'generador') && (
                      <>
                        <option value="BOMBA_HIDR_01">Bomba Hidráulica 10,000 PSI</option>
                        <option value="BOMBA_NEUM_01">Bomba Neumática -14 a 600 PSI</option>
                      </>
                    )}
                  </select>
                </div>
              </div>
            </div>
          </div>
        </section>
        
        {/* SECTION 4: PREPARACIÓN E INSPECCIÓN */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
            <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">4. Preparación e Inspección</h4>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Estado y Limpieza */}
            <div className="p-6 bg-[#F5F5F0]/50 rounded-3xl border border-[#141414]/5 space-y-4">
              <div className="space-y-3">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60 block">Estado del Equipo</label>
                <select 
                  className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-xs shadow-sm"
                  value={((data.metadata as any)?.inspection)?.equipmentStatus}
                  onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {...(data.metadata as any).inspection, equipmentStatus: e.target.value}} as any})}
                >
                  <option value="NEW">Nuevo</option>
                  <option value="SERVICE">En Servicio</option>
                  <option value="REPAIRED">Reparado</option>
                </select>
              </div>
              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" className="w-4 h-4 rounded border-[#141414]/10"
                    checked={((data.metadata as any)?.inspection)?.cleaning}
                    onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {...(data.metadata as any).inspection, cleaning: e.target.checked}} as any})}
                  />
                  <span className="text-xs font-medium text-[#141414]/70">Limpieza Exterior</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input 
                    type="checkbox" className="w-4 h-4 rounded border-[#141414]/10"
                    checked={((data.metadata as any)?.inspection)?.zeroAdjust}
                    onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {...(data.metadata as any).inspection, zeroAdjust: e.target.checked}} as any})}
                  />
                  <span className="text-xs font-medium text-[#141414]/70">Ajuste de Cero</span>
                </label>
              </div>
            </div>

            {/* Inspección de Componentes */}
            <div className="p-6 bg-[#F5F5F0]/50 rounded-3xl border border-[#141414]/5 space-y-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60 block">Inspección de Partes</label>
              <div className="grid grid-cols-1 gap-2">
                {[
                  { key: 'thread', label: 'Rosca / Conexión' },
                  { key: 'dial', label: 'Carátula / Dial' },
                  { key: 'casing', label: 'Carcasa' },
                  { key: 'glass', label: 'Mica / Vidrio' },
                  { key: 'needle', label: 'Puntero / Aguja' }
                ].map(comp => (
                  <div key={comp.key} className="flex items-center justify-between bg-white/50 p-2 rounded-lg">
                    <span className="text-[10px] font-medium text-[#141414]/60">{comp.label}</span>
                    <select 
                      className="bg-transparent text-[10px] font-bold outline-none"
                      value={((data.metadata as any)?.inspection?.components)?.[comp.key]}
                      onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {
                        ...(data.metadata as any).inspection, 
                        components: { ...(data.metadata as any).inspection.components, [comp.key]: e.target.value } 
                      }} as any})}
                    >
                      <option value="OK">Buen Estado</option>
                      <option value="REPAIR">Reparar</option>
                      <option value="REPLACE">Cambiar</option>
                      <option value="N/A">N/A</option>
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Pruebas Previas */}
            <div className="p-6 bg-[#F5F5F0]/50 rounded-3xl border border-[#141414]/5 space-y-4">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60 block">Precargas</label>
                  {/* Countdown Timer UI */}
                  <div className="flex items-center gap-2 bg-[#141414] px-3 py-1 rounded-full">
                    <Clock className={cn("w-3 h-3 text-white", isTimerRunning && "animate-pulse")} />
                    <span className="text-[10px] font-mono font-bold text-white leading-none">{formatTimer(timerSeconds)}</span>
                    <div className="flex gap-1.5 ml-1 border-l border-white/20 pl-2">
                       <button 
                        type="button" 
                        onClick={() => setTimerSeconds(s => Math.max(10, s - 10))}
                        className="text-white/40 hover:text-white text-[8px]"
                      >
                        -10s
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setIsTimerRunning(!isTimerRunning)}
                        className="text-white hover:text-blue-400"
                      >
                        {isTimerRunning ? <RefreshCw className="w-2.5 h-2.5" /> : <Zap className="w-2.5 h-2.5 fill-current" />}
                      </button>
                      <button 
                        type="button" 
                        onClick={() => setTimerSeconds(s => s + 10)}
                        className="text-white/40 hover:text-white text-[8px]"
                      >
                        +10s
                      </button>
                    </div>
                  </div>
                </div>
                <div className="flex gap-4 items-center">
                   <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" className="w-4 h-4"
                      checked={((data.metadata as any)?.inspection)?.precharge?.performed}
                      onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {
                        ...(data.metadata as any).inspection, 
                        precharge: { ...(data.metadata as any).inspection.precharge, performed: e.target.checked } 
                      }} as any})}
                    />
                    <span className="text-[10px] font-medium">Realizada</span>
                  </label>
                  <input 
                    type="number" className="w-16 p-2 bg-white border border-[#141414]/10 rounded-lg text-xs outline-none"
                    placeholder="Ciclos"
                    value={((data.metadata as any)?.inspection)?.precharge?.cycles ?? ''}
                    onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {
                      ...(data.metadata as any).inspection, 
                      precharge: { ...(data.metadata as any).inspection.precharge, cycles: parseInt(e.target.value) || 0 } 
                    }} as any})}
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60 block">Hermeticidad / Estanqueidad</label>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="checkbox" className="w-4 h-4"
                      checked={((data.metadata as any)?.inspection)?.leakTest?.performed}
                      onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {
                        ...(data.metadata as any).inspection, 
                        leakTest: { ...(data.metadata as any).inspection.leakTest, performed: e.target.checked } 
                      }} as any})}
                    />
                    <span className="text-[10px] font-medium">Verificada (Checklist)</span>
                  </label>
                  {((data.metadata as any)?.inspection)?.leakTest?.performed && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <input 
                        className="p-2 bg-white border border-[#141414]/10 rounded-lg text-[10px] outline-none"
                        placeholder="Tiempo (min)"
                        value={((data.metadata as any)?.inspection)?.leakTest?.duration ?? ''}
                        onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {
                          ...(data.metadata as any).inspection, 
                          leakTest: { ...(data.metadata as any).inspection.leakTest, duration: e.target.value } 
                        }} as any})}
                      />
                      <input 
                        className="p-2 bg-white border border-[#141414]/10 rounded-lg text-[10px] outline-none"
                        placeholder="Patrón/Reloj"
                        value={((data.metadata as any)?.inspection)?.leakTest?.reference ?? ''}
                        onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {
                          ...(data.metadata as any).inspection, 
                          leakTest: { ...(data.metadata as any).inspection.leakTest, reference: e.target.value } 
                        }} as any})}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 bg-[#F5F5F0]/50 rounded-2xl border border-[#141414]/5 space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60 block">Resultado Global y Notas</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <select 
                className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-xs shadow-sm"
                value={((data.metadata as any)?.inspection)?.visualCheck}
                onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {...(data.metadata as any).inspection, visualCheck: e.target.value}} as any})}
              >
                <option value="good">Buen Estado</option>
                <option value="fair">Estado Regular</option>
                <option value="bad">Mal Estado (Ver Observaciones)</option>
              </select>
              <textarea 
                className="w-full p-2 bg-white border border-[#141414]/10 rounded-xl outline-none font-medium text-[10px] shadow-sm resize-none"
                rows={2}
                placeholder="Observaciones adicionales de inspección..."
                value={((data.metadata as any)?.inspection)?.notes}
                onChange={e => setData({...data, metadata: {...data.metadata!, inspection: {...(data.metadata as any).inspection, notes: e.target.value}} as any})}
              />
            </div>
          </div>
        </section>

        {/* SECTION 5: CONDICIONES AMBIENTALES Y CORRECCIONES */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 px-1">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <h4 className="text-[11px] font-black uppercase tracking-[0.2em] text-[#141414]">5. Condiciones Ambientales y Correcciones</h4>
          </div>

          <div className="p-8 bg-[#F5F5F0]/50 rounded-3xl border border-[#141414]/5 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <Thermometer className="w-3 h-3 text-orange-500" />
                  <label className="text-[9px] font-bold uppercase text-[#141414]/40">Temperatura (°C)</label>
                </div>
                <input type="number" step="any" className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-sm font-mono shadow-sm" value={data.metadata?.ambientTemp ?? ''} onChange={e => setData({...data, metadata: {...data.metadata!, ambientTemp: parseFloat(e.target.value) || 0}})} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <Droplets className="w-3 h-3 text-blue-500" />
                  <label className="text-[9px] font-bold uppercase text-[#141414]/40">Humedad Rel. (%)</label>
                </div>
                <input type="number" step="any" className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-sm font-mono shadow-sm" value={data.metadata?.humidity} onChange={e => setData({...data, metadata: {...data.metadata!, humidity: parseFloat(e.target.value) || 0}})} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <Wind className="w-3 h-3 text-emerald-500" />
                  <label className="text-[9px] font-bold uppercase text-[#141414]/40">Presión Atms. (hPa)</label>
                </div>
                <input type="number" step="any" className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-sm font-mono shadow-sm" value={data.metadata?.pressureAtmHpa} onChange={e => setData({...data, metadata: {...data.metadata!, pressureAtmHpa: parseFloat(e.target.value) || 1013.25}})} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <MapPin className="w-3 h-3 text-red-500" />
                  <label className="text-[9px] font-bold uppercase text-[#141414]/40">Gravedad Local (m/s²)</label>
                </div>
                <input type="number" step="any" className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-sm font-mono shadow-sm" value={data.metadata?.gravity} onChange={e => setData({...data, metadata: {...data.metadata!, gravity: parseFloat(e.target.value) || 9.77}})} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-white/60 rounded-2xl border border-[#141414]/5 flex items-center justify-between">
                <div>
                  <span className="text-[8px] font-black uppercase tracking-widest text-[#141414]/40 block mb-0.5">Densidad del Aire (CIPM-2007)</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-black text-[#141414] tracking-tighter">{airProperties.rho.toFixed(5)}</span>
                    <span className="text-[10px] font-bold text-[#141414]/40">kg/m³</span>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[8px] font-black uppercase tracking-widest text-[#141414]/40 block mb-0.5">Incertidumbre (k=1)</span>
                  <span className="text-xs font-mono font-bold text-emerald-600">± {airProperties.uRho.toFixed(6)}</span>
                </div>
              </div>
              <div className="p-4 bg-blue-50/30 rounded-2xl border border-blue-100/50 flex flex-col justify-center">
                <div className="flex items-center gap-2 mb-1">
                  <ShieldCheck className="w-3 h-3 text-blue-600" />
                  <span className="text-[8px] font-black uppercase tracking-widest text-blue-600">Verificación de Integridad</span>
                </div>
                <p className="text-[9px] font-medium text-blue-800 leading-tight">Cálculo ejecutado en tiempo real siguiendo el estándar CIPM-2007 para corrección de empuje aerostático.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-[#141414]/5">
              <div className="flex items-center gap-2 mb-4">
                <Ruler className="w-4 h-4 text-indigo-500" />
                <h5 className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60">Diferencia de Alturas (Cabezal)</h5>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold uppercase text-[#141414]/40 px-1">Altura del Patrón (h₁ - mm)</label>
                  <input type="number" step="any" className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-sm font-mono shadow-sm" value={data.metadata?.heightPatternMm} onChange={e => setData({...data, metadata: {...data.metadata!, heightPatternMm: parseFloat(e.target.value) || 0}})} />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[9px] font-bold uppercase text-[#141414]/40 px-1">Altura del Instrumento (h₂ - mm)</label>
                  <input type="number" step="any" className="w-full p-3 bg-white border border-[#141414]/10 rounded-xl outline-none text-sm font-mono shadow-sm" value={data.metadata?.heightInstrumentMm} onChange={e => setData({...data, metadata: {...data.metadata!, heightInstrumentMm: parseFloat(e.target.value) || 0}})} />
                </div>
              </div>
              <div className="mt-4 p-3 bg-indigo-50/50 rounded-xl border border-indigo-100/50">
                <p className="text-[10px] text-indigo-600 font-bold uppercase tracking-tight">
                  Diferencia Neta (Δh): {((data.metadata?.heightPatternMm || 0) - (data.metadata?.heightInstrumentMm || 0)).toFixed(1)} mm
                </p>
                <p className="text-[9px] text-indigo-400 font-medium">Corrección automática aplicada por carga hidrostática del fluido {(data.metadata?.fluid || 'Aire')}.</p>
              </div>
            </div>

            <div className="pt-4 border-t border-[#141414]/5">
              <div className="flex items-center gap-2 mb-4">
                <FileText className="w-4 h-4 text-[#141414]/60" />
                <h5 className="text-[10px] font-black uppercase tracking-widest text-[#141414]/60">Notas de Calibración</h5>
              </div>
              <textarea
                className="w-full p-4 bg-white border border-[#141414]/10 rounded-2xl outline-none text-sm font-medium shadow-sm min-h-[120px] transition-all focus:border-blue-500/30 focus:ring-4 focus:ring-blue-500/5"
                placeholder="Observaciones adicionales sobre el proceso, anomalías detectadas o detalles específicos de la calibración..."
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* SECTION 6: CENTRO DE MEDICIONES METROLÓGICAS */}
        <section className="space-y-6">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-blue-600 shadow-[0_0_10px_rgba(37,99,235,0.5)]" />
              <div>
                <h4 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#141414]">6. Centro de Mediciones Metrológicas</h4>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-tighter">
                    Ciclos de Carga y Descarga - Unidad: {(data.metadata as any)?.unit || 'psi'}
                  </p>
                  <span className="px-1.5 py-0.5 bg-blue-600 text-white text-[8px] font-black rounded-md">
                    DKD-R 6-1 TIPO {determinarSecuenciaDKD(parseFloat(data.metadata?.accuracyClass || '1.0')).secuencia}
                  </span>
                  <span className={cn(
                    "px-1.5 py-0.5 text-white text-[8px] font-black rounded-md",
                    parseFloat(data.metadata?.accuracyClass || '1.0') <= 0.1 ? "bg-amber-600" : "bg-emerald-600"
                  )}>
                    DKD-R 6-1 {parseFloat(data.metadata?.accuracyClass || '1.0') <= 0.1 ? 'CASO 2 (Alta Exactitud)' : 'CASO 1 (Industrial)'}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex gap-2">
              <button 
                type="button" 
                onClick={loadExampleData}
                className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-amber-100 transition-all border border-amber-100 shadow-sm"
              >
                <Zap className="w-3 h-3" /> Ejemplo Manómetro
              </button>
              <button 
                type="button" 
                onClick={generatePoints}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-blue-100 transition-all border border-blue-100 shadow-sm"
              >
                <RefreshCw className="w-3 h-3" /> Auto-Puntos
              </button>
              <button 
                type="button" 
                onClick={runCalculations}
                disabled={isCalculating}
                className={cn(
                  "flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border shadow-sm",
                  (data.metadata as any)?.uncertaintyMethod === 'Monte Carlo' 
                    ? "bg-purple-50 text-purple-700 border-purple-100 hover:bg-purple-100" 
                    : "bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100"
                )}
              >
                <Calculator className={cn("w-3 h-3", isCalculating && "animate-spin")} /> 
                {isCalculating ? 'Procesando...' : `Ejecutar ${(data.metadata as any)?.uncertaintyMethod || 'GUM'}`}
              </button>
            </div>
          </div>

          <div className="overflow-hidden bg-[#F5F5F0]/30 rounded-[2rem] border border-[#141414]/10 shadow-inner">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#141414]/5 border-b border-[#141414]/10">
                    <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Nominal</th>
                    <th className="py-5 px-6 text-[10px] font-black uppercase tracking-widest text-blue-600">
                      <div className="flex flex-col">
                        <span>{(data.metadata as any)?.methodology === 'analog' ? 'IBC (Objetivo)' : 'Patrón (Objetivo)'}</span>
                        <span className="text-[8px] opacity-40 font-bold">VALOR AJUSTADO</span>
                      </div>
                    </th>
                    {/* Dynamic Series Headers */}
                    {(() => {
                      const accuracy = parseFloat(data.metadata?.accuracyClass || '1.0');
                      const seq = determinarSecuenciaDKD(accuracy);
                      const series = [];
                      const isMountingDep = (data.metadata as any)?.mountingDependent;
                      const count = seq.secuencia === 'A' ? (isMountingDep ? 6 : 4) : (seq.secuencia === 'B' ? 3 : 2);
                      const readingLabel = (data.metadata as any)?.methodology === 'analog' ? 'LECT. PATRÓN' : 'LECT. IBC';
                      
                      for (let i = 1; i <= count; i++) {
                        const isAsc = i % 2 !== 0;
                        series.push(
                          <th key={i} className={cn(
                            "py-5 px-4 text-[10px] font-black uppercase tracking-widest text-center border-l border-[#141414]/5",
                            isAsc ? "text-blue-500" : "text-purple-500"
                          )}>
                            <div className="flex flex-col">
                              <span>M{i} {isAsc ? '↑' : '↓'}</span>
                              <span className="text-[7px] font-black opacity-30 mt-0.5">{readingLabel}</span>
                            </div>
                          </th>
                        );
                      }
                      return series;
                    })()}
                    <th className="w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/5">
                  {(() => {
                    const accuracy = parseFloat(data.metadata?.accuracyClass || '1.0');
                    const seq = determinarSecuenciaDKD(accuracy);
                    const isMountingDep = (data.metadata as any)?.mountingDependent;
                    const seriesCount = seq.secuencia === 'A' ? (isMountingDep ? 6 : 4) : (seq.secuencia === 'B' ? 3 : 2);
                    const isAnalog = (data.metadata as any)?.methodology === 'analog';

                    // Group unique nominal values
                    const uniqueNominals = (Array.from(new Set(points.map(p => p.nominalValue))) as number[]).sort((a,b) => a - b);

                    return uniqueNominals.map((nom: number, rowIdx) => {
                      // Get measurements for this nominal
                      const rowPoints = points.filter(p => p.nominalValue === nom);
                      
                      return (
                        <tr key={nom} className="group hover:bg-white/50 transition-all">
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <span className="w-6 h-6 rounded-lg bg-[#141414] text-white flex items-center justify-center text-[10px] font-black">{rowIdx + 1}</span>
                              <input 
                                type="number"
                                step="any"
                                className="w-24 p-2 bg-white border border-[#141414]/10 rounded-xl outline-none font-mono text-sm font-bold text-[#141414] shadow-sm focus:border-blue-500"
                                value={nom} 
                                onChange={(e) => {
                                  const newNomVal = parseFloat(e.target.value);
                                  const nextPoints = points.map(p => p.nominalValue === nom ? { ...p, nominalValue: isNaN(newNomVal) ? 0 : newNomVal } : p);
                                  setPoints(nextPoints);
                                }}
                              />
                            </div>
                          </td>
                          
                          {/* Reference Column */}
                          <td className="py-4 px-4 bg-[#141414]/5">
                            <input 
                              type="text"
                              inputMode="decimal"
                              className="w-full p-2.5 bg-white border border-[#141414]/10 rounded-xl outline-none font-mono text-xs font-black text-center shadow-sm"
                              value={isAnalog ? rowPoints[0]?.instrumentValue : rowPoints[0]?.standardValue}
                              onChange={e => {
                                const val = e.target.value;
                                const field = isAnalog ? 'instrumentValue' : 'standardValue';
                                // Update all points for this nominal to share the same reference
                                const nextPoints = points.map(p => p.nominalValue === nom ? { ...p, [field]: val } : p);
                                setPoints(nextPoints);
                              }}
                            />
                          </td>

                          {/* Series Readings (M1...Mn) */}
                          {Array.from({ length: seriesCount }).map((_, sIdx) => {
                            const pIdx = points.findIndex((p, i) => {
                              // Match by nominal and by its position in the flat array for this nominal
                              const nominalOccurrences = points.slice(0, i + 1).filter(prev => prev.nominalValue === nom).length;
                              return p.nominalValue === nom && nominalOccurrences === (sIdx + 1);
                            });
                            
                            const point = pIdx !== -1 ? points[pIdx] : null;
                            const isAsc = (sIdx + 1) % 2 !== 0;
                            const field = isAnalog ? 'standardValue' : 'instrumentValue';

                            return (
                              <td key={sIdx} className={cn(
                                "py-4 px-3 border-l border-[#141414]/5",
                                isAsc ? "bg-blue-50/10" : "bg-purple-50/10"
                              )}>
                                {point ? (
                                  <input 
                                    type="text"
                                    inputMode="decimal"
                                    className={cn(
                                      "w-full p-2.5 bg-white border rounded-xl outline-none font-mono text-xs text-center transition-all",
                                      isAsc ? "border-blue-100 text-blue-700" : "border-purple-100 text-purple-700"
                                    )}
                                    value={point[field]}
                                    onChange={e => updatePoint(pIdx, field, e.target.value)}
                                  />
                                ) : <div className="text-[9px] text-center text-[#141414]/10">-</div>}
                              </td>
                            );
                          })}

                          <td className="py-4 px-4 text-center">
                            <button 
                              type="button" 
                              onClick={() => setPoints(points.filter(p => p.nominalValue !== nom))}
                              className="p-2 text-[#141414]/10 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                  {points.length === 0 && (
                    <tr>
                      <td colSpan={10} className="py-20 text-center">
                        <div className="flex flex-col items-center gap-4 opacity-20">
                          <Plus className="w-12 h-12" />
                          <div className="space-y-1">
                            <p className="text-sm font-black uppercase tracking-[0.2em]">Panel Vacío</p>
                            <p className="text-[10px] font-bold uppercase tracking-tighter">Use "Auto-Puntos" para comenzar</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="flex justify-between items-center px-6">
            <div className="flex gap-4">
              <button 
                type="button" 
                onClick={addPoint} 
                className="text-[10px] font-black uppercase tracking-widest text-[#141414]/40 hover:text-blue-600 transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" /> Añadir Punto Manual
              </button>
              <button 
                type="button" 
                onClick={() => setPoints([])} 
                className="text-[10px] font-black uppercase tracking-widest text-red-400/60 hover:text-red-600 transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4" /> Limpiar Tabla
              </button>
            </div>
            
            <button 
              type="button" 
              onClick={previewCertificate}
              className="px-8 py-3 bg-emerald-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-600/20 flex items-center gap-2 active:scale-95"
            >
              <FileText className="w-3.5 h-3.5" /> Generar Borrador PDF
            </button>
          </div>
        </section>
        
        {/* SECTION 7: RESULTADOS CALIBRACIÓN (ISO 17025) */}
        {pointResults.length > 0 && (
          <section className="space-y-6">
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
                      <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Indicación IBC</th>
                      <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-blue-600 text-center">Error</th>
                      <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-emerald-600 text-center">Incertidumbre (U)</th>
                      <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-amber-600 text-center">EMP (Tol.)</th>
                      <th className="py-5 px-4 text-[10px] font-black uppercase tracking-widest text-[#141414]/40 text-center">Conformidad</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#141414]/5">
                    {pointResults.map((res: any, i: number) => {
                      const isAnalog = (data.metadata as any)?.methodology === 'analog';
                      const indicado = isAnalog ? res.nominal : res.meanReading;
                      
                      // 1. DETERMINISTIC EMP CALCULATION (NORMAS)
                      const standard = (data.metadata as any)?.standard || 'EN 837';
                      const accuracyClass = data.metadata?.accuracyClass || '1.0';
                      
                      const nominalRMax = parseFloat((data.metadata as any)?.nominalRangeMax || data.metadata?.rangeMax || '100');
                      const nominalRMin = parseFloat((data.metadata as any)?.nominalRangeMin || data.metadata?.rangeMin || '0');
                      const nominalSpan = nominalRMax - nominalRMin;

                      // Siempre usar Span Nominal para el cálculo de tolerancia según requerimiento
                      const baseSpan = nominalSpan;
                      
                      let emp = 0;
                      const accuracy = parseFloat(accuracyClass);

                      if (standard.includes('ASME')) {
                        const grade = accuracyClass.toString().toUpperCase();
                        const percentOfSpan = ((res.nominal - nominalRMin) / nominalSpan) * 100;

                        // ASME Grade Management
                        if (grade === 'B' || grade === '2/3/2') {
                          emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.03 * nominalSpan : 0.02 * nominalSpan;
                        } else if (grade === 'A' || grade === '1/2/1') {
                          emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.02 * nominalSpan : 0.01 * nominalSpan;
                        } else if (grade === 'C' || grade === '3/4/3') {
                          emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.04 * nominalSpan : 0.03 * nominalSpan;
                        } else if (grade === 'D' || grade === '5/5/5') {
                          emp = 0.05 * nominalSpan;
                        } else {
                          // Constant grades (4A, 3A, 2A, 1A)
                          emp = (accuracy / 100) * nominalSpan;
                        }
                      } else {
                        // EN 837-1 or others: Use class over NOMINAL span
                        emp = (accuracy / 100) * nominalSpan;
                      }
                      
                      // 2. DECISION RULE (ILAC-G8 / ISO 17025)
                      // Veredicto Binario con Banda de Guarda: |Error| + Uncertainty <= EMP
                      const isCompliant = (Math.abs(res.error) + res.uExp) <= (emp + 1e-10);
                      
                      // 3. HYSTERESIS CHECK
                      const hystCompliant = res.hysteresis <= (emp + 1e-10);

                      return (
                        <tr key={i} className="group hover:bg-[#F5F5F0]/30 transition-all">
                          <td className="py-4 px-8 font-mono text-sm font-bold text-[#141414]">
                            {(res.nominal ?? 0).toFixed(2)} <span className="text-[10px] opacity-20 ml-1">{(data.metadata as any)?.unit}</span>
                          </td>
                          <td className="py-4 px-4 font-mono text-sm text-[#141414]/70">
                            {(res.refCorrected ?? 0).toFixed(4)}
                          </td>
                          <td className="py-4 px-4 font-mono text-sm text-[#141414]/70">
                            {(indicado ?? 0).toFixed(4)}
                          </td>
                          <td className="py-4 px-4 font-mono text-sm font-black text-blue-600 text-center bg-blue-50/20">
                            {res.error > 0 ? '+' : ''}{(res.error ?? 0).toFixed(4)}
                          </td>
                          <td className="py-4 px-4 font-mono text-sm font-black text-emerald-600 text-center bg-emerald-50/20">
                            ±{(res.uExp ?? 0).toFixed(4)}
                          </td>
                          <td className="py-4 px-4 font-mono text-sm font-bold text-amber-600 text-center bg-amber-50/10">
                            {(emp ?? 0).toFixed(4)}
                          </td>
                          <td className="py-4 px-4 text-center">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter",
                              isCompliant 
                                ? "bg-emerald-100 text-emerald-700" 
                                : "bg-red-100 text-red-700"
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
            
            <div className="flex gap-4 p-6 bg-amber-50/50 rounded-2xl border border-amber-100/50">
               <div className="w-1 h-auto bg-amber-200 rounded-full" />
               <p className="text-[10px] text-amber-900/60 font-medium leading-relaxed uppercase tracking-tight">
                 * El error se calcula como la diferencia entre la indicación del instrumento y el valor de referencia patrón corregido. 
                 La incertidumbre expandida se basa en la incertidumbre estándar combinada multiplicada por un factor de cobertura k=2 (aprox. 95.45% de confianza).
                 Resultados expresados en la unidad de medida: {(data.metadata as any)?.unit || 'psi'}.
               </p>
            </div>

            {/* NEW: METROLOGICAL CONFORMITY SUMMARY */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-[#141414] p-6 rounded-[2rem] text-white space-y-4">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[9px] font-black uppercase tracking-widest opacity-60">Status Metrológico</span>
                </div>
                <div>
                  <p className="text-2xl font-black italic uppercase tracking-tighter">
                    {pointResults.every((res: any) => {
                      const standard = (data.metadata as any)?.standard || 'EN 837';
                      const accuracyClass = data.metadata?.accuracyClass || '1.0';
                      const nominalRMax = parseFloat((data.metadata as any)?.nominalRangeMax || data.metadata?.rangeMax || '100');
                      const nominalRMin = parseFloat((data.metadata as any)?.nominalRangeMin || data.metadata?.rangeMin || '0');
                      const nominalSpan = nominalRMax - nominalRMin;
                      
                      const baseSpan = nominalSpan;
                      let emp = (parseFloat(accuracyClass) / 100) * baseSpan;
                      
                      if (standard.includes('ASME')) {
                        const grade = accuracyClass.toString().toUpperCase();
                        const percentOfSpan = ((res.nominal - nominalRMin) / nominalSpan) * 100;
                        if (grade === 'B' || grade === '2/3/2') emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.03 * nominalSpan : 0.02 * nominalSpan;
                        if (grade === 'A' || grade === '1/2/1') emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.02 * nominalSpan : 0.01 * nominalSpan;
                        if (grade === 'C' || grade === '3/4/3') emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.04 * nominalSpan : 0.03 * nominalSpan;
                        if (grade === 'D' || grade === '5/5/5') emp = 0.05 * nominalSpan;
                      }
                      return (Math.abs(res.error) + res.uExp) <= (emp + 1e-10) && res.hysteresis <= (emp + 1e-10);
                    }) ? 'APTO' : 'NO APTO'}
                  </p>
                  <span className="text-[8px] font-bold opacity-40 uppercase">Veredicto Global ISO 17025</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-[2rem] border border-[#141414]/10 space-y-4">
                <div className="flex items-center gap-2">
                  <Calculator className="w-3 h-3 text-[#141414]/40" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#141414]/40">TUR Promedio</span>
                </div>
                <div>
                  <p className="text-2xl font-black italic text-[#141414]">
                    {(pointResults.reduce((acc: number, res: any) => {
                      const standard = (data.metadata as any)?.standard || 'EN 837';
                      const accuracyClass = data.metadata?.accuracyClass || '1.0';
                      const nominalRMax = parseFloat((data.metadata as any)?.nominalRangeMax || data.metadata?.rangeMax || '100');
                      const nominalRMin = parseFloat((data.metadata as any)?.nominalRangeMin || data.metadata?.rangeMin || '0');
                      const nominalSpan = nominalRMax - nominalRMin;
                      
                      const baseSpan = nominalSpan;
                      let emp = (parseFloat(accuracyClass) / 100) * baseSpan;

                      if (standard.includes('ASME')) {
                        const grade = accuracyClass.toString().toUpperCase();
                        const percentOfSpan = ((res.nominal - nominalRMin) / nominalSpan) * 100;
                        if (grade === 'B' || grade === '2/3/2') emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.03 * nominalSpan : 0.02 * nominalSpan;
                        if (grade === 'A' || grade === '1/2/1') emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.02 * nominalSpan : 0.01 * nominalSpan;
                        if (grade === 'C' || grade === '3/4/3') emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.04 * nominalSpan : 0.03 * nominalSpan;
                        if (grade === 'D' || grade === '5/5/5') emp = 0.05 * nominalSpan;
                      }
                      
                      return acc + (emp / (res.uExp || 0.0001));
                    }, 0) / pointResults.length).toFixed(1)}:1
                  </p>
                  <span className="text-[8px] font-bold text-[#141414]/40 uppercase tracking-tighter">Relación de Incertidumbre de Prueba</span>
                </div>
              </div>

              <div className="bg-white p-6 rounded-[2rem] border border-[#141414]/10 space-y-4">
                <div className="flex items-center gap-2">
                  <Zap className="w-3 h-3 text-[#141414]/40" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-[#141414]/40">Regla de Decisión</span>
                </div>
                <div>
                  <p className="text-[12px] font-black text-[#141414] uppercase leading-tight italic">
                    Banda de Guarda Binaria
                  </p>
                  <p className="text-[8px] font-bold text-[#141414]/40 uppercase mt-1">
                    ILAC-G8:2019 / ISO 17025:2017
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* SECTION 8: ANÁLISIS GRÁFICO METROLÓGICO */}
        {pointResults.length > 0 && (
          <section className="space-y-8">
            <div className="flex items-center gap-2 px-1">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-600 shadow-[0_0_8px_rgba(147,51,234,0.5)]" />
              <h4 className="text-[12px] font-black uppercase tracking-[0.2em] text-[#141414]">8. Análisis Gráfico Metrológico</h4>
            </div>

            <div className="grid grid-cols-1 gap-8">
              {/* Grafica de Tendencia (Linealidad) */}
              <div className="bg-white p-8 rounded-[2.5rem] border border-[#141414]/10 shadow-sm space-y-6">
                <div className="flex items-center gap-2 px-1">
                  <Activity className="w-4 h-4 text-blue-500" />
                  <h5 className="text-[10px] font-black uppercase tracking-widest text-[#141414]">Tendencia de Calibración (Linealidad)</h5>
                </div>
                
                <div className="h-[350px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={points
                        .filter(p => !isNaN(parseFloat(p.instrumentValue)) && !isNaN(parseFloat(p.standardValue)))
                        .map(p => ({
                          nominal: p.nominalValue,
                          standard: parseFloat(p.standardValue) || 0,
                          instrument: parseFloat(p.instrumentValue) || 0,
                          series: p.series
                        }))
                        .sort((a, b) => a.standard - b.standard)}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#141414" strokeOpacity={0.05} />
                      <XAxis 
                        dataKey="standard" 
                        type="number" 
                        domain={['auto', 'auto']} 
                        tick={{ fontSize: 9, fontWeight: 700, fill: '#141414' }}
                        tickFormatter={(value) => (value ?? 0).toFixed(1)}
                        axisLine={{ stroke: '#141414', strokeOpacity: 0.1 }}
                        label={{ value: (data.metadata as any).unit, position: 'insideBottomRight', offset: -5, fontSize: 9, fontWeight: 900 }}
                      />
                      <YAxis 
                        tick={{ fontSize: 9, fontWeight: 700, fill: '#141414' }}
                        axisLine={{ stroke: '#141414', strokeOpacity: 0.1 }}
                        width={40}
                        label={{ value: 'Lectura IBC', angle: -90, position: 'insideLeft', fontSize: 9, fontWeight: 900 }}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '16px', 
                          border: 'none', 
                          boxShadow: '0 10px 30px -5px rgba(0,0,0,0.1)',
                          fontSize: '10px',
                          textTransform: 'uppercase',
                          fontWeight: 900
                        }} 
                      />
                      <Legend 
                        wrapperStyle={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', paddingTop: '20px' }}
                      />
                      <Line 
                        name="Indicación Instrumento" 
                        type="monotone" 
                        dataKey="instrument" 
                        stroke="#2563eb" 
                        strokeWidth={3} 
                        dot={{ r: 4, fill: '#2563eb', strokeWidth: 0 }} 
                        activeDot={{ r: 6 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Grafica de Errores */}
              <div className="bg-white p-8 rounded-[2.5rem] border border-[#141414]/10 shadow-sm space-y-6">
                <div>
                  <h5 className="text-[10px] font-black uppercase tracking-widest text-[#141414]">Curva de Error vs EMP</h5>
                  <p className="text-[9px] text-[#141414]/40 uppercase font-bold tracking-tight">Desviación del instrumento frente a límites de tolerancia</p>
                </div>
                
                <div className="h-[400px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={pointResults.map(res => {
                         // 1. DETERMINISTIC EMP CALCULATION (NORMAS) - SAME AS TABLE
                        const standard = (data.metadata as any)?.standard || 'EN 837';
                        const accuracyClass = data.metadata?.accuracyClass || '1.0';
                        
                        const nominalRMax = parseFloat((data.metadata as any)?.nominalRangeMax || data.metadata?.rangeMax || '100');
                        const nominalRMin = parseFloat((data.metadata as any)?.nominalRangeMin || data.metadata?.rangeMin || '0');
                        const nominalSpan = nominalRMax - nominalRMin;
                        
                        // Siempre usar Span Nominal
                        const baseSpan = nominalSpan;
                        
                        let emp = 0;
                        const accuracy = parseFloat(accuracyClass);

                        if (standard.includes('ASME')) {
                          const grade = accuracyClass.toString().toUpperCase();
                          const percentOfSpan = ((res.nominal - nominalRMin) / nominalSpan) * 100;
                          if (grade === 'B' || grade === '2/3/2') {
                            emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.03 * nominalSpan : 0.02 * nominalSpan;
                          } else if (grade === 'A' || grade === '1/2/1') {
                            emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.02 * nominalSpan : 0.01 * nominalSpan;
                          } else if (grade === 'C' || grade === '3/4/3') {
                            emp = (percentOfSpan <= 25 || percentOfSpan >= 75) ? 0.04 * nominalSpan : 0.03 * nominalSpan;
                          } else if (grade === 'D' || grade === '5/5/5') {
                            emp = 0.05 * nominalSpan;
                          } else {
                            emp = (accuracy / 100) * nominalSpan;
                          }
                        } else {
                          emp = (accuracy / 100) * nominalSpan;
                        }

                        return {
                          nominal: res.nominal,
                          error: res.error,
                          uExp: res.uExp,
                          empPos: emp,
                          empNeg: -emp
                        };
                      }).sort((a, b) => a.nominal - b.nominal)}
                      margin={{ top: 20, right: 30, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#141414" strokeOpacity={0.05} />
                      <XAxis 
                        dataKey="nominal" 
                        type="number" 
                        domain={['auto', 'auto']} 
                        tick={{ fontSize: 9, fontWeight: 700, fill: '#141414' }}
                        tickFormatter={(value) => (value ?? 0).toFixed(1)}
                        axisLine={{ stroke: '#141414', strokeOpacity: 0.1 }}
                      />
                      <YAxis 
                        tick={{ fontSize: 9, fontWeight: 700, fill: '#141414' }}
                        axisLine={{ stroke: '#141414', strokeOpacity: 0.1 }}
                        width={40}
                      />
                      <Tooltip 
                        contentStyle={{ 
                          borderRadius: '16px', 
                          border: 'none', 
                          boxShadow: '0 10px 30px -5px rgba(0,0,0,0.1)',
                          fontSize: '10px',
                          textTransform: 'uppercase',
                          fontWeight: 900
                        }} 
                      />
                      <Legend 
                        wrapperStyle={{ fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', paddingTop: '20px' }}
                      />
                      <ReferenceLine y={0} stroke="#141414" strokeWidth={1} strokeDasharray="5 5" strokeOpacity={0.1} />
                      <Line 
                        name="Error de Indicación" 
                        type="monotone" 
                        dataKey="error" 
                        stroke="#2563eb" 
                        strokeWidth={4} 
                        dot={{ r: 5, fill: '#2563eb', strokeWidth: 0 }} 
                        activeDot={{ r: 7, strokeWidth: 0 }}
                      >
                        <ErrorBar 
                          dataKey="uExp" 
                          direction="y" 
                          stroke="#ef4444" 
                          strokeWidth={2}
                          width={8}
                        />
                      </Line>
                      <Line 
                        name="Límite Tolerancia (+) EMP" 
                        type="step" 
                        dataKey="empPos" 
                        stroke="#f59e0b" 
                        strokeWidth={1} 
                        strokeDasharray="5 5" 
                        dot={false}
                      />
                      <Line 
                        name="Límite Tolerancia (-) EMP" 
                        type="step" 
                        dataKey="empNeg" 
                        stroke="#f59e0b" 
                        strokeWidth={1} 
                        strokeDasharray="5 5" 
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          </section>
        )}
      </fieldset>

        <div className="pt-8 border-t border-[#141414]/10 flex flex-wrap justify-between items-center gap-4">
          <div className="flex gap-3">
             <button type="button" onClick={onCancel} className="px-6 py-4 text-xs font-black uppercase tracking-widest text-[#141414]/40 hover:text-[#141414]">Cancelar</button>
             <button 
              type="button" 
              onClick={previewCertificate}
              className="px-6 py-4 border border-[#141414]/10 rounded-3xl text-xs font-black uppercase tracking-widest text-[#141414]/60 hover:bg-[#141414]/5 transition-all flex items-center gap-2"
            >
              <FileText className="w-3 h-3" /> PDF
            </button>
            <button 
              type="button" 
              onClick={exportToXML}
              className="px-6 py-4 border border-[#141414]/10 rounded-3xl text-xs font-black uppercase tracking-widest text-emerald-600 hover:bg-emerald-50 transition-all flex items-center gap-2"
            >
              <Zap className="w-3 h-3" /> Registro Primario (XML)
            </button>
          </div>
          
          <div className="flex gap-3 items-center">
            {lastSaved && (
              <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 rounded-2xl border border-emerald-100">
                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-tighter">
                  Guardado: {new Date(lastSaved).toLocaleTimeString()}
                </span>
              </div>
            )}
            {status === CalibrationStatus.DRAFT && (
              <>
                <button 
                  type="button" 
                  onClick={handleSaveDraft}
                  disabled={isSavingDraft}
                  className={cn(
                    "px-8 py-4 bg-white border-2 border-[#141414] text-[#141414] rounded-3xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-[#141414]/5 transition-all active:scale-95 disabled:opacity-50",
                    isSavingDraft && "animate-pulse"
                  )}
                >
                  {isSavingDraft ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Clock className="w-4 h-4" />}
                  {isSavingDraft ? 'Guardando...' : 'Guardar Borrador'}
                </button>
                <button 
                  type="submit" 
                  className="bg-[#141414] text-white px-12 py-4 rounded-3xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-[#141414]/90 shadow-2xl transition-all active:scale-95"
                >
                  <Save className="w-4 h-4" /> Finalizar Captura
                </button>
              </>
            )}

            {status === CalibrationStatus.PRELIMINARY && (
              <>
                <button 
                  type="button" 
                  onClick={handleSaveDraft}
                  className="px-8 py-4 bg-white border-2 border-[#141414] text-[#141414] rounded-3xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-[#141414]/5 transition-all active:scale-95 text-blue-600 border-blue-600"
                >
                  <Save className="w-4 h-4" /> Actualizar Datos
                </button>
                <button 
                  type="button" 
                  onClick={() => handleStatusChange(CalibrationStatus.IN_REVIEW)}
                  className="bg-blue-600 text-white px-12 py-4 rounded-3xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-blue-700 shadow-2xl transition-all active:scale-95"
                >
                  <Send className="w-4 h-4" /> Enviar a Calidad
                </button>
              </>
            )}

            {status === CalibrationStatus.IN_REVIEW && (user?.role === 'admin' || user?.role === 'technician') && (
              <>
                <button 
                  type="button" 
                  onClick={() => handleStatusChange(CalibrationStatus.PRELIMINARY)}
                  className="px-8 py-4 bg-white border-2 border-amber-500 text-amber-600 rounded-3xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-amber-50 transition-all active:scale-95"
                >
                  <Trash2 className="w-4 h-4" /> Rechazar / Corregir
                </button>
                <button 
                  type="button" 
                  onClick={() => handleStatusChange(CalibrationStatus.PUBLISHED)}
                  className="bg-emerald-600 text-white px-12 py-4 rounded-3xl font-black text-xs uppercase tracking-[0.2em] flex items-center gap-2 hover:bg-emerald-700 shadow-2xl transition-all active:scale-95"
                >
                  <ShieldCheck className="w-4 h-4" /> Aprobar y Publicar
                </button>
              </>
            )}

            {status === CalibrationStatus.PUBLISHED && (
              <div className="flex items-center gap-3 px-6 py-4 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-3xl font-black text-[10px] uppercase tracking-widest shadow-inner">
                <CheckCircle2 className="w-4 h-4" /> Calibración Definitoria Publicada (Bloqueada)
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
