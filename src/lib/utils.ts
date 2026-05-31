import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

export function calculateOrderStatus(instruments: any[]): 'pending' | 'completed' | 'in_progress' {
  if (!instruments || instruments.length === 0) return 'pending';
  
  const total = instruments.length;
  const completedCount = instruments.filter(i => i.status !== 'pending').length;
  
  if (completedCount === 0) return 'pending';
  if (completedCount === total) return 'completed';
  return 'in_progress';
}
