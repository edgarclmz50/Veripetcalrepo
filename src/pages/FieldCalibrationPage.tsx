import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalibrationFormRegistry } from '../components/calibracion/FormRegistry';
import { db } from '../lib/db';
import { AlertCircle, ChevronLeft } from 'lucide-react';

export default function FieldCalibrationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [showSelector, setShowSelector] = useState(false);

  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const id = searchParams.get('id');

    const loadData = async () => {
      if (location.state?.order) {
        const orderData = location.state.order;
        setData(orderData);
        // Si es presión o transmisor, permitir elegir el formulario específico en un submenú
        if (!orderData.magnitude || orderData.magnitude === 'pressure' || orderData.magnitude === 'pressure_transmitter') {
          setShowSelector(true);
        }
      } else if (id) {
        const cal = await db.calibrations.get(id);
        if (cal) {
          setData(cal);
        } else {
          navigate('/campo');
        }
      } else {
        navigate('/campo');
      }
    };

    loadData();
  }, [location, navigate]);

  const handleSelectMagnitude = (m: string) => {
    setData({ ...data, magnitude: m });
    setShowSelector(false);
  };

  if (!data) return <div className="p-20 text-center font-black animate-pulse uppercase tracking-[0.2em]">Cargando Instrumento...</div>;

  if (showSelector || !data.magnitude) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-6">
        <div className="bg-white p-12 rounded-[3rem] shadow-2xl max-w-xl w-full border border-[#141414]/5 space-y-8 animate-in zoom-in-95 duration-300">
          <div className="text-center space-y-4">
            <div className="w-20 h-20 bg-amber-50 rounded-3xl flex items-center justify-center mx-auto">
              <AlertCircle className="w-10 h-10 text-amber-500" />
            </div>
            <h2 className="text-2xl font-black text-[#141414] uppercase tracking-tight">Seleccionar Formulario</h2>
            <p className="text-[#141414]/40 font-bold uppercase text-[10px] tracking-widest leading-relaxed">
              El equipo {data.instrumentTag} requiere que especifique el tipo de formulario de calibración antes de comenzar.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <button 
              onClick={() => handleSelectMagnitude('pressure')}
              className="p-6 bg-gray-50 border border-transparent rounded-2xl text-left hover:border-blue-500 hover:bg-blue-50 transition-all group"
            >
              <h4 className="font-black text-[#141414] text-sm uppercase tracking-widest group-hover:text-blue-600">Presión (Manómetros/Vacuómetros)</h4>
              <p className="text-[10px] font-bold text-[#141414]/40 uppercase mt-1">Instrumentos de indicación mecánica o digital</p>
            </button>
            
            <button 
              onClick={() => handleSelectMagnitude('pressure_transmitter')}
              className="p-6 bg-gray-50 border border-transparent rounded-2xl text-left hover:border-blue-500 hover:bg-blue-50 transition-all group"
            >
              <h4 className="font-black text-[#141414] text-sm uppercase tracking-widest group-hover:text-blue-600">Transmisor de Presión</h4>
              <p className="text-[10px] font-bold text-[#141414]/40 uppercase mt-1">Salida eléctrica (4-20mA, 0-10V, etc)</p>
            </button>

            <button 
              onClick={() => handleSelectMagnitude('temperature')}
              className="p-6 bg-gray-50 border border-transparent rounded-2xl text-left hover:border-blue-500 hover:bg-blue-50 transition-all group"
            >
              <h4 className="font-black text-[#141414] text-sm uppercase tracking-widest group-hover:text-blue-600">Temperatura (Termómetros)</h4>
              <p className="text-[10px] font-bold text-[#141414]/40 uppercase mt-1">Instrumentos de indicación de temperatura</p>
            </button>
          </div>

          <button 
            onClick={() => navigate(-1)}
            className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-[#141414]/40 hover:text-[#141414] transition-colors flex items-center justify-center gap-2"
          >
            <ChevronLeft className="w-4 h-4" /> Volver a Detalles
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fcfcfc]">
      <CalibrationFormRegistry 
        magnitude={data.magnitude}
        initialData={data} 
        onCancel={() => navigate('/campo')}
        onSuccess={() => navigate('/campo')}
      />
    </div>
  );
}
