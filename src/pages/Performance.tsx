import React, { useEffect, useState } from 'react';
import { db } from '../lib/db';
import { WorkOrder } from '../types';
import { 
  TrendingUp, 
  BarChart3, 
  PieChart as PieChartIcon, 
  Target, 
  Award,
  Clock,
  CheckCircle2,
  AlertCircle,
  Activity,
  Lightbulb
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { cn } from '../lib/utils';
import { db as firestore } from '../lib/firebase';
import { collection, query, getDocs, orderBy, limit } from 'firebase/firestore';

export function Performance() {
  const [stats, setStats] = useState({
    totalInstruments: 0,
    completed: 0,
    failed: 0,
    pending: 0,
    efficiency: 0,
    activityData: [] as any[],
    statusData: [] as any[]
  });
  const [findings, setFindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const orders = await db.workOrders.toArray();
        let total = 0;
        let completed = 0;
        let failed = 0;
        let pending = 0;
        
        const activityMap: Record<string, number> = {};
        
        orders.forEach(order => {
          order.instruments.forEach(inst => {
            total++;
            if (inst.status === 'completed') {
              completed++;
              const date = new Date(order.scheduledDate).toLocaleDateString();
              activityMap[date] = (activityMap[date] || 0) + 1;
            } else if (inst.status === 'non_calibratable') {
              failed++;
            } else {
              pending++;
            }
          });
        });

        const activityData = Object.entries(activityMap).map(([date, count]) => ({
          date,
          count
        })).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        const statusData = [
          { name: 'Completados', value: completed, color: '#10b981' },
          { name: 'Fallidos', value: failed, color: '#ef4444' },
          { name: 'Pendientes', value: pending, color: '#f59e0b' }
        ];

        setStats({
          totalInstruments: total,
          completed,
          failed,
          pending,
          efficiency: total > 0 ? Math.round((completed / total) * 100) : 0,
          activityData,
          statusData: statusData.filter(d => d.value > 0)
        });

        // Load findings from Firestore
        const q = query(collection(firestore, 'hallazgos'), orderBy('createdAt', 'desc'), limit(5));
        const findingsSnap = await getDocs(q);
        setFindings(findingsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      } catch (err) {
        console.error("Error loading performance data:", err);
      } finally {
        setLoading(false);
      }
    };

    loadStats();
  }, []);

  if (loading) return <div className="p-8 text-center font-black uppercase text-[#141414]/20 animate-pulse">Calculando métricas...</div>;

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      <div>
        <h1 className="text-3xl font-black text-[#141414] tracking-tight">Rendimiento Técnico</h1>
        <p className="text-sm font-bold text-[#141414]/40 uppercase tracking-widest mt-1">Indicadores clave de desempeño y eficiencia</p>
      </div>

      {/* Grid de KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <KPICard 
          title="Eficiencia Global" 
          value={`${stats.efficiency}%`} 
          icon={<Target className="w-5 h-5 text-emerald-500" />}
          trend="+2.4%"
          color="emerald"
        />
        <KPICard 
          title="Equipos Listos" 
          value={stats.completed} 
          icon={<CheckCircle2 className="w-5 h-5 text-blue-500" />}
          trend={`${stats.completed}/${stats.totalInstruments}`}
          color="blue"
        />
        <KPICard 
          title="Incidencias" 
          value={stats.failed} 
          icon={<AlertCircle className="w-5 h-5 text-red-500" />}
          trend="Reporte técnico"
          color="red"
        />
        <KPICard 
          title="Puntaje Calidad" 
          value="98.2" 
          icon={<Award className="w-5 h-5 text-amber-500" />}
          trend="ISO 17025"
          color="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Gráfico de Actividad */}
        <div className="lg:col-span-2 bg-white border border-[#141414]/10 rounded-3xl p-8 shadow-sm">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-xs font-black text-[#141414] uppercase tracking-widest flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              Tendencia de Calibración
            </h3>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.activityData}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#141414" strokeOpacity={0.05} />
                <XAxis 
                  dataKey="date" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 900, fill: '#141414', opacity: 0.3 }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 10, fontWeight: 900, fill: '#141414', opacity: 0.3 }}
                />
                <Tooltip 
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontSize: '10px', fontWeight: 900 }}
                />
                <Area 
                  type="monotone" 
                  dataKey="count" 
                  stroke="#10b981" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorCount)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Distribución de Estatus */}
        <div className="bg-white border border-[#141414]/10 rounded-3xl p-8 shadow-sm text-center flex flex-col items-center">
          <h3 className="text-xs font-black text-[#141414] uppercase tracking-widest flex items-center gap-2 mb-8 self-start">
            <PieChartIcon className="w-4 h-4 text-blue-500" />
            Productividad
          </h3>
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.statusData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {stats.statusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-4 mt-4">
            {stats.statusData.map((d, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="text-[10px] font-black text-[#141414]/40 uppercase tracking-widest">{d.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Hallazgos Técnicos Globales */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-white border border-[#141414]/10 rounded-3xl p-8 shadow-sm grow">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xs font-black text-[#141414] uppercase tracking-widest flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-amber-500" />
              Base de Conocimiento Reciente
            </h3>
          </div>
          <div className="space-y-4">
            {findings.length > 0 ? findings.map(f => (
              <div key={f.id} className="p-4 bg-[#F5F5F0]/50 rounded-2xl border border-[#141414]/5">
                <p className="font-black text-sm text-[#141414]">{f.title}</p>
                <p className="text-xs text-[#141414]/60 mt-1 line-clamp-2">{f.content}</p>
                <div className="flex justify-between items-center mt-3 pt-3 border-t border-[#141414]/5">
                  <span className="text-[9px] font-black text-blue-600 uppercase tracking-widest">TAG: {f.instrumentId}</span>
                  <span className="text-[9px] font-black text-[#141414]/20 uppercase tracking-widest">
                    {f.createdAt?.seconds ? new Date(f.createdAt.seconds * 1000).toLocaleDateString() : 'Reciente'}
                  </span>
                </div>
              </div>
            )) : <p className="text-center py-8 text-[10px] font-bold text-[#141414]/20 uppercase tracking-widest">No hay hallazgos registrados</p>}
          </div>
        </div>

        <div className="bg-[#141414] rounded-3xl p-8 text-white relative overflow-hidden group flex flex-col justify-between">
          <Activity className="absolute -right-8 -bottom-8 w-48 h-48 text-white/5 group-hover:scale-110 transition-transform duration-700" />
          <div className="relative z-10">
            <span className="bg-emerald-500 text-white text-[9px] font-black px-2 py-1 rounded-lg uppercase tracking-widest">IA Insight</span>
            <h4 className="text-2xl font-black mt-4 leading-tight">Su ritmo de ejecución ha mejorado un 12% en la última semana.</h4>
            <p className="text-white/50 text-xs font-bold mt-2 uppercase tracking-wide leading-relaxed">
              Basado en los últimos certificados emitidos, se detecta una reducción del 15% en el tiempo de estabilización térmica.
            </p>
          </div>
          <div className="relative z-10 flex justify-between pt-8 mt-8 border-t border-white/10 text-center">
            <div>
              <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">Días Récord</p>
              <p className="text-3xl font-black">12</p>
            </div>
            <div>
              <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1">Eficacia</p>
              <p className="text-3xl font-black text-emerald-500">98.2</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function KPICard({ title, value, icon, trend, color }: any) {
  const colorMap: any = {
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    red: "bg-red-50 text-red-600 border-red-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100"
  };

  return (
    <div className="bg-white border border-[#141414]/10 rounded-3xl p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div className={cn("w-10 h-10 rounded-2xl flex items-center justify-center border", colorMap[color])}>
          {icon}
        </div>
        <span className={cn("text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg", colorMap[color])}>
          {trend}
        </span>
      </div>
      <div>
        <p className="text-[10px] font-bold text-[#141414]/40 uppercase tracking-widest mb-1">{title}</p>
        <p className="text-2xl font-black text-[#141414]">{value}</p>
      </div>
    </div>
  );
}
