import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { syncService } from '../lib/SyncService';
import { WorkOrder, WorkOrderInstrument, LogEntry, SyncOperation, CalibrationData } from '../types';
import { 
  ChevronLeft, 
  Gauge, 
  Calendar as CalendarIcon, 
  MapPin, 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  ChevronRight,
  BadgeInfo,
  BadgeCheck,
  FlaskConical,
  Hammer,
  Lightbulb,
  Clock,
  History,
  MessageSquare,
  RefreshCw,
  User,
  ShieldCheck,
  Send,
  BookOpen,
  Bookmark,
  Paperclip,
  FileText,
  Image as ImageIcon,
  X,
  SearchCode,
  Thermometer,
  Wrench,
  Activity,
  ClipboardCheck,
  AlertTriangle,
  Maximize2,
  Minimize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, calculateOrderStatus } from '../lib/utils';

import { db as firestore } from '../lib/firebase';
import { collection, addDoc, serverTimestamp, setDoc, doc } from 'firebase/firestore';
import { getAuthUser } from '../lib/auth';

export function OrderDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const user = getAuthUser();
  const order = useLiveQuery(
    () => id ? db.workOrders.get(id) : undefined,
    [id]
  );
  const [loading, setLoading] = useState(true);
  const [newLog, setNewLog] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReportingKB, setIsReportingKB] = useState<string | null>(null);
  const [kbForm, setKbForm] = useState<{ title: string, content: string, attachments: File[] }>({ 
    title: '', 
    content: '',
    attachments: []
  });

  const [isAddingInstrument, setIsAddingInstrument] = useState(false);
  const [confirmAdd, setConfirmAdd] = useState(false);
  const [addingObservation, setAddingObservation] = useState('');
  
  const [isRemovingInstrument, setIsRemovingInstrument] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeObservation, setRemoveObservation] = useState('');

  const [newInstrument, setNewInstrument] = useState<Partial<WorkOrderInstrument>>({
    magnitude: 'pressure',
    status: 'pending',
    standard: 'ISO 17025',
    serviceType: 'calibration',
    rangeMin: 0,
    rangeMax: 100,
    unit: 'psi',
    accuracy: '1.0'
  });

  const calibrations = useLiveQuery(
    () => id ? db.calibrations.where('workOrderId').equals(id).toArray() : [],
    [id]
  );

  // Sincronizar estados de equipos si hay discrepancias
  useEffect(() => {
    if (order && calibrations) {
      let changed = false;
      const updatedInstruments = order.instruments.map(inst => {
        const cal = calibrations.find(c => c.instrumentId === inst.id);
        if (cal && inst.status === 'pending') {
          changed = true;
          return { ...inst, status: 'completed' as const };
        }
        return inst;
      });

      if (changed) {
        db.workOrders.update(order.id, { 
          instruments: updatedInstruments as any,
          status: order.status === 'pending' ? 'in_progress' : order.status
        });
      }
    }
  }, [order, calibrations]);

  const [syncState, setSyncState] = useState<'synced' | 'pending' | 'syncing' | 'error'>('synced');
  const [pendingOps, setPendingOps] = useState<SyncOperation[]>([]);
  const [techSummary, setTechSummary] = useState<{workPerformed: string, findings: string, recommendations: string} | null>(null);
  const [isEditingSummary, setIsEditingSummary] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    const checkSync = async () => {
      if (id) {
        const status = await syncService.getStatusForOrder(id);
        // Obtener historial reciente de sincronización para esta orden
        const allOps = await db.syncQueue
          .orderBy('createdAt')
          .reverse()
          .limit(50)
          .toArray();
        
        const filteredOps = allOps.filter(o => o.payload.orderId === id || o.payload.id === id);
        
        setSyncState(status);
        setPendingOps(filteredOps);
      }
    };
    checkSync();
    const interval = setInterval(checkSync, 3000); // More frequent updates
    return () => clearInterval(interval);
  }, [id]);

  useEffect(() => {
    if (order) {
      if (order.technicalSummary) {
        setTechSummary(order.technicalSummary);
      } else {
        setTechSummary({
          workPerformed: '',
          findings: '',
          recommendations: ''
        });
      }
      setLoading(false);
    } else if (order === null) {
      setLoading(false);
    }
  }, [order]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, isKB: boolean = false) => {
    const files = Array.from(e.target.files || []);
    if (isKB) {
      setKbForm(prev => ({ ...prev, attachments: [...prev.attachments, ...files] }));
    } else {
      setSelectedFiles(prev => [...prev, ...files]);
    }
  };

  const handleKBSubmit = async () => {
    if (!order || !isReportingKB || !kbForm.title || !kbForm.content || !user) return;
    
    const instrument = order.instruments.find(i => i.id === isReportingKB);
    if (!instrument) return;

    try {
      const attachmentsData = kbForm.attachments.map(f => ({
        name: f.name,
        type: f.type,
        url: URL.createObjectURL(f)
      }));

      const hallazgoId = crypto.randomUUID();
      const findingData = {
        id: hallazgoId,
        orderId: order.id,
        instrumentId: instrument.id,
        title: kbForm.title,
        content: kbForm.content,
        technicianId: user.id || 'anonymous',
        createdAt: Date.now(),
        attachments: attachmentsData
      };

      // 1. Save to Local Dexie
      await db.findings.put(findingData);

      // 2. Add to Sync Queue
      await syncService.enqueue('save_finding', { id: hallazgoId });

      // 3. Try to notify ERP (optional)
      try {
        await fetch('/api/dolibarr/kb-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...findingData,
            serviceType: instrument.magnitude
          })
        });
      } catch (e) {
        console.warn("ERP notification failed, finding queued for Firestore/Sync");
      }

      addLog(
        `Conocimiento Técnico reportado (${kbForm.title}). Archivos: ${kbForm.attachments.length}`, 
        'system',
        attachmentsData
      );
      setKbForm({ title: '', content: '', attachments: [] });
      setIsReportingKB(null);
      alert('Hallazgo técnico guardado localmente y en cola de sincronización.');
    } catch (error) {
      console.error('Error reporting to KB:', error);
      alert('Error guardando hallazgo técnico.');
    }
  };

  const addLog = async (message: string, type: LogEntry['type'] = 'observation', overrideAttachments?: LogEntry['attachments']) => {
    if (!order || (!message.trim() && !selectedFiles.length && !overrideAttachments)) return;

    const attachments = overrideAttachments || selectedFiles.map(f => ({
      name: f.name,
      type: f.type,
      url: URL.createObjectURL(f)
    }));

    const log: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      author: 'Técnico de Campo',
      message: message.trim() || (attachments.length > 0 ? 'Adjunto(s) técnicos añadidos' : ''),
      type,
      attachments
    };

    const updatedLogs = [...(order.logs || []), log];
    await db.workOrders.update(order.id, { logs: updatedLogs });
    setNewLog('');
    setSelectedFiles([]);
  };

  const syncOrder = async () => {
    if (!order) return;
    setIsSyncing(true);
    // Simulate sync
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    const syncLog: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      author: 'Sistema',
      message: 'Sincronización manual completada con éxito',
      type: 'system'
    };

    const updatedOrder = {
      ...order,
      syncStatus: 'synced' as const,
      lastSyncAt: Date.now(),
      logs: [...(order.logs || []), syncLog]
    };

    await db.workOrders.update(order.id, updatedOrder);
    setIsSyncing(false);
  };

  const markAsNonCalibratable = async (instId: string) => {
    const reason = prompt('Indique el motivo por el cual el equipo no puede calibrarse:');
    if (!reason || !order) return;

    const log: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      author: 'Técnico de Campo',
      message: `Equipo ${instId} marcado como No Calibrable. Motivo: ${reason}`,
      type: 'alert'
    };

    const updatedInstruments = order.instruments.map(inst => 
      inst.id === instId ? { ...inst, status: 'non_calibratable', notes: reason } : inst
    );

    const updatedOrder = {
      ...order,
      instruments: updatedInstruments,
      logs: [...(order.logs || []), log],
      status: calculateOrderStatus(updatedInstruments)
    };

    await db.workOrders.update(order.id, { 
      instruments: updatedInstruments as any,
      logs: updatedOrder.logs,
      status: updatedOrder.status
    });
  };

  const addInstrument = async () => {
    if (!order || !newInstrument.tag || !newInstrument.description || !confirmAdd) {
      alert('Por favor complete los campos obligatorios (Tag y Descripción) y confirme la acción.');
      return;
    }

    // Validaciones lógicas y de formato
    const rMin = Number(newInstrument.rangeMin);
    const rMax = Number(newInstrument.rangeMax);

    if (isNaN(rMin) || isNaN(rMax)) {
      alert('Los rangos deben ser valores numéricos.');
      return;
    }

    if (rMin >= rMax) {
      alert('El rango mínimo debe ser menor al rango máximo.');
      return;
    }

    if (!newInstrument.unit || newInstrument.unit.trim().length === 0) {
      alert('Debe especificar una unidad de medida.');
      return;
    }

    if (!newInstrument.accuracy || newInstrument.accuracy.trim().length === 0) {
      alert('Debe especificar la exactitud o clase del equipo.');
      return;
    }

    const instrument: WorkOrderInstrument = {
      id: `I-NEW-${crypto.randomUUID().slice(0, 4)}`,
      tag: newInstrument.tag.trim(),
      description: newInstrument.description.trim(),
      magnitude: newInstrument.magnitude as any,
      subcategory: newInstrument.subcategory || 'field_addition',
      rangeMin: rMin,
      rangeMax: rMax,
      unit: newInstrument.unit.trim(),
      accuracy: newInstrument.accuracy.trim(),
      status: 'pending',
      standard: (newInstrument.standard as any) || 'ISO 17025',
      serviceType: (newInstrument.serviceType as any) || 'calibration',
    };

    const updatedInstruments = [...order.instruments, instrument];
    const log: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      author: 'Técnico de Campo',
      message: `Nuevo equipo añadido a la orden: ${instrument.tag} (${instrument.description})${addingObservation ? ` - Nota: ${addingObservation}` : ''}`,
      type: 'system'
    };

    const updatedOrder = {
      ...order,
      instruments: updatedInstruments,
      syncStatus: 'pending' as const,
      logs: [...(order.logs || []), log],
      status: calculateOrderStatus(updatedInstruments)
    };

    await db.workOrders.update(order.id, updatedOrder);
    
    // Enqueue for Dolibarr Sync
    await syncService.enqueue('add_instrument', { 
      orderId: order.id, 
      instrument,
      observation: addingObservation 
    });

    setConfirmAdd(false);
    setAddingObservation('');
    setNewInstrument({
      magnitude: 'pressure',
      status: 'pending',
      standard: 'ISO 17025',
      serviceType: 'calibration',
      rangeMin: 0,
      rangeMax: 100,
      unit: 'psi',
      accuracy: '1.0'
    });
  };

  const removeInstrument = async () => {
    if (!order || !removingId || !removeObservation || !confirmRemove) return;

    const instrument = order.instruments.find(i => i.id === removingId);
    if (!instrument) return;

    const updatedInstruments = order.instruments.filter(i => i.id !== removingId);
    const log: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      author: 'Técnico de Campo',
      message: `Equipo REMOVIDO de la orden: ${instrument.tag}${removeObservation ? ` - Justificación: ${removeObservation}` : ''}`,
      type: 'alert'
    };

    const updatedOrder = {
      ...order,
      instruments: updatedInstruments,
      syncStatus: 'pending' as const,
      logs: [...(order.logs || []), log],
      status: calculateOrderStatus(updatedInstruments)
    };

    await db.workOrders.update(order.id, updatedOrder);

    // Enqueue for Dolibarr Sync
    await syncService.enqueue('remove_instrument', { 
      orderId: order.id, 
      instrumentId: removingId,
      observation: removeObservation 
    });

    setRemovingId(null);
    setConfirmRemove(false);
    setRemoveObservation('');
  };

  const startCalibration = (instrument: WorkOrderInstrument) => {
    if (!order) return;
    
    const calibrationData: any = {
      id: crypto.randomUUID(),
      workOrderId: order.id,
      instrumentId: instrument.id,
      instrumentTag: instrument.tag,
      instrumentDescription: instrument.description,
      magnitude: instrument.magnitude,
      clientName: order.clientName,
      status: 'draft', // Consistent with CalibrationStatus.DRAFT
      createdAt: Date.now(),
      updatedAt: Date.now(),
      metadata: {
        instrumentId: instrument.id,
        tag: instrument.tag,
        description: instrument.description,
        brand: (instrument as any).brand,
        model: (instrument as any).model,
        serialNumber: (instrument as any).serialNumber,
        rangeMin: instrument.rangeMin,
        rangeMax: instrument.rangeMax,
        nominalRangeMin: instrument.rangeMin,
        nominalRangeMax: instrument.rangeMax,
        calibrationRangeMin: instrument.rangeMin,
        calibrationRangeMax: instrument.rangeMax,
        unit: instrument.unit,
        accuracyClass: instrument.accuracy,
        location: order.location
      },
      measurements: [],
      history: [{
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        author: 'Técnico de Campo',
        message: 'Borrador de calibración iniciado desde orden de trabajo',
        type: 'info'
      }]
    };
    
    navigate('/calibracion', { state: { order: calibrationData } });
  };

  const saveTechnicalSummary = async () => {
    if (!order || !techSummary) return;
    
    const updatedSummary = {
      ...techSummary,
      updatedAt: Date.now()
    };
    
    const updatedOrder = {
      ...order,
      technicalSummary: updatedSummary,
      syncStatus: 'pending' as const
    };
    
    await db.workOrders.update(order.id, updatedOrder);
    
    // Enqueue for sync
    await syncService.enqueue('update_order', {
      orderId: order.id,
      technicalSummary: updatedSummary
    });
    
    setIsEditingSummary(false);
    
    const log: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      author: 'Técnico de Campo',
      message: 'Resumen Técnico de la orden actualizado',
      type: 'system'
    };
    
    const finalOrderLogs = [...(order.logs || []), log];
    await db.workOrders.update(order.id, { logs: finalOrderLogs });
  };

  if (loading) return <div className="p-20 text-center font-black animate-pulse">CARGANDO HOJA TÉCNICA...</div>;
  if (!order) return <div className="p-20 text-center">Orden no encontrada</div>;

  const completed = order.instruments.filter(i => i.status !== 'pending').length;
  const progress = Math.round((completed / order.instruments.length) * 100);

  return (
    <div className="max-w-[1600px] mx-auto pb-20 px-4">
      {/* Modal para Agregar Instrumento */}
      {isAddingInstrument && (
        <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="bg-[#141414] p-6 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <BadgeInfo className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-black uppercase tracking-widest">Agregar Equipo/Servicio a la Orden</h3>
              </div>
              <button onClick={() => setIsAddingInstrument(false)} className="text-white/40 hover:text-white transition-colors">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">TAG / ID Equipo</label>
                  <input 
                    type="text"
                    value={newInstrument.tag || ''}
                    onChange={(e) => setNewInstrument({...newInstrument, tag: e.target.value})}
                    placeholder="Ej: PT-1002"
                    className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Descripción</label>
                  <input 
                    type="text"
                    value={newInstrument.description || ''}
                    onChange={(e) => setNewInstrument({...newInstrument, description: e.target.value})}
                    placeholder="Ej: Transmisor de Presión Diferencial"
                    className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-emerald-500 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Servicio Principal</label>
                <select 
                  value={newInstrument.serviceType}
                  onChange={(e) => setNewInstrument({...newInstrument, serviceType: e.target.value as any})}
                  className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-emerald-500 outline-none appearance-none"
                >
                  <option value="calibration">Calibración (17025)</option>
                  <option value="inspection">Inspección (17020)</option>
                  <option value="repair">Reparación (9001)</option>
                  <option value="maintenance">Mantenimiento (9001)</option>
                  <option value="functional_test">Prueba Funcionamiento</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Normativa Aplicable</label>
                <select 
                  value={newInstrument.standard}
                  onChange={(e) => setNewInstrument({...newInstrument, standard: e.target.value as any})}
                  className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-emerald-500 outline-none appearance-none"
                >
                  <option value="ISO 17025">ISO 17025</option>
                  <option value="ISO 17020">ISO 17020</option>
                  <option value="ISO 9001">ISO 9001</option>
                  <option value="Norma Interna">Norma Interna</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Rango Min</label>
                  <input 
                    type="number"
                    value={newInstrument.rangeMin}
                    onChange={(e) => setNewInstrument({...newInstrument, rangeMin: Number(e.target.value)})}
                    className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Rango Max</label>
                  <input 
                    type="number"
                    value={newInstrument.rangeMax}
                    onChange={(e) => setNewInstrument({...newInstrument, rangeMax: Number(e.target.value)})}
                    className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Unidad / Exactitud</label>
                <div className="grid grid-cols-2 gap-2">
                  <input 
                    type="text"
                    value={newInstrument.unit}
                    onChange={(e) => setNewInstrument({...newInstrument, unit: e.target.value})}
                    placeholder="psi"
                    className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] outline-none"
                  />
                  <input 
                    type="text"
                    value={newInstrument.accuracy}
                    onChange={(e) => setNewInstrument({...newInstrument, accuracy: e.target.value})}
                    placeholder="Clase"
                    className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] outline-none"
                  />
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Observaciones / Justificación</label>
                <textarea 
                  value={addingObservation}
                  onChange={(e) => setAddingObservation(e.target.value)}
                  placeholder="Explique por qué agrega este equipo..."
                  className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-emerald-500 outline-none h-20 resize-none"
                />
              </div>

              <div className="md:col-span-2 bg-emerald-50 p-4 rounded-2xl flex items-start gap-4">
                <input 
                  id="confirm-add"
                  type="checkbox"
                  checked={confirmAdd}
                  onChange={(e) => setConfirmAdd(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded-md border-emerald-200 text-emerald-600 focus:ring-emerald-500"
                />
                <label htmlFor="confirm-add" className="text-[10px] font-bold text-emerald-800 uppercase leading-relaxed cursor-pointer select-none">
                  Confirmo que deseo agregar este equipo/servicio a la orden. Entiendo que esta modificación es irreversible desde campo y será notificada a Dolibarr para auditoría.
                </label>
              </div>

              <div className="md:col-span-2 flex gap-4 pt-4">
                <button 
                  onClick={() => setIsAddingInstrument(false)}
                  className="flex-1 px-6 py-4 rounded-2xl border border-[#141414]/10 text-[10px] font-black uppercase tracking-widest text-[#141414]/40 hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={addInstrument}
                  disabled={!newInstrument.tag || !newInstrument.description || !confirmAdd}
                  className="flex-1 px-6 py-4 rounded-2xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] disabled:opacity-20 transition-all shadow-xl flex items-center justify-center gap-2"
                >
                  Confirmar y Agregar <ClipboardCheck className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal para Eliminar Instrumento */}
      {isRemovingInstrument && (
        <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="bg-red-600 p-6 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-white" />
                <h3 className="text-sm font-black uppercase tracking-widest">Eliminar Equipo de la Orden</h3>
              </div>
              <button 
                onClick={() => {
                  setIsRemovingInstrument(false);
                  setRemovingId(null);
                  setConfirmRemove(false);
                  setRemoveObservation('');
                }} 
                className="text-white/40 hover:text-white transition-colors"
              >
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-8 space-y-6">
              <div className="bg-red-50 p-4 rounded-2xl border border-red-100">
                <p className="text-[11px] font-bold text-red-800 uppercase leading-relaxed">
                  Está a punto de remover el equipo <span className="font-black underline">{order?.instruments.find(i => i.id === removingId)?.tag}</span> de esta orden de servicio.
                </p>
              </div>

              <div>
                <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Justificación de la Baja (Obligatorio)</label>
                <textarea 
                  value={removeObservation}
                  onChange={(e) => setRemoveObservation(e.target.value)}
                  placeholder="Explique por qué se elimina este equipo (ej: no se encontró en sitio, error de planeación, etc)..."
                  className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-red-500 outline-none h-24 resize-none"
                />
              </div>

              <div className="bg-amber-50 p-4 rounded-2xl flex items-start gap-4">
                <input 
                  id="confirm-remove"
                  type="checkbox"
                  checked={confirmRemove}
                  onChange={(e) => setConfirmRemove(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded-md border-amber-200 text-amber-600 focus:ring-amber-500"
                />
                <label htmlFor="confirm-remove" className="text-[10px] font-bold text-amber-800 uppercase leading-relaxed cursor-pointer select-none">
                  Confirmo que este equipo NO será ejecutado en esta visita. Esta acción será reportada a Dolibarr para re-facturación o auditoría.
                </label>
              </div>

              <div className="flex gap-4 pt-2">
                <button 
                  onClick={() => {
                    setIsRemovingInstrument(false);
                    setRemovingId(null);
                    setConfirmRemove(false);
                    setRemoveObservation('');
                  }}
                  className="flex-1 px-6 py-4 rounded-2xl border border-[#141414]/10 text-[10px] font-black uppercase tracking-widest text-[#141414]/40 hover:bg-gray-50 transition-all"
                >
                  Cancelar
                </button>
                <button 
                  onClick={removeInstrument}
                  disabled={!removeObservation || !confirmRemove}
                  className="flex-1 px-6 py-4 rounded-2xl bg-red-600 text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] disabled:opacity-20 transition-all shadow-xl flex items-center justify-center gap-2"
                >
                  Confirmar Baja <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Base de Conocimiento */}
      {isReportingKB && (
        <div className="fixed inset-0 bg-[#141414]/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="bg-[#141414] p-6 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5 text-blue-400" />
                <div>
                  <h3 className="text-sm font-black uppercase tracking-widest">Reportar a Dolibarr KB</h3>
                  <p className="text-[10px] text-white/50 font-bold uppercase mt-0.5">Hallazgo Técnico: {order.instruments.find(i => i.id === isReportingKB)?.tag}</p>
                </div>
              </div>
              <button onClick={() => setIsReportingKB(null)} className="text-white/40 hover:text-white transition-colors">
                <XCircle className="w-6 h-6" />
              </button>
            </div>
            
            <div className="p-8 space-y-6">
              <div>
                <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Título del Conocimiento</label>
                <input 
                  type="text"
                  placeholder="Ej: Procedimiento de ajuste para sensor de presión..."
                  value={kbForm.title}
                  onChange={(e) => setKbForm({...kbForm, title: e.target.value})}
                  className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              
              <div>
                <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Observación Técnica Detallada</label>
                <textarea 
                  placeholder="Describe el hallazgo técnico para futuros servicios..."
                  value={kbForm.content}
                  onChange={(e) => setKbForm({...kbForm, content: e.target.value})}
                  className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-blue-500 outline-none min-h-[120px] resize-none"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Adjuntar Evidencia (Imágenes/PDF)</label>
                <div className="flex flex-wrap gap-2 mb-3">
                  {kbForm.attachments.map((file, i) => (
                    <div key={i} className="flex items-center gap-2 bg-blue-50 text-blue-600 px-3 py-1.5 rounded-xl text-[10px] font-bold border border-blue-100 group">
                      <FileText className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[100px]">{file.name}</span>
                      <button 
                        onClick={() => setKbForm(prev => ({ ...prev, attachments: prev.attachments.filter((_, idx) => idx !== i) }))}
                        className="hover:text-red-500"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <label className="w-full flex items-center justify-center gap-2 p-4 border-2 border-dashed border-[#141414]/10 rounded-2xl hover:border-blue-400 hover:bg-blue-50/50 transition-all cursor-pointer group">
                  <input type="file" multiple className="hidden" onChange={(e) => handleFileSelect(e, true)} />
                  <Paperclip className="w-4 h-4 text-[#141414]/20 group-hover:text-blue-500" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-[#141414]/40 group-hover:text-blue-500">Subir Documentación Técnica</span>
                </label>
              </div>

              <div className="flex gap-4 pt-2">
                <button 
                  onClick={() => setIsReportingKB(null)}
                  className="flex-1 px-6 py-4 rounded-2xl border border-[#141414]/10 text-[10px] font-black uppercase tracking-widest text-[#141414]/40 hover:bg-gray-50 transition-all font-black"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleKBSubmit}
                  disabled={!kbForm.title || !kbForm.content}
                  className="flex-1 px-6 py-4 rounded-2xl bg-[#141414] text-white text-[10px] font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] disabled:opacity-20 transition-all shadow-xl flex items-center justify-center gap-2"
                >
                  Subir a Dolibarr <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Botón Volver */}
      <div className="flex justify-between items-center mb-6">
        <button 
          onClick={() => navigate('/ordenes')}
          className="flex items-center gap-2 text-[#141414]/40 hover:text-[#141414] transition-colors font-black uppercase text-[10px] tracking-widest"
        >
          <ChevronLeft className="w-4 h-4" /> Volver a mis órdenes
        </button>
        
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all duration-300",
            syncState === 'synced' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-amber-50 text-amber-600 border-amber-100",
          )}>
            <RefreshCw className={cn("w-3 h-3", syncState === 'syncing' && "animate-spin")} />
            {syncState === 'synced' ? "En Nube" : "Pendiente Sinc."}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
        
        {/* Columna Principal: 3/4 en XL */}
        <div className="xl:col-span-3 space-y-8">
          
          {/* Cabecera de la Orden (Rediseñada) */}
          <div className="bg-[#141414] rounded-[2.5rem] p-8 text-white shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full -mr-20 -mt-20 blur-3xl" />
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/10 rounded-full -ml-10 -mb-10 blur-3xl" />
            
            <div className="relative z-10">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                    <span className="bg-white/10 backdrop-blur-md text-white/60 text-[9px] px-3 py-1.5 rounded-full font-black uppercase tracking-[0.2em] border border-white/5">
                      Ficha Técnica OT-{order.id.split('-').pop()}
                    </span>
                    <div className={cn(
                      "px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest border transition-all duration-300",
                      order.status === 'completed' ? "bg-emerald-400/20 text-emerald-400 border-emerald-400/30" : 
                      order.status === 'in_progress' ? "bg-blue-400/20 text-blue-400 border-blue-400/30" : 
                      "bg-amber-400/20 text-amber-400 border-amber-400/30",
                    )}>
                      {order.status === 'completed' ? 'Estatus: Completado' : 
                       order.status === 'in_progress' ? 'Estatus: En Proceso' : 'Estatus: Pendiente'}
                    </div>
                    {order.isFieldCreated && (
                      <div className="px-3 py-1.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-400/30 text-[9px] font-black uppercase tracking-widest flex items-center gap-1.5 animate-pulse shadow-[0_0_15px_rgba(59,130,246,0.3)]">
                        <Activity className="w-3 h-3" /> Orden de Campo
                      </div>
                    )}
                  </div>
                  
                  <h1 className="text-4xl lg:text-5xl font-black tracking-tighter max-w-2xl leading-tight mb-2">{order.clientName}</h1>
                  
                  <div className="flex flex-wrap gap-6 text-[10px] font-black uppercase tracking-widest text-white/40 pl-1 mt-4">
                    <div className="flex items-center gap-2"><CalendarIcon className="w-4 h-4 text-blue-500" /> Programada: {new Date(order.scheduledDate).toLocaleDateString()}</div>
                    <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400" /> {order.instruments.filter(i => i.status !== 'pending').length} de {order.instruments.length} instrumentos</div>
                  </div>
                </div>

                <div className="bg-white/5 backdrop-blur-xl p-6 rounded-[2rem] border border-white/10 min-w-[200px]">
                  <div className="flex justify-between items-end mb-3">
                    <span className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">Progreso Real</span>
                    <span className="text-xl font-black text-emerald-400">{progress}%</span>
                  </div>
                  <div className="h-2.5 bg-white/5 rounded-full overflow-hidden mb-3">
                    <div 
                      className="h-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)] transition-all duration-1000" 
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <p className="text-[9px] text-white/20 font-bold uppercase tracking-widest text-center">
                    Cierre estimado hoy {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Tarjeta de Ubicación Independiente para Máximo Espacio */}
          <div className="bg-white border border-[#141414]/10 rounded-[2rem] p-8 shadow-sm flex items-start gap-6 hover:shadow-md transition-all group">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 flex items-center justify-center shrink-0 group-hover:bg-emerald-500 transition-colors duration-500">
              <MapPin className="w-8 h-8 text-emerald-500 group-hover:text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 text-emerald-600">
                <span className="text-[10px] font-black uppercase tracking-[0.2em]">SITIO DE EJECUCIÓN / DIRECCIÓN LOGÍSTICA</span>
                <span className="h-px flex-1 bg-emerald-100" />
              </div>
              <p className="text-2xl font-black text-[#141414] tracking-tight leading-relaxed">
                {order.location}
              </p>
            </div>
          </div>

          {/* Resumen Técnico */}
          <div className="bg-white border border-[#141414]/10 rounded-3xl p-8 shadow-sm">
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <ClipboardCheck className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h2 className="font-black text-[#141414] uppercase tracking-[0.2em] text-xs">Resumen Técnico de Ejecución</h2>
                  <p className="text-[9px] font-bold text-[#141414]/40 uppercase tracking-widest">Resumen de trabajos, hallazgos y recomendaciones</p>
                </div>
              </div>
              {!isEditingSummary && (
                <button 
                  onClick={() => setIsEditingSummary(true)}
                  className="px-4 py-2 rounded-xl bg-[#141414] text-white text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all"
                >
                  {order.technicalSummary ? 'Editar Resumen' : 'Redactar Resumen'}
                </button>
              )}
            </div>

            {isEditingSummary ? (
              <div className="space-y-6 animate-in fade-in duration-300">
                <div className="grid grid-cols-1 gap-6">
                  <div>
                    <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Trabajos Realizados</label>
                    <textarea 
                      value={techSummary?.workPerformed || ''}
                      onChange={(e) => setTechSummary(prev => ({ ...prev!, workPerformed: e.target.value }))}
                      placeholder="Describa las actividades principales ejecutadas..."
                      className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Hallazgos Clave</label>
                      <textarea 
                        value={techSummary?.findings || ''}
                        onChange={(e) => setTechSummary(prev => ({ ...prev!, findings: e.target.value }))}
                        placeholder="Desviaciones, fallas encontradas o estados iniciales..."
                        className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block">Recomendaciones</label>
                      <textarea 
                        value={techSummary?.recommendations || ''}
                        onChange={(e) => setTechSummary(prev => ({ ...prev!, recommendations: e.target.value }))}
                        placeholder="Acciones sugeridas al cliente para el mantenimiento..."
                        className="w-full bg-[#F5F5F0] border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-blue-500 outline-none h-24 resize-none"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button 
                    onClick={() => setIsEditingSummary(false)}
                    className="px-6 py-3 rounded-xl border border-[#141414]/10 text-[10px] font-black uppercase tracking-widest text-[#141414]/40 hover:bg-gray-50 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={saveTechnicalSummary}
                    className="px-6 py-3 rounded-xl bg-blue-500 text-white text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-lg flex items-center gap-2"
                  >
                    Guardar Resumen <Bookmark className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {!order.technicalSummary ? (
                  <div className="py-12 text-center border-2 border-dashed border-[#141414]/5 rounded-3xl">
                    <ClipboardCheck className="w-8 h-8 text-[#141414]/10 mx-auto mb-3" />
                    <p className="text-[10px] font-black text-[#141414]/30 uppercase tracking-widest">No se ha redactado un resumen técnico para esta orden</p>
                    <button 
                      onClick={() => setIsEditingSummary(true)}
                      className="mt-4 text-[10px] font-black text-blue-500 uppercase tracking-widest hover:underline"
                    >
                      Comenzar Redacción ahora
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="space-y-2">
                      <h4 className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Trabajos Realizados</h4>
                      <p className="text-[11px] font-bold text-[#141414]/70 leading-relaxed whitespace-pre-wrap">{order.technicalSummary.workPerformed}</p>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-[9px] font-black text-amber-500 uppercase tracking-widest">Hallazgos</h4>
                      <p className="text-[11px] font-bold text-[#141414]/70 leading-relaxed whitespace-pre-wrap">{order.technicalSummary.findings}</p>
                    </div>
                    <div className="space-y-2">
                      <h4 className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Recomendaciones</h4>
                      <p className="text-[11px] font-bold text-[#141414]/70 leading-relaxed whitespace-pre-wrap">{order.technicalSummary.recommendations}</p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Aseguramiento de Equipos: Restaurado formato de Tabla Técnica */}
          <div className={cn(
            "bg-white border border-[#141414]/10 rounded-[2.5rem] overflow-hidden shadow-xl transition-all duration-500",
            isExpanded ? "fixed inset-0 z-[60] rounded-none border-none overflow-y-auto bg-white p-4 md:p-12" : "relative"
          )}>
            <div className={cn(
              "p-8 border-b border-[#141414]/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6 bg-[#FAFAF8]",
              isExpanded && "rounded-t-[2.5rem] border border-[#141414]/5"
            )}>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
                    <ClipboardCheck className="w-5 h-5 text-white" />
                  </div>
                  <h2 className="font-black text-[#141414] uppercase tracking-[0.2em] text-sm">Aseguramiento Metrológico de Equipos</h2>
                </div>
                <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest ml-11">Validación de cumplimiento ISO/IEC 17025 en campo</p>
              </div>
              <div className="flex items-center gap-4">
                <div className="hidden md:flex flex-col items-end mr-4">
                  <span className="text-[9px] font-black text-emerald-600 uppercase tracking-tighter">{completed} de {order.instruments.length} COMPLETADOS</span>
                  <div className="w-24 h-1 bg-emerald-100 rounded-full mt-1 overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${(completed/order.instruments.length)*100}%` }} />
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsExpanded(!isExpanded)}
                    title={isExpanded ? "Reducir vista" : "Ampliar vista completa"}
                    className="w-12 h-12 flex items-center justify-center rounded-2xl bg-white border border-[#141414]/10 text-[#141414] hover:bg-gray-50 transition-all shadow-sm"
                  >
                    {isExpanded ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                  </button>

                  <button 
                    onClick={() => setIsAddingInstrument(true)}
                    className="px-6 py-3 h-12 rounded-2xl bg-emerald-500 text-white text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20"
                  >
                    <Activity className="w-4 h-4" /> Agregar Equipo a OT
                  </button>
                </div>
              </div>
            </div>

            <div className={cn("overflow-x-auto", isExpanded && "min-h-[70vh]")}>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#141414]/5 bg-[#FAFAF8]">
                    <th className="px-6 py-5 text-[9px] font-black text-[#141414]/30 uppercase tracking-[0.2em]">Estatus</th>
                    <th className="px-6 py-5 text-[9px] font-black text-[#141414]/30 uppercase tracking-[0.2em]">Tag / Identificación</th>
                    <th className="px-6 py-5 text-[9px] font-black text-[#141414]/30 uppercase tracking-[0.2em]">Servicio & Magnitud</th>
                    <th className="px-6 py-5 text-[9px] font-black text-[#141414]/30 uppercase tracking-[0.2em]">Rango de Trabajo</th>
                    <th className="px-6 py-5 text-[9px] font-black text-[#141414]/30 uppercase tracking-[0.2em]">Normativa</th>
                    <th className="px-6 py-5 text-[9px] font-black text-[#141414]/30 uppercase tracking-[0.2em] text-right">Acciones de Campo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#141414]/5">
                  {order.instruments.map((inst) => {
                    const existingCal = calibrations?.find(c => c.instrumentId === inst.id);
                    const isCompleted = inst.status === 'completed' || !!existingCal;
                    
                    return (
                      <React.Fragment key={inst.id}>
                        <tr className={cn(
                          "group transition-colors",
                          inst.status === 'completed' ? "bg-emerald-50/10 hover:bg-emerald-50/20" : 
                          inst.status === 'non_calibratable' ? "bg-red-50/10 hover:bg-red-50/20" : 
                          "hover:bg-[#F5F5F0]/20"
                        )}>
                          <td className="px-6 py-5 whitespace-nowrap">
                            <div className={cn(
                              "w-10 h-10 rounded-xl flex items-center justify-center border shadow-sm",
                              inst.status === 'completed' ? "bg-emerald-500 border-emerald-400 text-white" :
                              inst.status === 'non_calibratable' ? "bg-red-500 border-red-400 text-white" : 
                              "bg-amber-50 border-amber-200 text-amber-500"
                            )}>
                              {inst.status === 'completed' ? <CheckCircle2 className="w-5 h-5" /> : 
                               inst.status === 'non_calibratable' ? <XCircle className="w-5 h-5" /> : 
                               <Clock className="w-5 h-5 animate-pulse" />}
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex flex-col min-w-[200px]">
                              <span className="text-sm font-black text-[#141414] tracking-tight group-hover:text-blue-600 transition-colors">{inst.tag}</span>
                              <span className="text-[9px] font-bold text-[#141414]/40 uppercase tracking-widest truncate max-w-[250px]">{inst.description}</span>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-1.5">
                                <div className={cn(
                                  "w-5 h-5 rounded flex items-center justify-center",
                                  inst.serviceType === 'calibration' ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-500"
                                )}>
                                  <FlaskConical className="w-3 h-3" />
                                </div>
                                <span className="text-[10px] font-black text-[#141414] uppercase truncate">{inst.serviceType || 'Calibración'}</span>
                              </div>
                              <span className="text-[9px] font-bold text-blue-500 uppercase mt-1">{inst.magnitude}</span>
                            </div>
                          </td>
                          <td className="px-6 py-5 whitespace-nowrap">
                            <div className="flex flex-col">
                              <span className="text-sm font-black text-[#141414] tracking-tight">
                                {inst.rangeMin} <span className="text-[10px] text-gray-300">/</span> {inst.rangeMax}
                              </span>
                              <div className="flex items-center gap-1 text-[9px] font-bold text-emerald-600 uppercase">
                                <Gauge className="w-3 h-3" /> {inst.unit}
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5">
                            <div className="flex flex-col">
                              <span className="text-[10px] font-black text-[#141414] uppercase">Clase {inst.accuracy}</span>
                              <div className="flex items-center gap-1 mt-0.5 text-blue-600">
                                <ShieldCheck className="w-3 h-3" />
                                <span className="text-[9px] font-black uppercase underline decoration-blue-200 underline-offset-2">{inst.standard || 'ISO 17025'}</span>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-2">
                              <div className="flex gap-1.5 mr-2">
                                <button 
                                  onClick={() => {
                                    setKbForm({ title: `Hallazgo OT: ${inst.tag}`, content: '', attachments: [] });
                                    setIsReportingKB(inst.id);
                                  }}
                                  title="Reportar Hallazgo"
                                  className="w-9 h-9 flex items-center justify-center bg-white border border-[#141414]/5 hover:border-blue-200 rounded-xl text-[#141414]/20 hover:text-blue-500 transition-all group"
                                >
                                  <BookOpen className="w-4 h-4 group-hover:scale-110" />
                                </button>
                                
                                {inst.status === 'pending' && (
                                  <button 
                                    onClick={() => {
                                      setRemovingId(inst.id);
                                      setIsRemovingInstrument(true);
                                    }}
                                    title="Remover de la orden"
                                    className="w-9 h-9 flex items-center justify-center bg-white border border-[#141414]/5 hover:border-red-200 rounded-xl text-[#141414]/10 hover:text-red-500 transition-all group"
                                  >
                                    <X className="w-4 h-4 group-hover:scale-110" />
                                  </button>
                                )}
                              </div>

                              <div className="flex gap-2">
                                {inst.status === 'pending' && (
                                  <button 
                                    onClick={() => markAsNonCalibratable(inst.id)}
                                    className="px-3 h-10 rounded-xl bg-red-50 text-red-500 hover:bg-red-500 hover:text-white border border-red-100 transition-all font-black text-[9px] uppercase tracking-widest flex items-center gap-1.5"
                                  >
                                    <AlertCircle className="w-4 h-4" /> Falla
                                  </button>
                                )}
                                
                                <button 
                                  onClick={() => existingCal ? navigate('/campo', { state: { order: existingCal } }) : startCalibration(inst)}
                                  className={cn(
                                    "px-4 h-10 rounded-xl font-black text-[9px] uppercase tracking-widest transition-all shadow-md flex items-center gap-2",
                                    isCompleted 
                                      ? "bg-emerald-500 text-white hover:bg-emerald-600" 
                                      : "bg-[#141414] text-white hover:scale-105 active:scale-95"
                                  )}
                                >
                                  {isCompleted ? (
                                    <><FileText className="w-3.5 h-3.5" /> Listo</>
                                  ) : (
                                    <><Activity className="w-3.5 h-3.5" /> Ejecutar</>
                                  )}
                                  <ChevronRight className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          </td>
                        </tr>
                        {inst.notes && (
                          <tr className="bg-amber-50/30">
                            <td colSpan={6} className="px-6 py-3 border-t border-amber-100/50">
                              <div className="flex items-center gap-2 text-amber-900">
                                <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                <p className="text-[10px] font-medium italic tracking-normal">Hallazgo: "{inst.notes}"</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              {order.instruments.length === 0 && (
                <div className="py-20 text-center flex flex-col items-center">
                  <ClipboardCheck className="w-12 h-12 text-[#141414]/5 mb-4" />
                  <p className="text-xs font-black text-[#141414]/20 uppercase tracking-widest">No hay equipos asignados a esta orden</p>
                  <button 
                    onClick={() => setIsAddingInstrument(true)}
                    className="mt-4 text-[10px] font-black text-emerald-500 uppercase tracking-widest hover:underline"
                  >
                    Agregar primer equipo a la OT
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar: Historial y Observaciones */}
        <div className="xl:col-span-1 space-y-8">
          <div className="bg-white border border-[#141414]/10 rounded-[2.5rem] p-8 shadow-xl sticky top-8">
            <h3 className="flex items-center gap-2 text-xs font-black text-[#141414] uppercase tracking-[0.2em] mb-6 border-b border-[#141414]/5 pb-6">
              <History className="w-5 h-5 text-emerald-500" />
              Bitácora de Campo
            </h3>

            {/* Timeline de Logs */}
            <div className="space-y-6 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
              {(order.logs || []).slice().reverse().map((log) => (
                <div key={log.id} className="relative pl-6 border-l-2 border-[#141414]/5 pb-1">
                  <div className={cn(
                    "absolute -left-[9px] top-0 w-4 h-4 rounded-full border-2 border-white shadow-sm",
                    log.type === 'system' ? "bg-emerald-500" : 
                    log.type === 'alert' ? "bg-red-500" : 
                    "bg-blue-500"
                  )} />
                  <div className="flex justify-between items-start mb-1">
                    <span className="text-[10px] font-black text-[#141414]">{log.author}</span>
                    <span className="text-[8px] font-black text-[#141414]/20 uppercase tracking-tighter">
                      {new Date(log.timestamp).toLocaleDateString()} — {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#141414]/60 leading-relaxed font-medium">
                    {log.message}
                  </p>
                  {log.attachments && log.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {log.attachments.map((file, i) => (
                        <a 
                          key={i}
                          href={file.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 p-1.5 bg-[#141414]/5 rounded-lg border border-[#141414]/5 hover:bg-[#141414]/10 transition-colors"
                        >
                          {file.type.startsWith('image/') ? <ImageIcon className="w-3 h-3 text-blue-500" /> : <FileText className="w-3 h-3 text-red-500" />}
                          <span className="text-[9px] font-black truncate max-w-[80px] text-[#141414]/40 uppercase">{file.name}</span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {(order.logs || []).length === 0 && (
                <div className="text-center py-8">
                  <MessageSquare className="w-8 h-8 text-[#141414]/10 mx-auto mb-2" />
                  <p className="text-[10px] font-bold text-[#141414]/30 uppercase tracking-widest">Sin registros previos</p>
                </div>
              )}
            </div>

            {/* Input para nueva observación */}
            <div className="mt-8 pt-6 border-t border-[#141414]/5">
              <label className="text-[9px] font-black text-[#141414]/40 uppercase tracking-widest mb-2 block px-1">Registrar Observación Técnica</label>
              
              {selectedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2 p-2 bg-[#F5F5F0]/50 rounded-xl">
                  {selectedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-1 bg-white px-2 py-1 rounded text-[8px] font-black border border-[#141414]/5 text-[#141414]/40">
                      <span className="truncate max-w-[80px]">{f.name}</span>
                      <button onClick={() => setSelectedFiles(prev => prev.filter((_, idx) => idx !== i))}><X className="w-2.5 h-2.5 hover:text-red-500" /></button>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative">
                <textarea 
                  value={newLog}
                  onChange={(e) => setNewLog(e.target.value)}
                  placeholder="Nota técnica de campo..."
                  className="w-full bg-[#141414]/5 border-none rounded-2xl p-4 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-emerald-500 outline-none min-h-[100px] resize-none pb-14"
                />
                
                <div className="absolute bottom-3 left-3 flex gap-2">
                  <label className="w-10 h-10 flex items-center justify-center rounded-xl bg-white text-[#141414]/40 hover:text-emerald-500 transition-all cursor-pointer shadow-sm border border-[#141414]/5">
                    <input type="file" multiple className="hidden" onChange={(e) => handleFileSelect(e, false)} />
                    <Paperclip className="w-4 h-4" />
                  </label>
                </div>

                <button 
                  onClick={() => addLog(newLog)}
                  disabled={!newLog.trim() && selectedFiles.length === 0}
                  className="absolute bottom-3 right-3 w-10 h-10 bg-[#141414] text-white rounded-xl flex items-center justify-center hover:scale-105 active:scale-95 disabled:opacity-20 shadow-lg"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Cola de Sincronización Detallada */}
          <div className="bg-white border border-[#141414]/10 rounded-3xl p-6 shadow-sm overflow-hidden relative">
            <div className={cn(
              "absolute top-0 left-0 w-full h-1 transition-colors duration-500",
              syncState === 'synced' ? "bg-emerald-500" :
              syncState === 'syncing' ? "bg-blue-500 animate-pulse" :
              syncState === 'error' ? "bg-red-500" : "bg-amber-500"
            )} />
            
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-10 h-10 rounded-2xl flex items-center justify-center transition-all",
                  syncState === 'synced' ? "bg-emerald-50 text-emerald-500" :
                  syncState === 'syncing' ? "bg-blue-50 text-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)]" :
                  syncState === 'error' ? "bg-red-50 text-red-500" : "bg-amber-50 text-amber-500"
                )}>
                  {syncState === 'synced' ? <CheckCircle2 className="w-5 h-5" /> : 
                   syncState === 'syncing' ? <RefreshCw className="w-5 h-5 animate-spin" /> : 
                   syncState === 'error' ? <XCircle className="w-5 h-5" /> :
                   <AlertCircle className="w-5 h-5" />}
                </div>
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-[#141414]">Cola de Sincronización ERP</h4>
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] font-bold text-[#141414]/40 uppercase tracking-widest">
                      {syncState === 'synced' ? 'Base de datos al día' : 'Sincronización en curso'}
                    </p>
                    {syncState === 'syncing' && (
                      <span className="flex h-1.5 w-1.5 rounded-full bg-blue-500 animate-ping" />
                    )}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => syncService.processQueue()}
                className="p-2 hover:bg-[#F5F5F0] rounded-xl transition-colors"
                title="Sincronizar ahora"
              >
                <RefreshCw className={cn("w-4 h-4 text-[#141414]/20", syncState === 'syncing' && "animate-spin text-blue-500")} />
              </button>
            </div>
            
            <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
              {pendingOps.length > 0 ? (
                pendingOps.map((op) => (
                  <div 
                    key={op.id} 
                    className={cn(
                      "flex flex-col gap-2 p-3 rounded-2xl border transition-all animate-in fade-in slide-in-from-right-4",
                      op.status === 'completed' ? "bg-emerald-500/5 border-emerald-100" :
                      op.status === 'syncing' ? "bg-blue-500/5 border-blue-200 border-dashed" :
                      op.status === 'failed' ? "bg-red-500/5 border-red-200" : 
                      "bg-gray-50 border-[#141414]/5"
                    )}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        {op.status === 'completed' ? <CheckCircle2 className="w-3 h-3 text-emerald-500" /> :
                         op.status === 'syncing' ? <RefreshCw className="w-3 h-3 text-blue-500 animate-spin" /> :
                         op.status === 'failed' ? <XCircle className="w-3 h-3 text-red-500" /> :
                         <Clock className="w-3 h-3 text-amber-500" />}
                        <span className="text-[8px] font-black uppercase tracking-widest text-[#141414]/60">
                          {op.type === 'add_instrument' && 'Alta de Equipo'}
                          {op.type === 'remove_instrument' && 'Baja de Equipo'}
                          {op.type === 'save_calibration' && 'Certificado Digital'}
                          {op.type === 'update_order' && 'Actualización Orden'}
                        </span>
                      </div>
                      <span className={cn(
                        "text-[7px] font-black px-1.5 py-0.5 rounded uppercase tracking-tighter",
                        op.status === 'completed' ? "bg-emerald-100 text-emerald-700" :
                        op.status === 'syncing' ? "bg-blue-100 text-blue-700 animate-pulse" :
                        op.status === 'failed' ? "bg-red-100 text-red-700" : 
                        "bg-amber-100 text-amber-700"
                      )}>
                        {op.status === 'completed' ? 'Éxito' :
                         op.status === 'syncing' ? 'Sincronizando' :
                         op.status === 'failed' ? 'Error' : 'Pendiente'}
                      </span>
                    </div>
                    
                    <div className="flex flex-col">
                      <p className="text-[10px] font-black text-[#141414] truncate">
                        {op.payload.instrument?.tag || op.payload.instrumentId || op.payload.tag || 'Datos Generales'}
                      </p>
                      {op.error && (
                        <div className="mt-2 p-2 bg-red-100/50 rounded-lg border border-red-200">
                          <p className="text-[7px] text-red-600 font-bold leading-tight">
                            <span className="uppercase mr-1">Error:</span> {op.error}
                          </p>
                          {op.attempts < 5 && (
                            <p className="text-[6px] text-red-400 mt-0.5 font-black uppercase tracking-widest">
                              Reintento automático ({op.attempts}/5)
                            </p>
                          )}
                        </div>
                      )}
                      {op.status === 'completed' && (
                        <p className="text-[7px] text-emerald-600 font-bold mt-1 uppercase tracking-widest">
                          Sincronizado a las {new Date(op.lastAttemptAt || op.createdAt).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-10 opacity-20 group">
                  <RefreshCw className="w-10 h-10 mb-3 group-hover:rotate-180 transition-transform duration-700" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Cola de Sincronización Vacía</p>
                  <p className="text-[8px] font-bold">Todo se encuentra al día con la nube</p>
                </div>
              )}
            </div>
            
            <p className="text-[8px] text-[#141414]/40 mt-6 text-center font-bold uppercase tracking-[0.1em] italic">
              La aplicación detecta cambios automáticamente y los procesa en segundo plano.
            </p>
          </div>

          <div className="bg-emerald-500 rounded-3xl p-6 text-white shadow-xl relative overflow-hidden group">
            <ShieldCheck className="absolute -right-4 -bottom-4 w-32 h-32 text-white/10 group-hover:scale-110 transition-transform duration-500" />
            <h4 className="text-[10px] font-black uppercase tracking-[0.2em] mb-2 opacity-80 underline underline-offset-4">Control de Calidad</h4>
            <p className="text-base font-black leading-tight mb-4">Esta orden se encuentra bajo supervisión activa.</p>
            
            <div className="space-y-3 relative z-10">
              <div className="flex items-center gap-2 text-[10px] font-bold">
                <User className="w-3.5 h-3.5" /> Responsable: {order.technicianName || order.technicianEmail || order.technicianId || 'Sin asignar'}
              </div>
              <button 
                onClick={() => {
                  setKbForm({ 
                    title: `Observación General - Orden ${order.id}`, 
                    content: '',
                    attachments: []
                  });
                  const firstInstId = order.instruments?.[0]?.id;
                  if (firstInstId) {
                    setIsReportingKB(firstInstId);
                  } else {
                    alert('No hay instrumentos disponibles para reportar.');
                  }
                }}
                className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest bg-white/20 hover:bg-white/30 p-2 rounded-lg transition-colors w-full"
              >
                <Bookmark className="w-3.5 h-3.5" /> Reportar Hallazgo General KB
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
