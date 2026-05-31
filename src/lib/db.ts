import Dexie, { Table } from 'dexie';
import { CalibrationData, WorkOrder, SyncOperation } from '../types';

export class MetrologyDatabase extends Dexie {
  calibrations!: Table<CalibrationData>;
  workOrders!: Table<WorkOrder>;
  syncQueue!: Table<SyncOperation>;
  standards!: Table<any>;
  findings!: Table<any>;

  constructor() {
    super('MetrologyDB');
    this.version(7).stores({
      calibrations: 'id, workOrderId, instrumentId, instrumentTag, clientName, status, updatedAt',
      workOrders: 'id, scheduledDate, instrumentTag',
      syncQueue: 'id, status, type, createdAt, payload.orderId, payload.id',
      standards: 'id, alias, type',
      findings: 'id, orderId, instrumentId, technicianId'
    });
  }
}

export const db = new MetrologyDatabase();
