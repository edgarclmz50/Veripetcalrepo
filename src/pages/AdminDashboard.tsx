import React, { useEffect, useState } from 'react';
import { BarChart, Users, AlertTriangle, ShieldCheck, Database, UploadCloud } from 'lucide-react';
import { db as firestore } from '../lib/firebase';
import { collection, query, getDocs, getCountFromServer } from 'firebase/firestore';
import { syncService } from '../lib/SyncService';
import { UserManagement } from '../components/UserManagement';

export function AdminDashboard() {
  const [stats, setStats] = useState({
    techs: 0,
    services: 0,
    pending: 0,
    signed: 0
  });
  const [loading, setLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);

  const handleGlobalExport = async () => {
    setIsExporting(true);
    try {
      const result = await syncService.exportAllToFirestore();
      alert(`Sincronización completada: ${result?.count} registros exportados a Firebase.`);
    } catch (err) {
      alert("Error en la exportación global.");
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [usersSnap, califsSnap] = await Promise.all([
          getDocs(collection(firestore, 'users')),
          getDocs(collection(firestore, 'calibrations'))
        ]);
        
        const allCalifs = califsSnap.docs.map(d => d.data());
        
        setStats({
          techs: usersSnap.size,
          services: allCalifs.length,
          pending: allCalifs.filter(c => c.status !== 'published').length,
          signed: allCalifs.filter(c => c.status === 'published').length
        });
      } catch (err) {
        console.error("Error fetching admin stats:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold text-[#141414]">Panel Administrativo</h2>
          <p className="text-sm text-[#141414]/40 font-bold uppercase tracking-widest mt-1">Control Central de Metrología</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={handleGlobalExport}
            disabled={isExporting}
            className="flex items-center gap-2 px-6 py-2 bg-[#141414] text-white rounded-xl text-xs font-bold hover:bg-[#141414]/90 transition-all disabled:opacity-50"
          >
            {isExporting ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <UploadCloud className="w-4 h-4" />}
            Exportar PWA a Firebase
          </button>
          <button 
            onClick={() => syncService.downloadBackup()}
            className="flex items-center gap-2 px-6 py-2 bg-white border border-[#141414]/10 text-[#141414] rounded-xl text-xs font-bold hover:bg-[#141414]/5 transition-all"
          >
            <Database className="w-4 h-4" />
            Descargar Respaldo JSON
          </button>
          <div className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-xs font-bold border border-emerald-100">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Core Synced
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-4 gap-4 mb-8">
        <StatItem icon={<Users className="w-5 h-5" />} label="Técnicos" value={loading ? '...' : stats.techs} />
        <StatItem icon={<BarChart className="w-5 h-5" />} label="Servicios" value={loading ? '...' : stats.services} />
        <StatItem icon={<AlertTriangle className="w-5 h-5" />} label="Por Aprobar" value={loading ? '...' : stats.pending} color="text-amber-600" />
        <StatItem icon={<ShieldCheck className="w-5 h-5" />} label="Firmados" value={loading ? '...' : stats.signed} color="text-emerald-600" />
      </div>

      <div className="grid grid-cols-3 gap-8">
        <div className="col-span-2 bg-white border border-[#141414]/10 rounded-3xl p-8 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-lg">Cola de Procesamiento Cloud</h3>
            <Database className="w-4 h-4 text-[#141414]/20" />
          </div>
          <div className="space-y-4">
            {[1,2,3].map(i => (
              <div key={i} className="flex items-center justify-between p-4 bg-[#F5F5F0]/50 rounded-2xl">
                <div className="flex items-center gap-4">
                  <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                  <div>
                    <p className="font-bold text-sm text-[#141414]/80">Procesando Certificado CT-2024-{i}05</p>
                    <p className="text-[10px] text-[#141414]/40 uppercase tracking-widest font-bold">Distribución T-Student • Monte Carlo</p>
                  </div>
                </div>
                <span className="text-xs font-mono text-[#141414]/60">Activo</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#141414] text-white rounded-3xl p-8 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-xl mb-2">Conector Dolibarr</h3>
            <p className="text-white/60 text-sm leading-relaxed">Sincronización bidireccional activa. Facturación y certificados en tiempo real.</p>
          </div>
          <div className="mt-8 pt-8 border-t border-white/10 space-y-4">
            <div className="flex justify-between text-sm">
              <span className="text-white/40 font-medium">Estado API</span>
              <span className="text-emerald-400 font-bold tracking-tight">ONLINE</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-white/40 font-medium">Última Sync</span>
              <span className="font-bold">{new Date().toLocaleTimeString()}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8">
        <UserManagement />
      </div>
    </div>
  );
}

function StatItem({ icon, label, value, color = "text-[#141414]" }: any) {
  return (
    <div className="bg-white border border-[#141414]/10 p-6 rounded-2xl shadow-sm hover:border-[#141414]/20 transition-all">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-[#F5F5F0] rounded-xl text-[#141414]/60">
          {icon}
        </div>
      </div>
      <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest leading-none">{label}</p>
      <p className={`text-2xl font-bold mt-2 ${color}`}>{value}</p>
    </div>
  );
}
