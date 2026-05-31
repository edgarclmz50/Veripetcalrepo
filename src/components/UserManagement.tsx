import React, { useEffect, useState } from 'react';
import { collection, query, getDocs, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { User as UserType } from '../types';
import { User, Shield, UserCheck, Trash2, Mail, Save } from 'lucide-react';

export function UserManagement() {
  const [users, setUsers] = useState<UserType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newRole, setNewRole] = useState<string>('');

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const q = query(collection(db, 'users'));
      const snap = await getDocs(q);
      const userList = snap.docs.map(d => d.data() as UserType);
      setUsers(userList);
    } catch (err) {
      console.error("Error fetching users:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateRole = async (userId: string) => {
    try {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, { role: newRole });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole as any } : u));
      setEditingId(null);
    } catch (err) {
      alert("Error actualizando rol");
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-[#141414]/40 font-bold">Cargando usuarios...</div>;
  }

  return (
    <div className="bg-white border border-[#141414]/10 rounded-3xl overflow-hidden shadow-sm">
      <div className="p-6 border-b border-[#141414]/5 bg-[#F5F5F0]/30 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-lg text-[#141414]">Gestión de Usuarios</h3>
          <p className="text-[10px] text-[#141414]/40 uppercase tracking-widest font-black mt-0.5">Control de acceso y roles del sistema</p>
        </div>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#F5F5F0]/50 text-left border-b border-[#141414]/5">
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Usuario</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Email</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Rol</th>
              <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-[#141414]/40">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#141414]/5">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-[#F5F5F0]/30 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#141414]/5 flex items-center justify-center text-[#141414]/60">
                      <User className="w-4 h-4" />
                    </div>
                    <span className="font-bold text-sm text-[#141414]">{user.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-xs font-mono text-[#141414]/60">
                  <div className="flex items-center gap-2">
                    <Mail className="w-3 h-3" />
                    {user.email}
                  </div>
                </td>
                <td className="px-6 py-4">
                  {editingId === user.id ? (
                    <select 
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value)}
                      className="text-xs p-2 bg-white border border-[#141414]/10 rounded-lg outline-none font-bold"
                    >
                      <option value="technician text-xs">Técnico</option>
                      <option value="admin text-xs">Administrador</option>
                      <option value="client text-xs">Cliente</option>
                    </select>
                  ) : (
                    <span className={`text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${
                      user.role === 'admin' ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' :
                      user.role === 'client' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                      'bg-emerald-50 text-emerald-600 border border-emerald-100'
                    }`}>
                      {user.role}
                    </span>
                  )}
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    {editingId === user.id ? (
                      <button 
                        onClick={() => handleUpdateRole(user.id)}
                        className="p-2 hover:bg-emerald-50 text-emerald-600 rounded-lg transition-all"
                        title="Guardar"
                      >
                        <Save className="w-4 h-4" />
                      </button>
                    ) : (
                      <button 
                        onClick={() => {
                          setEditingId(user.id);
                          setNewRole(user.role);
                        }}
                        className="p-2 hover:bg-[#141414]/5 text-[#141414]/40 hover:text-[#141414] rounded-lg transition-all"
                        title="Editar Rol"
                      >
                        <Shield className="w-4 h-4" />
                      </button>
                    )}
                    {user.email !== 'edgarclmz@gmail.com' && (
                      <button 
                        onClick={async () => {
                          if (confirm('¿Eliminar usuario?')) {
                            await deleteDoc(doc(db, 'users', user.id));
                            setUsers(users.filter(u => u.id !== user.id));
                          }
                        }}
                        className="p-2 hover:bg-red-50 text-red-400 hover:text-red-600 rounded-lg transition-all"
                        title="Eliminar"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
