import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLocation, useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { syncService } from '../lib/SyncService';
import { CalibrationStatus, CalibrationData, LogEntry } from '../types';
import { Plus, Send, FileText, Trash2, Gauge, RefreshCw, Thermometer, Droplet, Search, ClipboardCheck, CheckCircle2, Zap } from 'lucide-react';
import { formatDate, cn } from '../lib/utils';
import { jsPDF } from 'jspdf';
import { CalibrationFormRegistry } from '../components/calibracion/FormRegistry';

import { generateDraftCertificate } from '../lib/certificateGenerator';

export function FieldApp() {
  const navigate = useNavigate();
  const calibrations = useLiveQuery(() => db.calibrations.orderBy('updatedAt').reverse().toArray());

  const editCalibration = (cal: CalibrationData) => {
    navigate(`/calibracion?id=${cal.id}`);
  };

  const generatePDF = async (cal: CalibrationData) => {
    if (cal.magnitude === 'pressure') {
      const doc = await generateDraftCertificate(cal);
      window.open(doc.output('bloburl'), '_blank');
    } else {
      // Fallback for other magnitudes until they have advanced generators
      const doc = new jsPDF();
      doc.setFontSize(22);
      doc.text('INFORME PRELIMINAR', 20, 30);
      doc.setFontSize(10);
      doc.text(`ID: ${cal.id}`, 20, 45);
      doc.text(`Cliente: ${cal.clientName}`, 20, 55);
      doc.text(`Tag: ${cal.instrumentTag}`, 20, 65);
      doc.save(`VeriPet_${cal.instrumentTag}.pdf`);
    }
  };

  const syncToBackend = async (cal: CalibrationData) => {
    const isFinishing = cal.status === CalibrationStatus.PRELIMINARY || cal.status === CalibrationStatus.DRAFT;
    
    // Si el técnico elige finalizar, pedimos confirmación explícita
    if (isFinishing) {
      const confirmFinish = window.confirm(
        "¿CONFIRMAR FINALIZACIÓN?\n\nAl finalizar, el instrumento pasará a REVISIÓN DE CALIDAD y no podrá ser editado en campo. ¿Deseas continuar?"
      );
      if (!confirmFinish) return;
    }

    try {
      const newStatus = isFinishing ? CalibrationStatus.IN_REVIEW : cal.status;

      const historyEntry: LogEntry = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        author: 'Sistema (Local)',
        message: isFinishing 
          ? `Sincronización final: Enviado a Revisión de Calidad` 
          : `Sincronización de respaldo realizada`,
        type: 'system'
      };

      // Actualizar estado local
      await db.calibrations.update(cal.id, {
        status: newStatus,
        updatedAt: Date.now(),
        history: [...(cal.history || []), historyEntry]
      });

      // Encolar para sincronización en segundo plano
      await syncService.enqueue('save_calibration', { 
        calibrationId: cal.id,
        workOrderId: cal.workOrderId,
        status: newStatus // Pasamos el nuevo estado al servicio de sincronización
      });
      
      // Intentar procesar inmediatamente
      syncService.processQueue();

      alert(isFinishing 
        ? '🚀 ¡Enviado a Revisión de Calidad exitosamente!' 
        : '☁️ Respaldo en la nube realizado (Sigue en Borrador)');

    } catch (err) {
      console.error('Error al sincronizar:', err);
      alert('❌ Error al intentar sincronizar. Se reintentará automáticamente cuando haya conexión.');
    }
  };

  const startNewCalibration = (magnitude: string) => {
    navigate('/calibracion', { state: { order: { magnitude } } });
  };

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex justify-between items-end mb-10 border-b border-[#141414]/10 pb-6">
        <div>
          <h2 className="text-4xl font-black text-[#141414] tracking-tight">Ejecuciones de Campo</h2>
          <p className="text-[#141414]/50 mt-1 font-medium italic">Gestión de capturas locales y sincronización</p>
        </div>
        
        <div className="flex gap-3 mb-4">
          <div className="flex items-center gap-2 bg-white border border-[#141414]/10 p-1 rounded-2xl shadow-sm">
            <MagnitudeBtn 
              icon={<Gauge className="w-4 h-4" />} 
              label="Presión" 
              onClick={() => startNewCalibration('pressure')} 
            />
            <MagnitudeBtn 
              icon={<Zap className="w-4 h-4" />} 
              label="Transmisor" 
              onClick={() => startNewCalibration('pressure_transmitter')} 
            />
            <MagnitudeBtn 
              icon={<Thermometer className="w-4 h-4" />} 
              label="Temp" 
              onClick={() => startNewCalibration('temperature')} 
            />
            <MagnitudeBtn 
              icon={<ClipboardCheck className="w-4 h-4" />} 
              label="Inspec" 
              onClick={() => startNewCalibration('inspection')} 
            />
            <MagnitudeBtn 
              icon={<Droplet className="w-4 h-4" />} 
              label="Otros" 
              onClick={() => startNewCalibration('other')}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-4">
        {calibrations?.length === 0 && (
          <div className="text-center py-32 bg-white border-2 border-dashed border-[#141414]/10 rounded-[3rem] flex flex-col items-center">
            <div className="w-20 h-20 bg-[#F5F5F0] rounded-full flex items-center justify-center mb-6">
              <Search className="w-8 h-8 text-[#141414]/20" />
            </div>
            <p className="text-[#141414]/40 font-bold uppercase tracking-widest text-xs">Sin trabajos realizados</p>
            <p className="text-[#141414]/30 text-sm mt-1 max-w-xs mx-auto text-center">Selecciona una magnitud arriba o descarga órdenes desde "Mis Órdenes".</p>
          </div>
        )}
        
        {calibrations?.map(cal => (
          <div key={cal.id} className="bg-white border border-[#141414]/10 p-8 rounded-[2.5rem] flex items-center justify-between hover:border-[#141414]/30 transition-all group shadow-sm hover:shadow-xl hover:-translate-y-1 duration-300">
            <div className="flex items-center gap-6 cursor-pointer flex-1" onClick={() => (cal.status === CalibrationStatus.DRAFT || cal.status === CalibrationStatus.PRELIMINARY) && editCalibration(cal)}>
              <div className={cn(
                "w-16 h-16 rounded-3xl flex items-center justify-center text-2xl transition-transform group-hover:scale-110",
                cal.status === CalibrationStatus.DRAFT ? "bg-amber-100 text-amber-600 shadow-[0_0_20px_-5px_rgba(245,158,11,0.3)]" : 
                cal.status === CalibrationStatus.PRELIMINARY ? "bg-blue-100 text-blue-600 shadow-[0_0_20px_-5px_rgba(37,99,235,0.3)]" :
                "bg-[#141414] text-white"
              )}>
                {cal.magnitude === 'pressure' ? <Gauge className="w-8 h-8" /> : 
                 cal.magnitude === 'pressure_transmitter' ? <Zap className="w-8 h-8" /> :
                 cal.magnitude === 'temperature' ? <Thermometer className="w-8 h-8" /> :
                 <ClipboardCheck className="w-8 h-8" />}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <h3 className="font-black text-2xl text-[#141414] tracking-tight">{cal.instrumentTag}</h3>
                  {cal.status === CalibrationStatus.DRAFT && (
                    <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-black uppercase border border-amber-200">En Edición</span>
                  )}
                  {cal.status === CalibrationStatus.PRELIMINARY && (
                    <span className="text-[10px] bg-emerald-500 text-white px-2 py-0.5 rounded font-black uppercase pulse-slow">Ejecución Completa</span>
                  )}
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-[0.15em] border ml-auto md:ml-0",
                    cal.status === CalibrationStatus.DRAFT ? "bg-amber-50 text-amber-700 border-amber-200" :
                    cal.status === CalibrationStatus.PRELIMINARY ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                    cal.status === CalibrationStatus.IN_REVIEW ? "bg-indigo-50 text-indigo-700 border-indigo-200" :
                    "bg-[#141414] text-white border-[#141414]"
                  )}>
                    {cal.status === CalibrationStatus.DRAFT ? 'Técnico: Borrador' : 
                     cal.status === CalibrationStatus.PRELIMINARY ? 'Técnico: Preliminar' :
                     cal.status === CalibrationStatus.IN_REVIEW ? 'Calidad: En Revisión' : 'Publicado'}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-sm font-bold text-[#141414]/70">{cal.clientName}</p>
                  <span className="text-[#141414]/20 text-xs">•</span>
                  <p className="text-xs text-[#141414]/40 font-medium tracking-tight uppercase">{formatDate(cal.updatedAt)}</p>
                </div>
                {cal.uncertaintyResults && (
                  <div className="mt-2 flex gap-4">
                    <div className="px-2 py-1 bg-emerald-50 rounded border border-emerald-100 text-[10px] font-mono text-emerald-700 flex items-center gap-1">
                      <span className="font-black opacity-50 text-[10px]">INC:</span> {cal.uncertaintyResults.expanded.toFixed(4)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 ml-6">
              <ActionButton 
                onClick={() => generatePDF(cal)}
                icon={<FileText className="w-5 h-5" />}
                label="Pre-PDF"
                variant="blue"
              />
              {(cal.status === CalibrationStatus.DRAFT || cal.status === CalibrationStatus.PRELIMINARY) && (
                <ActionButton 
                  onClick={() => syncToBackend(cal)}
                  icon={cal.status === CalibrationStatus.PRELIMINARY ? <CheckCircle2 className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                  label={cal.status === CalibrationStatus.PRELIMINARY ? "Finalizar" : "Sincronizar"}
                  variant="green"
                />
              )}
              <button 
                onClick={() => db.calibrations.delete(cal.id)}
                className="p-4 text-[#141414]/20 hover:text-red-500 hover:bg-red-50 rounded-3xl transition-all"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MagnitudeBtn({ icon, label, onClick, disabled }: any) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 px-6 py-3 rounded-xl transition-all",
        disabled ? "opacity-30 cursor-not-allowed" : "hover:bg-[#F5F5F0] text-[#141414]/60 hover:text-[#141414]"
      )}
    >
      {icon}
      <span className="text-[10px] font-black uppercase tracking-[0.1em]">{label}</span>
    </button>
  );
}

function ActionButton({ onClick, icon, label, variant }: any) {
  const colors = {
    blue: "text-blue-600 hover:bg-blue-50 border-blue-100 bg-white",
    green: "text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200"
  };
  
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-5 py-4 rounded-3xl border transition-all text-[10px] font-black uppercase tracking-[0.2em] shadow-sm",
        colors[variant as keyof typeof colors]
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
