import React, { useState } from 'react';
import { CalibrationData, Measurement, CalibrationStatus, LogEntry, UncertaintyResults } from '../../types';
import { Save, Plus, Trash2, Calculator, History, Clock, User, Thermometer, RefreshCw, Zap, FileText, XCircle } from 'lucide-react';
import { db } from '../../lib/db';
import { cn, calculateOrderStatus } from '../../lib/utils';
import { getAuthUser } from '../../lib/auth';
import { estimateUncertaintyMonteCarlo, getStandardSources } from '../../lib/monteCarlo';
import { generateDraftCertificate } from '../../lib/certificateGenerator';

interface TemperatureFormProps {
  initialData?: Partial<CalibrationData>;
  onCancel: () => void;
  onSuccess: () => void;
}

export function TemperatureForm({ initialData, onCancel, onSuccess }: TemperatureFormProps) {
  const user = getAuthUser();
  const [data, setData] = useState<Partial<CalibrationData>>({
    clientName: initialData?.clientName || '',
    instrumentTag: initialData?.instrumentTag || '',
    instrumentDescription: initialData?.instrumentDescription || '',
    workOrderId: initialData?.workOrderId || '',
    instrumentId: initialData?.instrumentId || '',
    magnitude: 'temperature',
    metadata: {
      rangeMin: (initialData?.metadata as any)?.rangeMin || 0,
      rangeMax: (initialData?.metadata as any)?.rangeMax || 100,
      resolution: (initialData?.metadata as any)?.resolution || 0.1,
      accuracyClass: (initialData?.metadata as any)?.accuracyClass || '1.0',
      subcategory: (initialData?.metadata as any)?.subcategory || 'rtd',
    },
    measurements: []
  });

  const [notes, setNotes] = useState(initialData?.notes || '');
  const [status, setStatus] = useState<CalibrationStatus>(initialData?.status || CalibrationStatus.DRAFT);
  const [uncertainty, setUncertainty] = useState<UncertaintyResults | undefined>(initialData?.uncertaintyResults);
  const [isCalculating, setIsCalculating] = useState(false);

  const [points, setPoints] = useState<Measurement[]>(
    initialData?.measurements && initialData.measurements.length > 0 
    ? initialData.measurements 
    : [{ standardValue: 0, instrumentValue: 0, unit: '°C', timestamp: Date.now() }]
  );

  const addPoint = () => {
    setPoints([...points, { standardValue: 0, instrumentValue: 0, unit: '°C', timestamp: Date.now() }]);
  };

  const removePoint = (index: number) => {
    setPoints(points.filter((_, i) => i !== index));
  };

  const updatePoint = (index: number, field: keyof Measurement, value: any) => {
    const newPoints = [...points];
    newPoints[index] = { ...newPoints[index], [field]: parseFloat(value) || 0 };
    setPoints(newPoints);
  };

  const [errors, setErrors] = useState<string[]>([]);

  const validateForm = () => {
    const errs: string[] = [];
    if (!data.clientName?.trim()) errs.push('El nombre del cliente es obligatorio.');
    if (!data.instrumentTag?.trim()) errs.push('El Tag del equipo es obligatorio.');
    
    const rMin = data.metadata?.rangeMin ?? 0;
    const rMax = data.metadata?.rangeMax ?? 0;
    if (rMin >= rMax) errs.push('El rango mínimo debe ser menor al máximo.');
    
    if (points.length === 0) errs.push('Debe registrar al menos un punto de medición.');
    
    setErrors(errs);
    return errs.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;

    const id = initialData?.id || crypto.randomUUID();
    const isNew = !initialData?.id;
    const previousStatus = initialData?.status;
    const hasStatusChanged = status !== previousStatus;

    const historyEntry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      author: user?.name || 'Técnico de Campo',
      message: isNew 
        ? `Captura inicial de temperatura en estado ${status}.` 
        : hasStatusChanged 
          ? `Cambio de estado: ${previousStatus} -> ${status}.` 
          : 'Actualización de datos de temperatura.',
      type: 'system'
    };

    const calibration: CalibrationData = {
      ...(data as CalibrationData),
      id,
      measurements: points,
      status,
      uncertaintyResults: uncertainty,
      createdAt: initialData?.createdAt || Date.now(),
      updatedAt: Date.now(),
      technicianId: user?.id || 'anonymous',
      technicianName: user?.name,
      technicianEmail: user?.email,
      history: [...(initialData?.history || []), historyEntry],
      notes
    } as any;

    await db.calibrations.put(calibration);

    if (data.workOrderId && data.instrumentId) {
      const order = await db.workOrders.get(data.workOrderId);
      if (order) {
        const updatedInstruments = order.instruments.map(inst => 
          inst.id === data.instrumentId ? { ...inst, status: 'completed' as const } : inst
        );
        const newStatus = calculateOrderStatus(updatedInstruments);
        await db.workOrders.update(data.workOrderId, { 
          instruments: updatedInstruments as any,
          status: newStatus
        });
      }
    }
    
    onSuccess();
  };

  const runMonteCarlo = () => {
    setIsCalculating(true);
    setTimeout(() => {
      const res = data.metadata?.resolution || 0.1;
      const acc = parseFloat(data.metadata?.accuracyClass || '1.0');
      const sources = getStandardSources(res, acc, 0.05); // Standard for Temp
      const results = estimateUncertaintyMonteCarlo(sources, 10000, 2.0);
      setUncertainty(results);
      setIsCalculating(false);
    }, 1200);
  };

  const previewCertificate = async () => {
    const currentCalibration: CalibrationData = {
      ...(data as CalibrationData),
      id: initialData?.id || 'TEMP-' + Date.now(),
      measurements: points,
      uncertaintyResults: uncertainty,
      status
    } as any;
    const doc = await generateDraftCertificate(currentCalibration);
    window.open(doc.output('bloburl'), '_blank');
  };

  return (
    <div className="bg-white border border-[#141414]/10 rounded-3xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-300 mb-10">
      <div className="p-8 border-b border-[#141414]/10 bg-blue-50/20 flex justify-between items-center">
        <div className="flex items-center gap-6">
          <button 
            type="button" 
            onClick={onCancel}
            className="group flex flex-col items-center gap-1 transition-all"
          >
            <div className="p-3 bg-white border border-[#141414]/10 rounded-2xl group-hover:bg-red-50 group-hover:border-red-200 transition-all shadow-sm">
              <XCircle className="w-5 h-5 text-[#141414]/20 group-hover:text-red-500 transition-colors" />
            </div>
            <span className="text-[8px] font-black uppercase tracking-widest text-[#141414]/30 group-hover:text-red-600 transition-colors">Cancelar</span>
          </button>
          <div>
            <h3 className="text-xl font-bold text-[#141414]">Módulo de Temperatura</h3>
            <p className="text-sm text-[#141414]/60">Calibración termométrica de precisión.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <select 
            className="bg-white border border-[#141414]/10 p-2 rounded-xl text-xs font-black uppercase tracking-wider outline-none"
            value={status}
            onChange={e => setStatus(e.target.value as CalibrationStatus)}
          >
            {Object.values(CalibrationStatus).map(s => (
              <option key={s} value={s}>{s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-8 space-y-8">
        {errors.length > 0 && (
          <div className="bg-red-50 border border-red-200 p-4 rounded-2xl">
            {errors.map((err, idx) => <p key={idx} className="text-[10px] font-black text-red-600 uppercase tracking-widest">{err}</p>)}
          </div>
        )}

        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Equipo</label>
            <div className="p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl font-black text-[#141414]">
              {data.instrumentTag} - {data.instrumentDescription}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Subcategoría</label>
            <select 
              className="w-full p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none font-bold text-xs"
              value={data.metadata?.subcategory}
              onChange={e => setData({...data, metadata: {...data.metadata!, subcategory: e.target.value}})}
            >
              <option value="rtd">Termoresistencia (RTD)</option>
              <option value="thermocouple">Termocupla (K/J/T)</option>
              <option value="liquid_glass">Líquido en Vidrio</option>
              <option value="digital_thermometer">Termómetro Digital</option>
            </select>
          </div>
        </section>

        <section className="bg-blue-600 text-white p-6 rounded-2xl grid grid-cols-3 gap-6 relative overflow-hidden">
          {uncertainty && (
            <div className="absolute top-0 right-0 p-2 bg-emerald-500 text-white text-[8px] font-black uppercase tracking-widest z-10">
              U. Estimada
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[9px] font-bold uppercase tracking-widest text-white/60">Resolución</label>
            <input 
              type="number" step="0.01"
              className="w-full bg-white/10 border border-white/10 rounded-xl p-2 outline-none focus:bg-white/20"
              value={data.metadata?.resolution ?? ''}
              onChange={e => setData({...data, metadata: {...data.metadata!, resolution: parseFloat(e.target.value) || 0}})}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-bold uppercase tracking-widest text-white/60">Rango Min (°C)</label>
            <input type="number" className="w-full bg-white/10 border border-white/10 rounded-xl p-2" value={data.metadata?.rangeMin} readOnly />
          </div>
          <div className="space-y-1">
            <label className="text-[9px] font-bold uppercase tracking-widest text-white/60">Rango Max (°C)</label>
            <input type="number" className="w-full bg-white/10 border border-white/10 rounded-xl p-2" value={data.metadata?.rangeMax} readOnly />
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={runMonteCarlo}
            disabled={isCalculating}
            className={cn(
              "p-6 rounded-2xl border-2 flex items-center justify-between transition-all group",
              uncertainty 
                ? "bg-blue-50 border-blue-200 text-blue-700" 
                : "bg-white border-[#141414]/5 text-[#141414]/40 hover:border-blue-200 hover:text-blue-600"
            )}
          >
            <div className="flex items-center gap-4">
              <div className={cn("p-3 rounded-xl", uncertainty ? "bg-blue-100" : "bg-[#F5F5F0] group-hover:bg-blue-50")}>
                {isCalculating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Zap className="w-5 h-5" />}
              </div>
              <div className="text-left">
                <h5 className="text-[10px] font-black uppercase tracking-[0.2em]">Cálculo Incertidumbre</h5>
                <p className="text-[9px] font-bold opacity-60 uppercase">{uncertainty ? `Expandida: ±${uncertainty.expanded.toFixed(6)}` : 'Simulación Monte Carlo'}</p>
              </div>
            </div>
          </button>

          <button
            type="button"
            onClick={previewCertificate}
            className="p-6 rounded-2xl border-2 bg-white border-[#141414]/5 text-[#141414]/40 hover:border-emerald-200 hover:text-emerald-600 flex items-center gap-4 transition-all group"
          >
            <div className="p-3 rounded-xl bg-[#F5F5F0] group-hover:bg-emerald-50">
              <FileText className="w-5 h-5" />
            </div>
            <div className="text-left">
              <h5 className="text-[10px] font-black uppercase tracking-[0.2em]">Ver Borrador</h5>
              <p className="text-[9px] font-bold opacity-60 uppercase">PDF Preliminar</p>
            </div>
          </button>
        </section>

        <section>
          <div className="flex justify-between items-center mb-4">
            <h4 className="font-bold text-[#141414] flex items-center gap-2">
              <Calculator className="w-4 h-4" />
              Lecturas de Temperatura
            </h4>
            <button type="button" onClick={addPoint} className="text-xs font-black uppercase text-blue-600 flex items-center gap-1">
              <Plus className="w-3 h-3" /> Añadir Punto
            </button>
          </div>

          <div className="space-y-3">
            {points.map((point, index) => (
              <div key={index} className="flex gap-4 items-end bg-[#F5F5F0]/30 p-4 rounded-2xl">
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-bold text-[#141414]/30 uppercase ml-1">Referencia (°C)</label>
                  <input 
                    type="number" step="any"
                    className="w-full p-4 bg-white border border-[#141414]/5 rounded-xl outline-none font-mono"
                    value={point.standardValue ?? ''}
                    onChange={e => updatePoint(index, 'standardValue', e.target.value)}
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-[9px] font-bold text-[#141414]/30 uppercase ml-1">Bajo Prueba (°C)</label>
                  <input 
                    type="number" step="any"
                    className="w-full p-4 bg-white border border-[#141414]/5 rounded-xl outline-none font-mono"
                    value={point.instrumentValue ?? ''}
                    onChange={e => updatePoint(index, 'instrumentValue', e.target.value)}
                  />
                </div>
                <button type="button" onClick={() => removePoint(index)} className="p-3 text-[#141414]/20 hover:text-red-600 overflow-hidden">
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[#141414]/40 px-1">Comentario Local</label>
          <textarea 
            className="w-full p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none font-medium h-24 resize-none"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Ej: Estabilización lenta en punto 3..."
          />
        </section>

        <div className="pt-8 border-t border-[#141414]/10 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-8 py-4 text-xs font-black uppercase tracking-widest text-[#141414]/40">Cancelar</button>
          <button type="submit" className="bg-blue-600 text-white px-12 py-4 rounded-3xl font-black text-xs uppercase tracking-widest flex items-center gap-2">
            <Save className="w-4 h-4" /> Guardar Termometría
          </button>
        </div>
      </form>
    </div>
  );
}
