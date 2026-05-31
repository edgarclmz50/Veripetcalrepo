import React, { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { WorkOrder, WorkOrderInstrument } from '../types';
import { 
  CheckCircle2, 
  Clock, 
  XCircle, 
  Search, 
  Filter,
  ArrowUpDown,
  Gauge,
  Calendar as CalendarIcon,
  Tag,
  Building,
  ShieldCheck,
  SearchCode,
  Thermometer,
  Wrench,
  Activity,
  ClipboardCheck,
  Zap
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useNavigate } from 'react-router-dom';
import { getAuthUser } from '../lib/auth';

interface FlattenedExecution extends WorkOrderInstrument {
  orderId: string;
  clientName: string;
  scheduledDate: number;
  technicianId?: string;
}

export function Executions() {
  const navigate = useNavigate();
  const user = getAuthUser();
  const [executions, setExecutions] = useState<FlattenedExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'non_calibratable' | 'iso17020' | 'iso9001'>('all');

  useEffect(() => {
    const loadExecutions = async () => {
      const allOrders = await db.workOrders.toArray();
      // Filter orders by technician
      const orders = allOrders.filter(o => !user || !o.technicianId || o.technicianId === user.id);

      const allExecutions: FlattenedExecution[] = [];
      
      orders.forEach(order => {
        order.instruments.forEach(inst => {
          allExecutions.push({
            ...inst,
            orderId: order.id,
            clientName: order.clientName,
            scheduledDate: order.scheduledDate,
            technicianId: order.technicianId
          });
        });
      });

      // Sort by order and then by tag
      allExecutions.sort((a, b) => {
        if (a.orderId !== b.orderId) return a.orderId.localeCompare(b.orderId);
        return a.tag.localeCompare(b.tag);
      });

      setExecutions(allExecutions);
      setLoading(false);
    };

    loadExecutions();
  }, []);

  const filteredExecutions = executions.filter(ex => {
    const matchesSearch = 
      ex.tag.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ex.clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ex.id.toLowerCase().includes(searchTerm.toLowerCase());
    
    let matchesStatus = false;
    if (statusFilter === 'all') matchesStatus = true;
    else if (statusFilter === 'iso17020') matchesStatus = ex.standard === 'ISO 17020';
    else if (statusFilter === 'iso9001') matchesStatus = ex.standard === 'ISO 9001';
    else matchesStatus = ex.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black text-[#141414] tracking-tight">Control de Ejecuciones</h1>
          <p className="text-sm font-bold text-[#141414]/40 uppercase tracking-widest mt-1">Vista consolidada de instrumentos por orden</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-[#141414]/10 rounded-3xl p-6 mb-8 shadow-sm flex flex-col md:flex-row gap-4">
        <div className="flex-1 relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#141414]/30" />
          <input 
            type="text" 
            placeholder="Buscar por tag, cliente o ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-[#F5F5F0]/50 border-none rounded-2xl py-4 pl-12 pr-6 text-xs font-bold text-[#141414] focus:ring-2 focus:ring-[#141414] outline-none transition-all"
          />
        </div>
        <div className="flex gap-2 bg-[#F5F5F0]/50 p-1.5 rounded-2xl overflow-x-auto no-scrollbar">
          {(['all', 'pending', 'completed', 'non_calibratable', 'iso17020', 'iso9001'] as const).map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={cn(
                "px-6 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap",
                statusFilter === status 
                  ? "bg-white text-[#141414] shadow-sm" 
                  : "text-[#141414]/40 hover:text-[#141414]"
              )}
            >
              {status === 'all' ? 'Ver Todos' : 
               status === 'pending' ? 'Pendientes' : 
               status === 'completed' ? 'Completados' : 
               status === 'non_calibratable' ? 'No Calibrables' :
               status === 'iso17020' ? 'Inspección (17020)' : 'ISO 9001 / Otros'}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="bg-white border border-[#141414]/10 rounded-3xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#141414]/5 bg-[#FAFAF8]">
                <th className="px-6 py-4 text-[9px] font-black text-[#141414]/30 uppercase tracking-widest">Estatus</th>
                <th className="px-6 py-4 text-[9px] font-black text-[#141414]/30 uppercase tracking-widest">Orden / Cliente</th>
                <th className="px-6 py-4 text-[9px] font-black text-[#141414]/30 uppercase tracking-widest">Instrumento</th>
                <th className="px-6 py-4 text-[9px] font-black text-[#141414]/30 uppercase tracking-widest">Especificaciones</th>
                <th className="px-6 py-4 text-[9px] font-black text-[#141414]/30 uppercase tracking-widest">Programación</th>
                <th className="px-6 py-4 text-[9px] font-black text-[#141414]/30 uppercase tracking-widest text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#141414]/5">
              {filteredExecutions.length > 0 ? filteredExecutions.map((ex) => (
                <tr 
                  key={`${ex.orderId}-${ex.id}`} 
                  className={cn(
                    "group transition-colors border-l-4",
                    ex.status === 'completed' ? "bg-emerald-50/20 border-emerald-500" : 
                    ex.status === 'non_calibratable' ? "bg-red-50/20 border-red-500" : 
                    "hover:bg-[#F5F5F0]/10 border-transparent"
                  )}
                >
                  <td className="px-6 py-5 whitespace-nowrap">
                    <div className={cn(
                      "px-3 py-1.5 rounded-full flex items-center gap-2 w-fit shadow-sm border",
                      ex.status === 'completed' ? "bg-emerald-500 text-white border-emerald-400" :
                      ex.status === 'non_calibratable' ? "bg-red-500 text-white border-red-400" : 
                      "bg-amber-50 text-amber-600 border-amber-200"
                    )}>
                      {ex.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : ex.status === 'non_calibratable' ? (
                        <XCircle className="w-3.5 h-3.5" />
                      ) : (
                        <Clock className="w-3.5 h-3.5" />
                      )}
                      <span className="text-[9px] font-black uppercase tracking-widest">
                        {ex.status === 'completed' ? 'Listo' : ex.status === 'non_calibratable' ? 'Falla' : 'Pendiente'}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-[#141414]/30 uppercase tracking-widest mb-0.5">{ex.orderId}</span>
                      <span className="text-sm font-black text-[#141414] tracking-tight flex items-center gap-2">
                        <Building className="w-3.5 h-3.5 opacity-20" /> {ex.clientName}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col">
                      <span className="text-sm font-black text-[#141414] tracking-tight">{ex.tag}</span>
                      <span className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-wider">{ex.description}</span>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        {ex.magnitude === 'pressure' && <Gauge className="w-3 h-3 text-blue-500" />}
                        {ex.magnitude === 'pressure_transmitter' && <Zap className="w-3 h-3 text-amber-500" />}
                        {ex.magnitude === 'temperature' && <Thermometer className="w-3 h-3 text-red-500" />}
                        {ex.magnitude === 'inspection' && <SearchCode className="w-3 h-3 text-amber-500" />}
                        {ex.magnitude === 'quality' && <ShieldCheck className="w-3 h-3 text-emerald-500" />}
                        {ex.serviceType === 'repair' && <Wrench className="w-3 h-3 text-blue-600" />}
                        {ex.serviceType === 'maintenance' && <Activity className="w-3 h-3 text-emerald-600" />}
                        {ex.serviceType === 'functional_test' && <ClipboardCheck className="w-3 h-3 text-purple-600" />}
                        {!['pressure', 'temperature', 'inspection', 'quality'].includes(ex.magnitude) && !ex.serviceType && <Tag className="w-3 h-3 text-gray-500" />}
                        <span className="text-[10px] font-black uppercase text-[#141414] tracking-tighter">
                          {ex.serviceType ? ex.serviceType.replace('_', ' ') : ex.magnitude}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-[#141414]/50">{ex.rangeMin} a {ex.rangeMax} {ex.unit}</span>
                        {ex.standard && (
                          <span className={cn(
                            "text-[8px] font-black px-1.5 rounded uppercase",
                            ex.standard === 'ISO 17025' ? "bg-blue-100 text-blue-700" :
                            ex.standard === 'ISO 17020' ? "bg-amber-100 text-amber-700" :
                            ex.standard === 'ISO 9001' ? "bg-purple-100 text-purple-700" :
                            "bg-[#141414]/5 text-[#141414]/40"
                          )}>
                            {ex.standard}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-5">
                    <div className="flex items-center gap-2 text-[11px] font-bold text-[#141414]/60">
                      <CalendarIcon className="w-3.5 h-3.5 text-[#141414]/20" />
                      {new Date(ex.scheduledDate).toLocaleDateString()}
                    </div>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <button 
                      onClick={() => navigate(`/ordenes/${ex.orderId}`)}
                      className="px-4 py-2 rounded-xl bg-[#141414] text-white text-[9px] font-black uppercase tracking-widest hover:scale-110 active:scale-95 transition-all shadow-md"
                    >
                      Ir a Orden
                    </button>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <div className="flex flex-col items-center">
                      <div className="w-16 h-16 bg-[#F5F5F0] rounded-full flex items-center justify-center mb-4">
                        <Filter className="w-8 h-8 text-[#141414]/10" />
                      </div>
                      <p className="text-sm font-black text-[#141414]/20 uppercase tracking-widest">No se encontraron ejecuciones</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
