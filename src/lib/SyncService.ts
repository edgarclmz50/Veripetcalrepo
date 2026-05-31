import { db } from './db';
import { SyncOperation, CalibrationData, WorkOrder } from '../types';
import { db as firestore } from './firebase';
import { doc, setDoc, updateDoc, serverTimestamp, getDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './firebaseUtils';

class SyncService {
  private processing = false;
  private interval: any = null;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.processQueue());
      // Re-check every minute just in case the 'online' event is missed
      this.interval = setInterval(() => this.processQueue(), 60000);
    }
  }

  async enqueue(type: SyncOperation['type'], payload: any) {
    const op: SyncOperation = {
      id: crypto.randomUUID(),
      type,
      payload,
      status: 'pending',
      createdAt: Date.now(),
      attempts: 0
    };

    await db.syncQueue.put(op);
    this.processQueue();
    return op.id;
  }

  async exportAllToFirestore() {
    if (this.processing) return;
    this.processing = true;

    try {
      const [calibrations, orders, findings] = await Promise.all([
        db.calibrations.toArray(),
        db.workOrders.toArray(),
        db.findings.toArray()
      ]);

      console.log(`Starting global export: ${calibrations.length} calibrations, ${orders.length} orders, ${findings.length} findings`);

      // Sync Work Orders
      for (const order of orders) {
        try {
          await setDoc(doc(firestore, 'workOrders', order.id), {
            ...order,
            updatedAt: serverTimestamp()
          });
          await db.workOrders.update(order.id, { syncStatus: 'synced', lastSyncAt: Date.now() });
        } catch (e) {
          console.error(`Failed to export order ${order.id}`, e);
        }
      }

      // Sync Calibrations
      for (const cal of calibrations) {
        try {
          const firestoreData = {
            ...cal,
            createdAt: cal.createdAt ? new Date(cal.createdAt) : serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          await setDoc(doc(firestore, 'calibrations', cal.id), firestoreData);
          await db.calibrations.update(cal.id, { status: 'synced' as any });
        } catch (e) {
          console.error(`Failed to export calibration ${cal.id}`, e);
        }
      }

      // Sync Findings
      for (const finding of findings) {
        try {
          await setDoc(doc(firestore, 'hallazgos', finding.id), {
            ...finding,
            updatedAt: serverTimestamp()
          });
        } catch (e) {
          console.error(`Failed to export finding ${finding.id}`, e);
        }
      }

      return { success: true, count: calibrations.length + orders.length + findings.length };
    } finally {
      this.processing = false;
    }
  }

  async downloadBackup() {
    try {
      const [calibrations, orders, findings, standards] = await Promise.all([
        db.calibrations.toArray(),
        db.workOrders.toArray(),
        db.findings.toArray(),
        db.standards.toArray()
      ]);

      const data = {
        exportedAt: new Date().toISOString(),
        version: 1,
        database: {
          calibrations,
          workOrders: orders,
          findings,
          standards
        }
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `VeriPet_Backup_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return { success: true };
    } catch (err) {
      console.error("Backup failed", err);
      return { success: false };
    }
  }

  async processQueue() {
    if (this.processing || (typeof navigator !== 'undefined' && !navigator.onLine)) return;

    this.processing = true;
    try {
      const pendingOps = await db.syncQueue
        .where('status')
        .anyOf(['pending', 'failed'])
        .sortBy('createdAt');

      for (const op of pendingOps) {
        await this.syncOperation(op);
      }
    } finally {
      this.processing = false;
    }
  }

  private async syncOperation(op: SyncOperation) {
    try {
      await db.syncQueue.update(op.id, { 
        status: 'syncing', 
        lastAttemptAt: Date.now(),
        attempts: op.attempts + 1 
      });

      if (op.type === 'save_calibration') {
        const calId = op.payload.calibrationId || op.payload.id;
        const calibration = await db.calibrations.get(calId);
        if (calibration) {
          // Prepare for Firestore
          const firestoreData = {
            ...calibration,
            createdAt: calibration.createdAt ? new Date(calibration.createdAt) : serverTimestamp(),
            updatedAt: serverTimestamp()
          };
          
          try {
            await setDoc(doc(firestore, 'calibrations', calId), firestoreData);
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `calibrations/${calId}`);
          }

          // Generate certificate logic
          try {
            const response = await fetch('/api/certificates/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(calibration)
            });

            if (response.ok) {
              const result = await response.json();
              await db.calibrations.update(calId, { 
                status: 'synced' as any,
                certificateUrl: result.url,
                updatedAt: Date.now() 
              });
              // Update Firestore status too
              await updateDoc(doc(firestore, 'calibrations', calId), {
                status: 'published',
                certificateUrl: result.url,
                updatedAt: serverTimestamp()
              });
            }
          } catch (certErr) {
            console.error("Certificate generation failed:", certErr);
            // Non-blocking for the data sync itself, but we might want to retry
          }
        }
      }

      if (op.type === 'update_order') {
        const orderId = op.payload.orderId || op.payload.id;
        const order = await db.workOrders.get(orderId);
        if (order) {
          try {
            await setDoc(doc(firestore, 'workOrders', orderId), {
              ...order,
              updatedAt: serverTimestamp()
            });
            await db.workOrders.update(orderId, { syncStatus: 'synced', lastSyncAt: Date.now() });
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `workOrders/${orderId}`);
          }
        }
      }

      if (op.type === 'save_finding') {
        const findingId = op.payload.findingId || op.payload.id;
        const finding = await db.findings.get(findingId);
        if (finding) {
          try {
            await setDoc(doc(firestore, 'hallazgos', findingId), {
              ...finding,
              createdAt: finding.createdAt ? new Date(finding.createdAt) : serverTimestamp(),
              updatedAt: serverTimestamp()
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `hallazgos/${findingId}`);
          }
        }
      }

      // Success
      await db.syncQueue.update(op.id, { status: 'completed' });
      
    } catch (error: any) {
      console.error(`Sync failed for ${op.id}:`, error);
      const isPermanentError = op.attempts >= 5;
      await db.syncQueue.update(op.id, { 
        status: isPermanentError ? 'failed' : 'pending',
        error: error.message 
      });
    }
  }

  async getStatusForOrder(orderId: string) {
    const ops = await db.syncQueue
      .where('payload.orderId').equals(orderId)
      .or('payload.id').equals(orderId)
      .toArray();
    
    if (ops.length === 0) return 'synced';
    if (ops.some(o => o.status === 'syncing')) return 'syncing';
    if (ops.some(o => o.status === 'pending')) return 'pending';
    if (ops.some(o => o.status === 'failed')) return 'error';
    return 'synced';
  }
}

export const syncService = new SyncService();
