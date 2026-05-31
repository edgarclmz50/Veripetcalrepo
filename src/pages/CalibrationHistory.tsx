import React, { useState, useEffect } from 'react';
import { db } from '../lib/db';
import { CalibrationData, CalibrationStatus } from '../types';
import { Search, Filter, Calendar, User, Gauge, ChevronRight, FileText, Download, CheckCircle2, AlertCircle, Clock, Thermometer, ClipboardCheck, Zap } from 'lucide-react';
import { formatDate, cn } from '../lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { getAuthUser } from '../lib/auth';

export function CalibrationHistory() {
  const navigate = useNavigate();
  const user = getAuthUser();
  const [calibrations, setCalibrations] = useState<CalibrationData[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  useEffect(() => {
    const fetchCalibrations = async () => {
      setLoading(true);
      try {
        const all = await db.calibrations.orderBy('updatedAt').reverse().toArray();
        setCalibrations(all);
      } catch (error) {
        console.error("Error fetching history:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchCalibrations();
  }, []);

  const filteredCalibrations = calibrations.filter(cal => {
    // Only show calibrations performed by this technician
    if (user && cal.technicianId && cal.technicianId !== user.id) return false;

    const matchesSearch = 
      cal.instrumentTag.toLowerCase().includes(searchTerm.toLowerCase()) ||
      cal.instrumentDescription.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesClient = clientFilter === '' || cal.clientName.toLowerCase().includes(clientFilter.toLowerCase());
    
    const matchesStatus = statusFilter === 'all' || cal.status === statusFilter;
    
    const matchesDate = (!dateRange.start || cal.updatedAt >= new Date(dateRange.start).getTime()) &&
                      (!dateRange.end || cal.updatedAt <= new Date(dateRange.end).getTime() + 86400000);

    return matchesSearch && matchesClient && matchesStatus && matchesDate;
  });

  const getStatusIcon = (status: CalibrationStatus) => {
    switch (status) {
      case CalibrationStatus.PUBLISHED: return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
      case CalibrationStatus.IN_REVIEW: return <Clock className="w-4 h-4 text-blue-500" />;
      case CalibrationStatus.PRELIMINARY: return <FileText className="w-4 h-4 text-amber-500" />;
      default: return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getStatusStyles = (status: CalibrationStatus) => {
    switch (status) {
      case CalibrationStatus.PUBLISHED: return "bg-emerald-50 text-emerald-700 border-emerald-100";
      case CalibrationStatus.IN_REVIEW: return "bg-blue-50 text-blue-700 border-blue-100";
      case CalibrationStatus.PRELIMINARY: return "bg-amber-50 text-amber-700 border-amber-100";
      default: return "bg-gray-50 text-gray-600 border-gray-100";
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-sans font-bold tracking-tight text-[#141414]">Historial de Calibraciones</h2>
          <p className="text-sm text-[#141414]/60 mt-1 uppercase font-bold tracking-widest">Registro histórico y trazabilidad metrológica</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              if (filteredCalibrations.length === 0) return;
              
              const headers = [
                'ID', 'Cliente', 'Tag', 'Descripción', 'Magnitud', 'Estado', 
                'Incertidumbre_Exp', 'Unidad_Medida', 'Fecha_Actualizacion', 
                'ID_OrdenTrabajo', 'Tecnico_ID'
              ];
              
              const rows = filteredCalibrations.map(cal => [
                cal.id,
                cal.clientName,
                cal.instrumentTag,
                cal.instrumentDescription,
                cal.magnitude,
                cal.status,
                cal.uncertaintyResults?.expanded || '',
                (cal.metadata as any)?.unit || '',
                new Date(cal.updatedAt).toISOString(),
                cal.workOrderId || '',
                cal.technicianId || ''
              ]);
              
              const csvContent = [
                headers.join(','),
                ...rows.map(row => row.map(val => `"${val}"`).join(','))
              ].join('\n');
              
              const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.setAttribute("href", url);
              link.setAttribute("download", `VeriPet_Export_${new Date().toISOString().split('T')[0]}.csv`);
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
            }}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all text-xs font-black uppercase tracking-widest shadow-xl"
            title="Exportar registros filtrados a formato CSV"
          >
            <Download className="w-4 h-4" />
            Exportar CSV
          </button>
          <div className="px-4 py-2 bg-white border border-[#141414]/10 rounded-2xl shadow-sm flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-widest text-[#141414]">
              {filteredCalibrations.length} Registros
            </span>
          </div>
        </div>
      </header>

      {/* Filtros */}
      <section className="bg-white border border-[#141414]/10 rounded-[2.5rem] p-8 shadow-sm space-y-6">
        <div className="flex items-center gap-3 mb-2">
          <Filter className="w-4 h-4 text-[#141414]/40" />
          <h3 className="text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Filtros de Búsqueda Avanzada</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#141414]/20" />
            <input 
              type="text"
              placeholder="Buscar por TAG o Descrip..."
              className="w-full pl-12 pr-4 py-4 bg-[#F5F5F0]/50 border-none rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/5 outline-none transition-all"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#141414]/20" />
            <input 
              type="text"
              placeholder="Filtrar por Cliente..."
              className="w-full pl-12 pr-4 py-4 bg-[#F5F5F0]/50 border-none rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/5 outline-none transition-all"
              value={clientFilter}
              onChange={e => setClientFilter(e.target.value)}
            />
          </div>

          <div className="relative">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#141414]/20" />
            <select 
              className="w-full pl-12 pr-4 py-4 bg-[#F5F5F0]/50 border-none rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/5 outline-none transition-all appearance-none"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
            >
              <option value="all">Todos los Estados</option>
              {Object.values(CalibrationStatus).map(status => (
                <option key={status} value={status}>{status.replace('_', ' ').toUpperCase()}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-2">
            <input 
              type="date"
              className="flex-1 px-4 py-4 bg-[#F5F5F0]/50 border-none rounded-2xl text-xs font-black uppercase focus:ring-4 focus:ring-blue-500/5 outline-none transition-all"
              value={dateRange.start}
              onChange={e => setDateRange({...dateRange, start: e.target.value})}
            />
            <input 
              type="date"
              className="flex-1 px-4 py-4 bg-[#F5F5F0]/50 border-none rounded-2xl text-xs font-black uppercase focus:ring-4 focus:ring-blue-500/5 outline-none transition-all"
              value={dateRange.end}
              onChange={e => setDateRange({...dateRange, end: e.target.value})}
            />
          </div>
        </div>
      </section>

      {/* Lista de Calibraciones */}
      <div className="space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 opacity-20">
            <Clock className="w-12 h-12 mb-4 animate-spin" />
            <p className="text-[10px] font-black uppercase tracking-widest">Cargando Historial...</p>
          </div>
        ) : filteredCalibrations.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            <AnimatePresence mode='popLayout'>
              {filteredCalibrations.map((cal, idx) => (
                <motion.div
                  key={cal.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ delay: idx * 0.05 }}
                  className="group bg-white border border-[#141414]/10 rounded-[2rem] p-6 hover:shadow-xl hover:shadow-[#141414]/5 transition-all cursor-pointer relative overflow-hidden"
                  onClick={() => navigate(`/campo?id=${cal.id}`)}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                    <div className="flex items-center gap-6">
                      <div className="w-16 h-16 rounded-2xl bg-[#F5F5F0] flex items-center justify-center group-hover:scale-110 transition-transform">
                        {cal.magnitude === 'pressure' ? <Gauge className="w-8 h-8 text-[#141414]" /> : 
                         cal.magnitude === 'pressure_transmitter' ? <Zap className="w-8 h-8 text-amber-500" /> :
                         cal.magnitude === 'temperature' ? <Thermometer className="w-8 h-8 text-blue-600" /> : 
                         <ClipboardCheck className="w-8 h-8 text-emerald-600" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <h4 className="text-lg font-black text-[#141414] tracking-tight">{cal.instrumentTag}</h4>
                          <span className={cn(
                            "px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border",
                            getStatusStyles(cal.status)
                          )}>
                            <span className="flex items-center gap-1.5">
                              {getStatusIcon(cal.status)}
                              {cal.status.replace('_', ' ')}
                            </span>
                          </span>
                        </div>
                        <p className="text-sm font-bold text-[#141414]/60">{cal.instrumentDescription}</p>
                        <div className="flex items-center gap-4 mt-2">
                          <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                            {cal.clientName}
                          </span>
                          <span className="text-[10px] font-bold text-[#141414]/30 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatDate(cal.updatedAt)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right hidden lg:block mr-4">
                        <p className="text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Magnitud</p>
                        <p className="text-sm font-black uppercase text-[#141414]">{cal.magnitude}</p>
                      </div>
                      <button 
                        className="p-4 bg-emerald-50 text-emerald-600 rounded-2xl hover:bg-emerald-600 hover:text-white transition-all shadow-sm"
                        title="Ver Borrador PDF"
                        onClick={(e) => {
                          e.stopPropagation();
                          import('../lib/certificateGenerator').then(m => {
                            m.generateDraftCertificate(cal).then(doc => {
                              window.open(doc.output('bloburl'), '_blank');
                            });
                          });
                        }}
                      >
                        <FileText className="w-5 h-5" />
                      </button>
                      <button className="p-4 bg-[#F5F5F0] rounded-2xl text-[#141414] hover:bg-[#141414] hover:text-white transition-all">
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                  
                  {/* Summary Bar - Subtle */}
                  <div className="mt-6 pt-6 border-t border-[#141414]/5 grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black uppercase text-[#141414]/30">Puntos Ensayados</span>
                      <span className="text-xs font-bold text-[#141414]">{cal.measurements?.length || 0}</span>
                    </div>
                    {cal.uncertaintyResults && (
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black uppercase text-[#141414]/30">Incertidumbre (k=2)</span>
                        <span className="text-xs font-bold text-emerald-600">± {cal.uncertaintyResults.expanded.toFixed(4)}</span>
                      </div>
                    )}
                    {cal.meanError !== undefined && (
                      <div className="flex flex-col">
                        <span className="text-[8px] font-black uppercase text-[#141414]/30">Error Medio</span>
                        <span className="text-xs font-bold text-blue-600">{cal.meanError.toFixed(4)} %</span>
                      </div>
                    )}
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black uppercase text-[#141414]/30">Técnico</span>
                      <span className="text-xs font-bold text-[#141414]">
                        {cal.technicianName || cal.technicianEmail || (cal.technicianId ? cal.technicianId.split('-')[0] + '...' : 'N/A')}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[8px] font-black uppercase text-[#141414]/30">ID de Registro</span>
                      <span className="text-[10px] font-mono text-[#141414]/40">{cal.id.split('-')[0]}...</span>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ) : (
          <div className="bg-white border border-[#141414]/10 rounded-[3rem] p-20 flex flex-col items-center justify-center text-center">
            <div className="w-20 h-20 rounded-full bg-[#F5F5F0] flex items-center justify-center mb-6">
              <Search className="w-10 h-10 text-[#141414]/20" />
            </div>
            <h4 className="text-xl font-black text-[#141414] mb-2 uppercase tracking-tight">Sin resultados que coincidan</h4>
            <p className="text-sm font-bold text-[#141414]/40 max-w-xs mx-auto">
              No encontramos registros histórico con los filtros aplicados. Intente ajustar los criterios de búsqueda.
            </p>
            <button 
              onClick={() => {
                setSearchTerm('');
                setClientFilter('');
                setStatusFilter('all');
                setDateRange({ start: '', end: '' });
              }}
              className="mt-8 px-8 py-3 bg-[#141414] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 active:scale-95 transition-all"
            >
              Reiniciar Filtros
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
