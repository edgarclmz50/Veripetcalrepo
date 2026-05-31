import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, Chrome } from 'lucide-react';
import { loginWithGoogle } from '../lib/auth';

export function Login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await loginWithGoogle();
      navigate('/ordenes');
    } catch (err: any) {
      setError(err.message || 'Error al iniciar sesión');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center p-6 bg-[radial-gradient(#14141411_1px,transparent_1px)] [background-size:20px_20px]">
      <div className="w-full max-w-md bg-white border border-[#141414]/10 rounded-[2.5rem] p-10 shadow-2xl overflow-hidden relative">
        <div className="absolute top-0 right-0 p-8 opacity-[0.03]">
          <Shield className="w-32 h-32 text-[#141414]" />
        </div>

        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-[#141414] text-white rounded-3xl mb-6 shadow-xl">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-black text-[#141414] tracking-tight">VeriPet Login</h1>
          <p className="text-[#141414]/60 mt-2 font-medium">Software Integral de Metrología</p>
        </div>

        <div className="space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs font-bold text-center">
              {error}
            </div>
          )}
          
          <button 
            type="button"
            disabled={loading}
            onClick={handleLogin}
            className="w-full bg-[#141414] text-white p-5 rounded-2xl font-bold text-sm uppercase tracking-widest hover:bg-[#141414]/90 transition-all shadow-xl active:scale-[0.98] flex items-center justify-center gap-3 disabled:opacity-50"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Chrome className="w-5 h-5" />
            )}
            {loading ? 'Iniciando...' : 'Iniciar con Google'}
          </button>
        </div>

        <p className="text-center mt-8 text-[10px] text-[#141414]/30 uppercase tracking-widest font-bold">
          Acceso Restringido • ISO/IEC 17025
        </p>
      </div>
    </div>
  );
}
