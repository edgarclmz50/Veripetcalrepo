import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/db';
import { WorkOrder, WorkOrderInstrument } from '../types';
import { Plus, Trash2, Save, ChevronLeft, Building2, MapPin, Gauge, Info, ClipboardCheck } from 'lucide-react';
import { cn } from '../lib/utils';
import { getAuthUser } from '../lib/auth';
import { motion, AnimatePresence } from 'motion/react';

export function CreateFieldOrder() {
  const navigate = useNavigate();
  const user = getAuthUser();
  const [loading, setLoading] = useState(false);
  
  const [order, setOrder] = useState<Partial<WorkOrder>>({
    clientName: '',
    location: '',
    priority: 'normal',
    instruments: [],
    serviceType: 'calibration',
    standard: 'ISO 17025',
    isFieldCreated: true,
    source: 'field',
    syncStatus: 'pending'
  });

  const [newInstrument, setNewInstrument] = useState<Partial<WorkOrderInstrument>>({
    tag: '',
    description: '',
    magnitude: 'pressure',
    subcategory: '',
    rangeMin: 0,
    rangeMax: 100,
    accuracy: '1.0',
    unit: 'psi'
  });

  const addInstrument = () => {
    if (!newInstrument.tag || !newInstrument.description) {
      alert('TAG y Descripción son obligatorios');
      return;
    }

    const instrument: WorkOrderInstrument = {
      id: `FIELD-INST-${Date.now()}`,
      tag: newInstrument.tag!,
      description: newInstrument.description!,
      magnitude: newInstrument.magnitude as any,
      subcategory: newInstrument.subcategory || '',
      rangeMin: Number(newInstrument.rangeMin),
      rangeMax: Number(newInstrument.rangeMax),
      accuracy: newInstrument.accuracy || '1.0',
      unit: newInstrument.unit || 'psi',
      status: 'pending',
      isFieldCreated: true
    };

    setOrder(prev => ({
      ...prev,
      instruments: [...(prev.instruments || []), instrument]
    }));

    // Reset new instrument form
    setNewInstrument({
      tag: '',
      description: '',
      magnitude: 'pressure',
      subcategory: '',
      rangeMin: 0,
      rangeMax: 100,
      accuracy: '1.0',
      unit: 'psi'
    });
  };

  const removeInstrument = (id: string) => {
    setOrder(prev => ({
      ...prev,
      instruments: prev.instruments?.filter(i => i.id !== id)
    }));
  };

  const handleSave = async () => {
    // Check if there's a pending instrument that hasn't been added
    let currentInstruments = [...(order.instruments || [])];
    
    if (newInstrument.tag && newInstrument.description) {
      const pendingInstrument: WorkOrderInstrument = {
        id: `FIELD-INST-${Date.now()}`,
        tag: newInstrument.tag!,
        description: newInstrument.description!,
        magnitude: newInstrument.magnitude as any,
        subcategory: newInstrument.subcategory || '',
        rangeMin: Number(newInstrument.rangeMin),
        rangeMax: Number(newInstrument.rangeMax),
        accuracy: newInstrument.accuracy || '1.0',
        unit: newInstrument.unit || 'psi',
        status: 'pending',
        isFieldCreated: true
      };
      currentInstruments.push(pendingInstrument);
    }

    if (!order.clientName || !order.location || currentInstruments.length === 0) {
      alert('Por favor complete los datos del cliente y agregue al menos un equipo. Si llenó los datos del equipo abajo, asegúrese de que el TAG y Descripción no estén vacíos.');
      return;
    }

    setLoading(true);
    try {
      const fullOrder: WorkOrder = {
        ...order as WorkOrder,
        id: `FIELD-${Date.now()}`,
        clientId: 'FIELD-CLIENT',
        instruments: currentInstruments,
        scheduledDate: Date.now(),
        lastSyncAt: Date.now(),
        technicianId: user?.technicianCode || user?.email || user?.id || 'anonymous',
        technicianName: user?.name,
        technicianEmail: user?.email
      };

      await db.workOrders.put(fullOrder);
      
      // Add to sync queue
      await db.syncQueue.put({
        id: `SYNC-${Date.now()}`,
        type: 'update_order',
        status: 'pending',
        payload: fullOrder,
        createdAt: Date.now(),
        attempts: 0
      });

      navigate('/ordenes');
    } catch (error) {
      console.error(error);
      alert('Error al guardar la orden de campo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-20">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate(-1)}
            className="p-3 bg-white border border-[#141414]/10 rounded-2xl hover:bg-[#F5F5F0] transition-all"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-3xl font-black text-[#141414] tracking-tight">Nueva Orden de Campo</h2>
            <p className="text-[#141414]/40 text-xs font-bold uppercase tracking-widest mt-1">Sincronización Off-ERP • Metrología In-Situ</p>
          </div>
        </div>
        <button 
          onClick={handleSave}
          disabled={loading}
          className="flex items-center gap-2 px-8 py-4 bg-[#141414] text-white rounded-[2rem] hover:scale-105 active:scale-95 disabled:opacity-50 disabled:scale-100 transition-all text-[10px] font-black uppercase tracking-widest shadow-2xl"
        >
          <Save className="w-4 h-4" />
          {loading ? 'Guardando...' : 'Confirmar Orden'}
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Client Info */}
        <div className="md:col-span-2 space-y-8">
          <section className="bg-white border border-[#141414]/10 rounded-[2.5rem] p-8 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Building2 className="w-4 h-4 text-[#141414]/20" />
              <h3 className="text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Datos del Cliente</h3>
            </div>
            <div className="grid grid-cols-1 gap-6">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#141414]/40 mb-2 ml-2">Nombre de la Empresa</label>
                <input 
                  type="text" 
                  value={order.clientName}
                  onChange={e => setOrder({...order, clientName: e.target.value})}
                  className="w-full px-6 py-4 bg-[#F5F5F0]/50 border-none rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/5 outline-none transition-all"
                  placeholder="Ej: Petroquímica del Norte"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-[#141414]/40 mb-2 ml-2">Ubicación / Planta</label>
                <div className="relative">
                  <MapPin className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-[#141414]/20" />
                  <input 
                    type="text" 
                    value={order.location}
                    onChange={e => setOrder({...order, location: e.target.value})}
                    className="w-full pl-14 pr-6 py-4 bg-[#F5F5F0]/50 border-none rounded-2xl text-sm font-bold focus:ring-4 focus:ring-blue-500/5 outline-none transition-all"
                    placeholder="Ej: Planta de Tratamiento • Sector C"
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="bg-white border border-[#141414]/10 rounded-[2.5rem] p-8 shadow-sm">
            <div className="flex items-center gap-2 mb-6">
              <Gauge className="w-4 h-4 text-[#141414]/20" />
              <h3 className="text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Equipos a Intervenir</h3>
            </div>
            
            {/* List existing */}
            <div className="space-y-4 mb-8">
              <AnimatePresence>
                {order.instruments?.map((inst) => (
                  <motion.div 
                    key={inst.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="flex items-center justify-between p-4 bg-[#F5F5F0]/30 border border-[#141414]/5 rounded-2xl"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center font-black text-[#141414] text-xs">
                        {inst.tag.substring(0,2)}
                      </div>
                      <div>
                        <p className="text-sm font-black text-[#141414]">{inst.tag}</p>
                        <p className="text-[10px] font-bold text-[#141414]/40">{inst.description}</p>
                      </div>
                    </div>
                    <button 
                      onClick={() => removeInstrument(inst.id)}
                      className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
              {order.instruments?.length === 0 && (
                <div className="text-center py-10 border-2 border-dashed border-[#141414]/5 rounded-3xl">
                  <p className="text-[10px] font-black uppercase tracking-widest text-[#141414]/20">No hay equipos agregados</p>
                </div>
              )}
            </div>

            {/* Add form */}
            <div className="p-6 bg-[#F5F5F0]/20 border border-[#141414]/5 rounded-3xl">
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-[8px] font-black uppercase tracking-widest text-[#141414]/40 mb-2">Tag del Equipo</label>
                  <input 
                    type="text" 
                    value={newInstrument.tag}
                    onChange={e => setNewInstrument({...newInstrument, tag: e.target.value})}
                    className="w-full px-4 py-3 bg-white border border-[#141414]/10 rounded-xl text-xs font-bold outline-none"
                    placeholder="PT-101"
                  />
                </div>
                <div>
                  <label className="block text-[8px] font-black uppercase tracking-widest text-[#141414]/40 mb-2">Magnitud</label>
                  <select 
                    value={newInstrument.magnitude}
                    onChange={e => setNewInstrument({...newInstrument, magnitude: e.target.value as any})}
                    className="w-full px-4 py-3 bg-white border border-[#141414]/10 rounded-xl text-xs font-bold outline-none appearance-none"
                  >
                    <option value="pressure">Presión (Manómetro)</option>
                    <option value="pressure_transmitter">Transmisor de Presión</option>
                    <option value="temperature">Temperatura</option>
                    <option value="flow">Flujo</option>
                    <option value="other">Otros</option>
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className="block text-[8px] font-black uppercase tracking-widest text-[#141414]/40 mb-2">Descripción</label>
                <input 
                  type="text" 
                  value={newInstrument.description}
                  onChange={e => setNewInstrument({...newInstrument, description: e.target.value})}
                  className="w-full px-4 py-3 bg-white border border-[#141414]/10 rounded-xl text-xs font-bold outline-none"
                  placeholder="Transmisor de presión de línea principal"
                />
              </div>
              <div className="grid grid-cols-3 gap-4 mb-6">
                <div>
                  <label className="block text-[8px] font-black uppercase tracking-widest text-[#141414]/40 mb-2">Min</label>
                  <input 
                    type="number" 
                    value={newInstrument.rangeMin}
                    onChange={e => setNewInstrument({...newInstrument, rangeMin: Number(e.target.value)})}
                    className="w-full px-4 py-3 bg-white border border-[#141414]/10 rounded-xl text-xs font-bold outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[8px] font-black uppercase tracking-widest text-[#141414]/40 mb-2">Max</label>
                  <input 
                    type="number" 
                    value={newInstrument.rangeMax}
                    onChange={e => setNewInstrument({...newInstrument, rangeMax: Number(e.target.value)})}
                    className="w-full px-4 py-3 bg-white border border-[#141414]/10 rounded-xl text-xs font-bold outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[8px] font-black uppercase tracking-widest text-[#141414]/40 mb-2">Unidad</label>
                  <input 
                    type="text" 
                    value={newInstrument.unit}
                    onChange={e => setNewInstrument({...newInstrument, unit: e.target.value})}
                    className="w-full px-4 py-3 bg-white border border-[#141414]/10 rounded-xl text-xs font-bold outline-none"
                    placeholder="psi, °C..."
                  />
                </div>
              </div>
              <button 
                onClick={addInstrument}
                className="w-full py-4 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Agregar Equipo
              </button>
            </div>
          </section>
        </div>

        {/* Sidebar settings */}
        <div className="space-y-6">
          <section className="bg-white border border-[#141414]/10 rounded-[2rem] p-6 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardCheck className="w-4 h-4 text-[#141414]/20" />
              <h3 className="text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Alcance</h3>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[8px] font-black uppercase tracking-widest text-[#141414]/40 mb-2">Tipo de Servicio</label>
                <select 
                  className="w-full px-4 py-3 bg-[#F5F5F0]/50 border-none rounded-xl text-[10px] font-black uppercase outline-none"
                  value={order.serviceType}
                  onChange={e => setOrder({...order, serviceType: e.target.value as any})}
                >
                  <option value="calibration">Calibración</option>
                  <option value="inspection">Inspección</option>
                  <option value="repair">Reparación</option>
                  <option value="maintenance">Mantenimiento</option>
                </select>
              </div>
              <div>
                <label className="block text-[8px] font-black uppercase tracking-widest text-[#141414]/40 mb-2">Normativa Aplicable</label>
                <select 
                  className="w-full px-4 py-3 bg-[#F5F5F0]/50 border-none rounded-xl text-[10px] font-black uppercase outline-none"
                  value={order.standard}
                  onChange={e => setOrder({...order, standard: e.target.value as any})}
                >
                  <option value="ISO 17025">ISO 17025</option>
                  <option value="ISO 17020">ISO 17020</option>
                  <option value="ISO 9001">ISO 9001</option>
                  <option value="Norma Interna">Norma Interna</option>
                </select>
              </div>
              <div>
                <label className="block text-[8px] font-black uppercase tracking-widest text-[#141414]/40 mb-2">Prioridad</label>
                <select 
                  className="w-full px-4 py-3 bg-[#F5F5F0]/50 border-none rounded-xl text-[10px] font-black uppercase outline-none"
                  value={order.priority}
                  onChange={e => setOrder({...order, priority: e.target.value as any})}
                >
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="low">Baja</option>
                </select>
              </div>
            </div>
          </section>

          <section className="bg-amber-50 border border-amber-200 rounded-[2rem] p-6">
            <div className="flex items-start gap-4">
              <Info className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-[10px] font-black uppercase text-amber-900 tracking-widest">Sincronización ERP</h4>
                <p className="text-[10px] text-amber-700 font-bold mt-2 leading-relaxed italic">
                  Las órdenes creadas en campo se sincronizarán con Dolibarr automáticamente al recuperar conexión. El departamento administrativo recibirá una alerta para validar el nuevo registro.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
