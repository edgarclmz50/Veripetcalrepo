export enum CalibrationStatus {
  DRAFT = 'draft',      // Local in PWA
  PRELIMINARY = 'preliminary', // Site report generated
  IN_REVIEW = 'in_review',    // Synced to backend
  PUBLISHED = 'published',     // Approved and in portal
}

export interface CalibrationMetadata {
  rangeMin: number;
  rangeMax: number;
  resolution: number;
  accuracyClass: string;
  referenceStandardId?: string;
  ambientTemp?: number;
  humidity?: number;
  subcategory?: string; 
  // Advanced pressure fields
  pressureAtmHpa?: number;
  gravity?: number;
  fluid?: string;
  fluidDensity?: number;
  heightPatternMm?: number;
  heightInstrumentMm?: number;
  uncertaintyMethod?: 'gum' | 'monte_carlo';
  inspectionVisualOk?: boolean;
  leakTestOk?: boolean;
  preloadsOk?: boolean;
}

export interface CalibrationData {
  id: string; // Internal UUID or generated
  workOrderId?: string; // Link to ERP Order
  instrumentId?: string; // ID of the specific instrument in the order
  clientName: string;
  instrumentTag: string;
  instrumentDescription: string;
  magnitude: 'pressure' | 'flow' | 'temperature' | 'pressure_transmitter' | 'other';
  measurements: Measurement[];
  metadata?: CalibrationMetadata;
  technicianId: string;
  technicianName?: string;
  technicianEmail?: string;
  createdAt: number;
  updatedAt: number;
  status: CalibrationStatus;
  qrCode?: string;
  certificateUrl?: string;
  uncertaintyResults?: UncertaintyResults;
  calibrationDate?: number;
  meanError?: number;
  history?: LogEntry[];
  notes?: string;
}

export interface UncertaintyResults {
  combined: number;
  expanded: number;
  coverageFactor: number;
  iterations: number;
  method: 'monte_carlo' | 'gum';
  contributions: {
    source: string;
    value: number;
    distribution: 'rectangular' | 'normal' | 'triangular';
  }[];
}

export interface Measurement {
  nominalValue: number; // Target point (e.g., 0, 20, 40...)
  standardValue: number;
  instrumentValue: number;
  unit: string;
  timestamp: number;
  direction?: 'ascending' | 'descending';
  outputValue?: number; // For transmitters (mA, V)
}

export interface LogEntry {
  id: string;
  timestamp: number;
  author: string;
  message: string;
  type: 'info' | 'observation' | 'system' | 'alert';
  attachments?: {
    name: string;
    type: string;
    url: string;
  }[];
}

export interface WorkOrderInstrument {
  id: string;
  tag: string;
  description: string;
  magnitude: 'pressure' | 'flow' | 'temperature' | 'pressure_transmitter' | 'other' | 'inspection' | 'quality';
  subcategory: string;
  rangeMin: number;
  rangeMax: number;
  accuracy: string;
  unit: string;
  status: 'pending' | 'completed' | 'non_calibratable';
  serviceType?: 'calibration' | 'inspection' | 'repair' | 'maintenance' | 'functional_test' | 'audit';
  standard?: 'ISO 17025' | 'ISO 17020' | 'ISO 9001' | 'Norma Interna';
  notes?: string;
  logs?: LogEntry[];
  isFieldCreated?: boolean;
}

export interface TechnicalSummary {
  workPerformed: string;
  findings: string;
  recommendations: string;
  updatedAt: number;
}

export interface WorkOrder {
  id: string;          // Dolibarr ID (e.g., WO-2026-001)
  clientId: string;
  clientName: string;
  scheduledDate: number;
  priority: 'high' | 'normal' | 'low';
  location: string;
  serviceType?: 'calibration' | 'inspection' | 'repair' | 'maintenance' | 'functional_test' | 'audit';
  standard?: 'ISO 17025' | 'ISO 17020' | 'ISO 9001' | 'Norma Interna';
  instruments: WorkOrderInstrument[];
  logs?: LogEntry[];
  syncStatus?: 'synced' | 'pending' | 'error';
  status?: 'pending' | 'completed' | 'in_progress';
  lastSyncAt?: number;
  updatedAt?: number;
  technicalSummary?: TechnicalSummary;
  isFieldCreated?: boolean;
  source?: 'erp' | 'field';
  technicianId?: string;
  technicianName?: string;
  technicianEmail?: string;
}

export interface SyncOperation {
  id: string;
  type: 'update_order' | 'save_calibration' | 'add_instrument' | 'remove_instrument' | 'save_finding';
  status: 'pending' | 'syncing' | 'failed' | 'completed';
  payload: any;
  createdAt: number;
  attempts: number;
  lastAttemptAt?: number;
  error?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'technician' | 'admin' | 'client';
  technicianCode?: string;
}
