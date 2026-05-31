import React from 'react';
import { PressureForm } from './PressureForm';
import { TemperatureForm } from './TemperatureForm';
import { InspectionForm } from './InspectionForm';
import { PressureTransmitterForm } from './PressureTransmitterForm';
import { CalibrationData } from '../../types';
import { Thermometer, Gauge, AlertTriangle, ClipboardCheck } from 'lucide-react';

interface FormRegistryProps {
  magnitude: string;
  initialData?: Partial<CalibrationData>;
  onCancel: () => void;
  onSuccess: () => void;
}

export function CalibrationFormRegistry({ magnitude, initialData, onCancel, onSuccess }: FormRegistryProps) {
  switch (magnitude) {
    case 'pressure':
      return <PressureForm initialData={initialData} onCancel={onCancel} onSuccess={onSuccess} />;
    case 'pressure_transmitter':
      return <PressureTransmitterForm initialData={initialData} onCancel={onCancel} onSuccess={onSuccess} />;
    case 'temperature':
      return <TemperatureForm initialData={initialData} onCancel={onCancel} onSuccess={onSuccess} />;
    case 'inspection':
      return <InspectionForm initialData={initialData} onCancel={onCancel} onSuccess={onSuccess} />;
    default:
      return (
        <div className="bg-white border border-[#141414]/10 rounded-[3rem] p-20 text-center shadow-xl animate-in fade-in">
          <div className="w-20 h-20 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-amber-100">
            <AlertTriangle className="w-10 h-10 text-amber-500" />
          </div>
          <h3 className="text-2xl font-black text-[#141414]">Magnitud en Desarrollo</h3>
          <p className="text-[#141414]/40 mt-4 max-w-sm mx-auto leading-relaxed">
            El módulo capturador de datos para <span className="font-black text-[#141414] uppercase">{magnitude}</span> 
            está siendo validado bajo los estándares ISO/IEC 17025. Pronto estará disponible.
          </p>
          <button 
            onClick={onCancel}
            className="mt-10 px-8 py-4 bg-[#141414] text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:scale-105 transition-all shadow-xl"
          >
            Volver al Listado
          </button>
        </div>
      );
  }
}
