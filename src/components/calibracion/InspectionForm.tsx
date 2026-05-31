import React, { useState } from 'react';
import { CalibrationData, CalibrationStatus, LogEntry } from '../../types';
import { Save, History, Clock, User, ClipboardCheck, AlertTriangle, CheckCircle2, Trash2, XCircle } from 'lucide-react';
import { db } from '../../lib/db';
import { cn, calculateOrderStatus } from '../../lib/utils';
import { getAuthUser } from '../../lib/auth';

interface InspectionFormProps {
  initialData?: Partial<CalibrationData>;
  onCancel: () => void;
  onSuccess: () => void;
}

export function InspectionForm({ initialData, onCancel, onSuccess }: InspectionFormProps) {
  const user = getAuthUser();
  const [data, setData] = useState<Partial<CalibrationData>>({
    clientName: initialData?.clientName || '',
    instrumentTag: initialData?.instrumentTag || '',
    instrumentDescription: initialData?.instrumentDescription || '',
    workOrderId: initialData?.workOrderId || '',
    instrumentId: initialData?.instrumentId || '',
    magnitude: 'inspection' as any,
    metadata: {
      subcategory: (initialData?.metadata as any)?.subcategory || 'visual_inspection',
    }
  });

  const [notes, setNotes] = useState(initialData?.notes || '');
  const [status, setStatus] = useState<CalibrationStatus>(initialData?.status || CalibrationStatus.DRAFT);
  const [findings, setFindings] = useState<string[]>([]);
  const [newFinding, setNewFinding] = useState('');

  const addFinding = () => {
    if (newFinding.trim()) {
      setFindings([...findings, newFinding.trim()]);
      setNewFinding('');
    }
  };

  const removeFinding = (idx: number) => {
    setFindings(findings.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const id = initialData?.id || crypto.randomUUID();
    const isNew = !initialData?.id;

    const historyEntry: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      author: user?.name || 'Inspector de Campo',
      message: isNew 
        ? `Inspección inicial bajo ISO 17020 iniciada.` 
        : `Actualización de reporte de inspección.`,
      type: 'system'
    };

    const calibration: CalibrationData = {
      ...(data as CalibrationData),
      id,
      measurements: findings.map(f => ({ standardValue: 0, instrumentValue: 1, unit: 'hallazgo', timestamp: Date.now() })), 
      status,
      createdAt: initialData?.createdAt || Date.now(),
      updatedAt: Date.now(),
      technicianId: user?.id || 'anonymous',
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

  return (
    <div className="bg-white border border-[#141414]/10 rounded-3xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-300 mb-10">
      <div className="p-8 border-b border-[#141414]/10 bg-emerald-50/20 flex justify-between items-center">
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
            <h3 className="text-xl font-bold text-[#141414]">Módulo de Inspección (ISO 17020)</h3>
            <p className="text-sm text-[#141414]/60">Evaluación de conformidad y ensayos No Destructivos.</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-8 space-y-8">
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl">
            <label className="text-[10px] font-black uppercase text-[#141414]/40 mb-1 block">Ítem Inspeccionado</label>
            <div className="font-black text-sm">{data.instrumentTag}</div>
            <div className="text-xs text-[#141414]/60">{data.instrumentDescription}</div>
          </div>
          <div className="p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl">
            <label className="text-[10px] font-black uppercase text-[#141414]/40 mb-1 block">Tipo de Inspección</label>
            <select 
              className="w-full bg-transparent border-none outline-none font-bold text-xs"
              value={data.metadata?.subcategory}
              onChange={e => setData({...data, metadata: {...data.metadata!, subcategory: e.target.value}})}
            >
              <option value="visual_inspection">Inspección Visual</option>
              <option value="ultrasound">Ultrasonido (Nivel II)</option>
              <option value="magnetic_particles">Partículas Magnéticas</option>
              <option value="hydrostatic_test">Prueba Hidrostática</option>
            </select>
          </div>
        </section>

        <section className="space-y-4">
          <h4 className="text-[10px] font-black uppercase tracking-widest text-[#141414]/40 border-b border-[#141414]/5 pb-2">Hallazgos y Observaciones Detalladas</h4>
          
          <div className="flex gap-2">
            <input 
              type="text" 
              value={newFinding}
              onChange={e => setNewFinding(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), addFinding())}
              placeholder="Describa un hallazgo técnico..."
              className="flex-1 p-4 bg-[#F5F5F0]/50 border border-[#141414]/10 rounded-2xl outline-none"
            />
            <button 
              type="button" 
              onClick={addFinding}
              className="px-6 bg-[#141414] text-white rounded-2xl font-black text-[10px] uppercase tracking-widest"
            >
              Añadir
            </button>
          </div>

          <div className="space-y-2">
            {findings.map((f, idx) => (
              <div key={idx} className="flex justify-between items-center bg-white border border-[#141414]/5 p-4 rounded-2xl shadow-sm">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  <span className="text-xs font-bold text-[#141414]/70">{f}</span>
                </div>
                <button type="button" onClick={() => removeFinding(idx)} className="text-red-400 hover:text-red-600 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section>
          <label className="text-[10px] font-black uppercase tracking-widest text-[#141414]/40 mb-2 block">Dictamen Final</label>
          <div className="grid grid-cols-2 gap-4">
            <button 
              type="button"
              onClick={() => setStatus(CalibrationStatus.PRELIMINARY)}
              className={cn(
                "p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all",
                status === CalibrationStatus.PRELIMINARY ? "bg-emerald-500 text-white border-emerald-600 shadow-xl" : "bg-white border-[#141414]/10 text-[#141414]/40"
              )}
            >
              <CheckCircle2 className="w-6 h-6" />
              <span className="text-[10px] font-black uppercase tracking-widest">Conforme / Apto</span>
            </button>
            <button 
              type="button"
              onClick={() => setStatus(CalibrationStatus.DRAFT)}
              className={cn(
                "p-4 rounded-2xl border flex flex-col items-center gap-2 transition-all",
                status === CalibrationStatus.DRAFT ? "bg-amber-500 text-white border-amber-600 shadow-xl" : "bg-white border-[#141414]/10 text-[#141414]/40"
              )}
            >
              <AlertTriangle className="w-6 h-6" />
              <span className="text-[10px] font-black uppercase tracking-widest">En Proceso / Pendiente</span>
            </button>
          </div>
        </section>

        <div className="pt-8 border-t border-[#141414]/10 flex justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-8 py-4 text-xs font-black uppercase tracking-widest text-gray-400">Descartar</button>
          <button type="submit" className="bg-[#141414] text-white px-12 py-4 rounded-3xl font-black text-xs uppercase tracking-widest">
            Confirmar Inspección
          </button>
        </div>
      </form>
    </div>
  );
}
