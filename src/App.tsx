import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { FieldApp } from './pages/FieldApp';
import FieldCalibrationPage from './pages/FieldCalibrationPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { Login } from './pages/Login';
import { WorkOrders } from './pages/WorkOrders';
import { OrderDetails } from './pages/OrderDetails';
import { CreateFieldOrder } from './pages/CreateFieldOrder';
import { Executions } from './pages/Executions';
import { CalibrationHistory } from './pages/CalibrationHistory';
import { Performance } from './pages/Performance';
import { Toaster } from './components/ui/Toaster';
import { subscribeToAuthChanges } from './lib/auth';
import { User } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#141414]/10 border-t-[#141414] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={!user ? <Login /> : <Navigate to="/ordenes" replace />} />
        
        <Route element={user ? <Layout /> : <Navigate to="/login" replace />}>
          <Route path="/ordenes" element={<WorkOrders />} />
          <Route path="/ordenes/nueva" element={<CreateFieldOrder />} />
          <Route path="/ordenes/:id" element={<OrderDetails />} />
          <Route path="/ejecuciones" element={<Executions />} />
          <Route path="/historial" element={<CalibrationHistory />} />
          <Route path="/rendimiento" element={<Performance />} />
          <Route path="/campo" element={<FieldApp />} />
          <Route path="/calibracion" element={<FieldCalibrationPage />} />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/" element={<Navigate to="/ordenes" replace />} />
        </Route>
      </Routes>
      <Toaster />
    </BrowserRouter>
  );
}
