import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { HardHat, LayoutDashboard, Database, LogOut, Settings, Calendar, ClipboardList, TrendingUp, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { motion } from 'motion/react';
import { getAuthUser, logout } from '../lib/auth';

export function Layout() {
  const navigate = useNavigate();
  const user = getAuthUser();
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (!user) {
      navigate('/login');
    }
  }, [user, navigate]);

  return (
    <div className="flex min-h-screen bg-[#F5F5F0]">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isCollapsed ? 80 : 256 }}
        className="border-r border-[#141414]/10 bg-white shadow-sm flex flex-col relative z-20"
      >
        <div className={cn(
          "p-6 border-b border-[#141414]/10 flex items-center h-24 relative",
          isCollapsed ? "justify-center" : "justify-between"
        )}>
          {!isCollapsed && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="overflow-hidden whitespace-nowrap"
            >
              <h1 className="font-sans font-bold text-xl tracking-tight text-[#141414]">VeriPet</h1>
              <p className="text-[10px] uppercase tracking-widest text-[#141414]/50 font-medium mt-1">Metrología Integral</p>
            </motion.div>
          )}
          {isCollapsed && (
            <div className="w-10 h-10 rounded-xl bg-[#141414] text-white flex items-center justify-center font-black text-xl shrink-0">
              V
            </div>
          )}
          
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              "p-2 hover:bg-[#141414]/5 rounded-xl transition-all text-[#141414]/40 absolute top-1/2 -translate-y-1/2",
              isCollapsed ? "right-1" : "right-4"
            )}
            title={isCollapsed ? "Expandir" : "Colapsar"}
          >
            {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <div className="p-4">
          <button 
            onClick={() => navigate('/ordenes/nueva')}
            className={cn(
              "w-full bg-blue-600 hover:bg-blue-700 text-white flex items-center justify-center gap-2 rounded-xl h-12 transition-all shadow-lg shadow-blue-500/20",
              isCollapsed ? "px-0" : "px-4"
            )}
            title="Nueva Orden"
          >
            <Plus className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span className="font-black text-[10px] uppercase tracking-widest">Nueva de Orden</span>}
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <NavItem to="/ordenes" icon={<Calendar className="w-4 h-4" />} label="Mis Órdenes" isCollapsed={isCollapsed} />
          <NavItem to="/historial" icon={<Database className="w-4 h-4" />} label="Historial" isCollapsed={isCollapsed} />
          <NavItem to="/ejecuciones" icon={<ClipboardList className="w-4 h-4" />} label="Ejecuciones" isCollapsed={isCollapsed} />
          <NavItem to="/rendimiento" icon={<TrendingUp className="w-4 h-4" />} label="Rendimiento" isCollapsed={isCollapsed} />
          <NavItem to="/campo" icon={<HardHat className="w-4 h-4" />} label="Ejecuciones de Campo" isCollapsed={isCollapsed} />
          {user?.role === 'admin' && (
            <NavItem to="/admin" icon={<LayoutDashboard className="w-4 h-4" />} label="Administración" isCollapsed={isCollapsed} />
          )}
        </nav>

        <div className="p-4 border-t border-[#141414]/10">
          {!isCollapsed && (
            <button 
              onClick={logout}
              className="flex items-center gap-3 w-full p-3 text-red-600 hover:bg-red-50 rounded-xl transition-all"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-[10px] font-black uppercase tracking-widest">Salir</span>
            </button>
          )}
          {isCollapsed && (
            <button 
              onClick={logout}
              className="flex items-center justify-center w-full p-3 text-red-600 hover:bg-red-50 rounded-xl transition-all"
              title="Cerrar Sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          )}
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className="h-16 border-b border-[#141414]/10 bg-white/80 backdrop-blur-md px-8 flex items-center justify-between sticky top-0 z-10">
          <div className="text-sm font-medium text-[#141414]/60">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Sincronización: <span className="text-emerald-600 font-bold">Online</span>
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] font-black uppercase tracking-widest text-[#141414]">{user?.name || 'Invitado'}</p>
              <p className="text-[8px] font-bold text-[#141414]/40 uppercase tracking-widest">{user?.email || 'desconocido'}</p>
            </div>
            <button className="p-2 hover:bg-[#141414]/5 rounded-full transition-all">
              <Settings className="w-5 h-5 text-[#141414]/60" />
            </button>
            <div className="h-10 w-10 rounded-2xl bg-[#141414] text-white flex items-center justify-center text-xs font-black shadow-lg uppercase">
              {user?.name?.split(' ').map(n => n[0]).join('').substring(0, 2) || '??'}
            </div>
          </div>
        </header>
        
        <div className="p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavItem({ to, icon, label, isCollapsed }: { to: string; icon: React.ReactNode; label: string; isCollapsed: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        "flex items-center gap-3 p-3 rounded-xl transition-all text-sm font-medium h-12",
        isActive 
          ? "bg-[#141414] text-white shadow-lg" 
          : "text-[#141414]/60 hover:text-[#141414] hover:bg-[#141414]/5",
        isCollapsed && "justify-center px-0"
      )}
      title={isCollapsed ? label : undefined}
    >
      <div className="shrink-0">{icon}</div>
      {!isCollapsed && (
        <motion.span 
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="text-[10px] font-black uppercase tracking-widest whitespace-nowrap overflow-hidden"
        >
          {label}
        </motion.span>
      )}
    </NavLink>
  );
}
