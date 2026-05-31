import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { WorkOrder, WorkOrderInstrument } from '../types';
import { Calendar, Users, Gauge, RefreshCw, ChevronRight, ChevronDown, ListTodo, MapPin, BadgeInfo, Search, CheckCircle2, AlertCircle, XCircle, Send, Clock, Activity } from 'lucide-react';
import { formatDate, cn, calculateOrderStatus } from '../lib/utils';
import { getAuthUser } from '../lib/auth';
import { db as firestore } from '../lib/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

export function WorkOrders() {
  const navigate = useNavigate();
  const user = getAuthUser();
  const workOrders = useLiveQuery(() => db.workOrders.toArray());
  const calibrations = useLiveQuery(() => db.calibrations.toArray());
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMagnitude, setFilterMagnitude] = useState<'all' | 'pressure' | 'temperature' | 'pressure_transmitter' | 'inspection' | 'maintenance'>('all');
  const [filterType, setFilterType] = useState<'all' | 'erp' | 'field'>('all');
  const [showAllAsAdmin, setShowAllAsAdmin] = useState(false);

  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  React.useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    
    // Auto-download on mount
    if (user) {
      downloadOrders(true);
    }

    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);

  const downloadOrders = async (isAuto = false) => {
    if (!user || isSyncing) return;
    if (!navigator.onLine) {
      if (!isAuto) alert('Sincronización no disponible: Estás en modo offline.');
      return;
    }

    setIsSyncing(true);
    try {
      // 1. Try to fetch from ERP (Dolibarr) - currently mocked
      let serverOrders: WorkOrder[] = [];
      try {
        const resp = await fetch('/api/dolibarr/assigned-tasks');
        if (resp.ok) {
          const allServerOrders = await resp.json();
          if (Array.isArray(allServerOrders)) {
            serverOrders = allServerOrders.filter(o => 
              o.technicianId === user.id || 
              o.technicianId === user.email || 
              o.technicianId === user.technicianCode
            );
          }
        }
      } catch (e) {
        console.warn("ERP sync failed, falling back to Firestore");
      }

      // 2. Fetch from Firestore
      const firestoreOrders: WorkOrder[] = [];
      const queries = [
        query(collection(firestore, 'workOrders'), where('technicianId', '==', user.id)),
        query(collection(firestore, 'workOrders'), where('technicianId', '==', user.email))
      ];
      if (user.technicianCode) {
        queries.push(query(collection(firestore, 'workOrders'), where('technicianId', '==', user.technicianCode)));
      }

      const snapshots = await Promise.all(queries.map(q => getDocs(q)));
      snapshots.forEach(snapshot => {
        snapshot.forEach((doc) => {
          const data = doc.data() as WorkOrder;
          if (!firestoreOrders.some(fo => fo.id === doc.id)) {
            firestoreOrders.push({ ...data, id: doc.id });
          }
        });
      });

      // Merge results
      const combinedOrders = [...serverOrders];
      firestoreOrders.forEach(fo => {
        if (!combinedOrders.some(co => co.id === fo.id)) {
          combinedOrders.push(fo);
        }
      });
      
      const localOrders = await db.workOrders.toArray();
      
      const ordersToSave = combinedOrders.map(order => {
        const localOrder = localOrders.find(lo => lo.id === order.id);
        if (localOrder) {
          // Merge instrument statuses from local to fresh data
          const mergedInstruments = order.instruments.map(sInst => {
            const lInst = localOrder.instruments.find(li => li.id === sInst.id);
            return lInst ? { ...sInst, status: lInst.status, notes: lInst.notes } : sInst;
          });
          return { 
            ...order, 
            instruments: mergedInstruments,
            status: calculateOrderStatus(mergedInstruments)
          };
        }
        return {
          ...order,
          status: calculateOrderStatus(order.instruments)
        };
      });

      // Preserve field-created orders that haven't been synced to server yet
      const fieldOrders = localOrders.filter(lo => lo.isFieldCreated && !combinedOrders.some(co => co.id === lo.id));
      
      // Merge and deduplicate just in case
      const allOrders = [...ordersToSave, ...fieldOrders];
      const finalOrders: WorkOrder[] = [];
      const seenIds = new Set();
      
      for (const order of allOrders) {
        if (!seenIds.has(order.id)) {
          finalOrders.push(order as WorkOrder);
          seenIds.add(order.id);
        }
      }

      await db.workOrders.bulkPut(finalOrders);
      if (!isAuto) alert('Órdenes descargadas y sincronizadas.');
    } catch (err) {
      if (!isAuto) alert('Error sincronizando órdenes.');
      console.error(err);
    } finally {
      setIsSyncing(false);
    }
  };

  const filteredOrders = workOrders?.filter(order => {
    // Filtering by ownership
    const isOwner = user && (
      order.technicianId === user.id || 
      order.technicianId === user.email || 
      order.technicianId === user.technicianCode ||
      order.technicianEmail === user.email ||
      (order.isFieldCreated && (order.technicianId === 'anonymous' || !order.technicianId))
    );
    
    // Explicitly allow admins to override ownership filter if requested
    const shouldShow = (user?.role === 'admin' && showAllAsAdmin) || isOwner;
    
    if (!shouldShow) return false;

    const matchesSearch = 
      order.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.instruments?.some(i => i.tag.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesMagnitude = filterMagnitude === 'all' || 
      order.instruments?.some(i => {
        if (filterMagnitude === 'inspection') return i.standard === 'ISO 17020' || i.magnitude === 'inspection';
        if (filterMagnitude === 'maintenance') return i.standard === 'ISO 9001' || ['repair', 'maintenance', 'functional_test'].includes(i.serviceType || '');
        return i.magnitude === filterMagnitude;
      });

    const matchesType = filterType === 'all' || 
      (filterType === 'field' && order.isFieldCreated) ||
      (filterType === 'erp' && !order.isFieldCreated);

    return matchesSearch && matchesMagnitude && matchesType;
  });

  const toggleOrder = (id: string) => {
    const newExpanded = new Set(expandedOrders);
    if (newExpanded.has(id)) newExpanded.delete(id);
    else newExpanded.add(id);
    setExpandedOrders(newExpanded);
  };

  const markAsNonCalibratable = async (orderId: string, instId: string) => {
    const reason = prompt('Indique el motivo por el cual el equipo no puede calibrarse:');
    if (!reason) return;

    const order = workOrders?.find(o => o.id === orderId);
    if (!order) return;

    const updatedInstruments = order.instruments.map(inst => 
      inst.id === instId ? { ...inst, status: 'non_calibratable', notes: reason } : inst
    );

    const newStatus = calculateOrderStatus(updatedInstruments as WorkOrderInstrument[]);

    await db.workOrders.update(orderId, { 
      instruments: updatedInstruments as any,
      status: newStatus
    });
  };

  const getOrderProgress = (orderId: string, instruments: WorkOrderInstrument[]) => {
    if (!instruments || instruments.length === 0) return 0;
    
    const completed = instruments.filter(i => {
      // Check if instrument is marked as completed/non-calibratable in order
      if (i.status !== 'pending') return true;
      
      // OR check if there is an existing calibration for this instrument in this order
      const hasCal = calibrations?.some(c => c.workOrderId === orderId && c.instrumentId === i.id);
      return hasCal;
    }).length;

    return Math.round((completed / instruments.length) * 100);
  };

  const startCalibration = (order: WorkOrder, instrument: WorkOrderInstrument) => {
    navigate('/campo', { 
      state: { 
        order: {
          id: order.id,
          instrumentId: instrument.id,
          clientName: order.clientName,
          instrumentTag: instrument.tag,
          instrumentDescription: instrument.description,
          magnitude: instrument.magnitude,
          metadata: {
             subcategory: instrument.subcategory,
             rangeMin: instrument.rangeMin,
             rangeMax: instrument.rangeMax,
             accuracyClass: instrument.accuracy,
             resolution: instrument.magnitude === 'pressure' ? 0.1 : 1
          }
        } 
      } 
    });
  };

  const syncProgress = async (isAuto = false) => {
    if (!navigator.onLine) {
      if (!isAuto) alert('Sincronización no disponible en modo offline.');
      return;
    }

    try {
      const response = await fetch('/api/dolibarr/sync-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders: workOrders })
      });
      if (response.ok && !isAuto) {
        alert('Progreso sincronizado exitosamente con Dolibarr');
      }
    } catch (err) {
      if (!isAuto) alert('Error sincronizando progreso. Se reintentará al detectar red.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-end mb-10 border-b border-[#141414]/10 pb-6">
        <div>
          <h2 className="text-4xl font-black text-[#141414] tracking-tight">
            {showAllAsAdmin ? 'Todas las Ordenes' : 'Mis Órdenes'}
          </h2>
          <p className="text-[#141414]/50 mt-1 font-medium italic">
            {showAllAsAdmin ? 'Vista administrativa global (Offline Sync)' : 'Agenda técnica del día • Dolibarr ERP'}
          </p>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-3 mr-4">
            <div className={cn(
              "w-2 h-2 rounded-full",
              isOnline ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" : "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
            )} />
            <span className={cn(
              "text-[10px] font-black uppercase tracking-widest transition-colors",
              isOnline ? "text-emerald-700" : "text-amber-700"
            )}>
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
          <button 
            onClick={() => syncProgress(false)}
            className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition-all text-sm font-bold uppercase tracking-widest shadow-xl"
          >
            <Send className="w-4 h-4 text-white/60" />
            Sincronizar Progreso
          </button>
          <button 
            onClick={() => downloadOrders(false)}
            disabled={isSyncing}
            className="flex items-center gap-2 px-6 py-3 bg-[#141414] text-white rounded-2xl hover:bg-[#141414]/90 transition-all text-sm font-bold uppercase tracking-widest shadow-xl disabled:opacity-50"
          >
            <RefreshCw className={cn("w-4 h-4 text-white/60", isSyncing && "animate-spin")} />
            {isSyncing ? 'Buscando...' : 'Descargar Tareas'}
          </button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-8">
        <div className="flex-1 relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[#141414]/20 group-focus-within:text-[#141414]/50 transition-colors" />
          <input 
            type="text"
            className="w-full pl-12 pr-4 py-4 bg-white border border-[#141414]/10 rounded-2xl focus:ring-4 focus:ring-[#141414]/5 outline-none font-medium text-sm transition-all shadow-sm"
            placeholder="Buscar por cliente, tag o ID de orden..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>
        <select 
          className="px-6 py-4 bg-white border border-[#141414]/10 rounded-2xl font-bold text-xs uppercase tracking-widest outline-none focus:ring-4 focus:ring-[#141414]/5 shadow-sm"
          value={filterMagnitude}
          onChange={e => setFilterMagnitude(e.target.value as any)}
        >
          <option value="all">Todas las Magnitudes</option>
          <option value="pressure">Presión (Instrumentos)</option>
          <option value="pressure_transmitter">Transmisores de Presión</option>
          <option value="temperature">Temperatura</option>
          <option value="inspection">Inspección ISO 17020</option>
          <option value="maintenance">Mantenimiento / ISO 9001</option>
        </select>
        <select 
          className="px-6 py-4 bg-white border border-[#141414]/10 rounded-2xl font-bold text-xs uppercase tracking-widest outline-none focus:ring-4 focus:ring-[#141414]/5 shadow-sm"
          value={filterType}
          onChange={e => setFilterType(e.target.value as any)}
        >
          <option value="all">Filtro de Origen</option>
          <option value="erp">Asignadas (ERP)</option>
          <option value="field">Orden de Campo</option>
        </select>
        {user?.role === 'admin' && (
          <button 
            onClick={() => setShowAllAsAdmin(!showAllAsAdmin)}
            className={cn(
              "px-6 py-4 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all shadow-sm border",
              showAllAsAdmin ? "bg-blue-600 text-white border-blue-600" : "bg-white text-[#141414]/40 border-[#141414]/10"
            )}
          >
            {showAllAsAdmin ? 'Viendo Todas (Admin)' : 'Sólo Mis Órdenes'}
          </button>
        )}
      </div>

      <div className="space-y-6">
        {filteredOrders?.length === 0 && (
          <div className="text-center py-32 bg-white border-2 border-dashed border-[#141414]/10 rounded-[3rem]">
            <Calendar className="w-12 h-12 text-[#141414]/10 mx-auto mb-4" />
            <p className="text-[#141414]/40 font-bold uppercase tracking-widest text-xs">Sin órdenes asignadas</p>
          </div>
        )}

        {filteredOrders?.map(order => (
          <div key={order.id} className="bg-white border border-[#141414]/10 rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-all">
            {/* Header de la Orden */}
            <div 
              onClick={() => toggleOrder(order.id)}
              className="p-6 cursor-pointer hover:bg-[#F5F5F0]/30 transition-colors flex items-center justify-between"
            >
              <div className="flex items-center gap-6">
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center",
                  order.priority === 'high' ? "bg-red-100 text-red-600" : "bg-[#F5F5F0] text-[#141414]/40"
                )}>
                  <ListTodo className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-black text-[#141414]/30 uppercase tracking-[0.2em]">{order.id}</span>
                    <h4 className="font-black text-xl text-[#141414] tracking-tighter">{order.clientName}</h4>
                    {order.isFieldCreated ? (
                      <span className="ml-2 px-2 py-0.5 rounded bg-blue-600 text-white text-[8px] font-black uppercase tracking-widest shadow-xl flex items-center gap-1.5 animate-pulse">
                        <Activity className="w-2 h-2" /> Orden de Campo
                      </span>
                    ) : (
                      <span className="ml-2 px-2 py-0.5 rounded bg-emerald-600/10 text-emerald-700 text-[8px] font-black uppercase tracking-widest">
                        Asignada ERP
                      </span>
                    )}
                    {order.standard && (
                      <span className={cn(
                        "ml-2 px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest",
                        order.standard === 'ISO 17025' ? "bg-blue-100 text-blue-700" : 
                        order.standard === 'ISO 17020' ? "bg-amber-100 text-amber-700" : 
                        order.standard === 'ISO 9001' ? "bg-purple-100 text-purple-700" : 
                        "bg-orange-100 text-orange-700"
                      )}>
                        {order.standard}
                      </span>
                    )}
                    {order.serviceType && (
                      <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 text-[8px] font-black uppercase tracking-widest">
                        {order.serviceType.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-[#141414]/40 font-bold">
                    <span className="flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 text-[#141414]/20" /> {order.location}</span>
                    <span className="flex items-center gap-1.5 px-2 py-0.5 bg-[#141414]/5 rounded text-emerald-600 font-black"><ListTodo className="w-3.5 h-3.5" /> {order.instruments?.length || 0} Equipos</span>
                    {order.technicianId && order.technicianId !== 'anonymous' && (
                      <span className="flex items-center gap-1.5 text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                        <Users className="w-3.5 h-3.5" /> 
                        <span className="truncate max-w-[150px]">
                          {order.technicianName || order.technicianEmail || order.technicianId}
                        </span>
                      </span>
                    )}
                    {order.lastSyncAt && (
                      <span className="flex items-center gap-1.5 italic text-[10px] text-[#141414]/20">
                        Sincronizado {new Date(order.lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex items-center gap-4 w-64 max-w-full">
                    <div className="flex-1 h-2 bg-[#141414]/5 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 transition-all duration-1000 ease-out" 
                        style={{ width: `${getOrderProgress(order.id, order.instruments)}%` }} 
                      />
                    </div>
                    <span className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest">
                      {getOrderProgress(order.id, order.instruments)}%
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-6">
                {order.status === 'completed' ? (
                  <div className="flex items-center gap-1.5 text-emerald-500 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="text-[9px] font-black uppercase tracking-widest">Ejecución Completa</span>
                  </div>
                ) : order.status === 'in_progress' ? (
                  <div className="flex items-center gap-1.5 text-blue-500 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-100">
                    <Clock className="w-3.5 h-3.5 animate-pulse" />
                    <span className="text-[9px] font-black uppercase tracking-widest">En Ejecución</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-amber-500 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-100">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span className="text-[9px] font-black uppercase tracking-widest">Sin Iniciar</span>
                  </div>
                )}
                {order.syncStatus === 'synced' && (
                  <div className="flex items-center gap-1.5 text-emerald-500 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span className="text-[9px] font-black uppercase tracking-widest">Sinc. ERP</span>
                  </div>
                )}
                {order.priority === 'high' && (
                  <span className="px-3 py-1 bg-red-100 text-red-700 rounded-full text-[9px] font-black uppercase tracking-widest">Prioridad Alta</span>
                )}
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/ordenes/${order.id}`);
                  }}
                  className="px-6 py-3 bg-[#141414] text-white rounded-2xl hover:scale-105 active:scale-95 transition-all text-[10px] font-black uppercase tracking-widest shadow-xl flex items-center gap-2"
                >
                  Ver Equipos <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value, subValue }: any) {
  return (
    <div className="flex items-start gap-4">
      <div className="p-2 bg-[#F5F5F0] rounded-xl text-[#141414]/40">{icon}</div>
      <div>
        <p className="text-[10px] font-bold text-[#141414]/30 uppercase tracking-wider">{label}</p>
        <p className="text-sm font-bold text-[#141414]">{value}</p>
        {subValue && <p className="text-[9px] text-[#141414]/40 font-mono mt-1">{subValue}</p>}
      </div>
    </div>
  );
}
