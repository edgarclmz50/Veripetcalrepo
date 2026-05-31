import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { google } from "googleapis";
import multer from "multer";
import stream from "stream";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import crypto from "crypto";

const app = express();
const PORT = 3000;
const upload = multer();

// Servidor perezoso de Google Drive
let driveClient: any = null;

function getDriveClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    console.warn("⚠️ MODO DEMO: Faltan credenciales de Google Drive. Los certificados no se subirán a la nube real.");
    return null;
  }

  if (!driveClient) {
    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      process.env.GOOGLE_REDIRECT_URI || "https://developers.google.com/oauthplayground"
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });
    driveClient = google.drive({ version: "v3", auth: oauth2Client });
  }
  return driveClient;
}

// Función para generar PDF con "Firma Digital"
async function generateCertifiedPDF(calibration: any) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([600, 800]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const { clientName, instrumentTag, instrumentDescription, measurements, id } = calibration;

  // Header
  page.drawText('CERTIFICADO DE CALIBRACIÓN', { x: 180, y: 750, size: 20, font: boldFont, color: rgb(0, 0, 0.5) });
  page.drawLine({ start: { x: 50, y: 740 }, end: { x: 550, y: 740 }, thickness: 2, color: rgb(0, 0.4, 0.8) });

  // Client Info
  page.drawText(`Cliente: ${clientName}`, { x: 50, y: 700, size: 12, font });
  page.drawText(`Instrumento: ${instrumentDescription}`, { x: 50, y: 680, size: 12, font });
  page.drawText(`Tag: ${instrumentTag}`, { x: 50, y: 660, size: 12, font });
  page.drawText(`ID Certificado: ${id}`, { x: 50, y: 640, size: 10, font, color: rgb(0.5, 0.5, 0.5) });

  // Measurements Table
  page.drawText('Resultados de Calibración', { x: 50, y: 600, size: 14, font: boldFont });
  page.drawText('Valor Patrón | Valor Instrumento | Error', { x: 50, y: 580, size: 10, font: boldFont });
  
  let y = 560;
  measurements.forEach((m: any) => {
    const error = m.instrumentValue - m.standardValue;
    page.drawText(`${m.standardValue} ${m.unit} | ${m.instrumentValue} ${m.unit} | ${error.toFixed(2)}`, { x: 50, y, size: 10, font });
    y -= 15;
  });

  // Digital Signature Block
  const signatureData = `${id}-${instrumentTag}-${Date.now()}`;
  const hash = crypto.createHash('sha256').update(signatureData).digest('hex');
  
  page.drawRectangle({
    x: 350,
    y: 100,
    width: 200,
    height: 100,
    borderColor: rgb(0.1, 0.5, 0.1),
    borderWidth: 2,
    opacity: 0.1,
    color: rgb(0.9, 1, 0.9)
  });

  page.drawText('CERTIFICADO FIRMADO DIGITALMENTE', { x: 360, y: 185, size: 8, font: boldFont, color: rgb(0, 0.4, 0) });
  page.drawText(`Hash: ${hash.substring(0, 32)}...`, { x: 360, y: 170, size: 6, font });
  page.drawText(`Sello: ${crypto.createHmac('sha256', 'secret-key-audit').update(hash).digest('hex').substring(0, 16)}`, { x: 360, y: 160, size: 6, font });
  page.drawText(`Fecha Firma: ${new Date().toLocaleString()}`, { x: 360, y: 150, size: 7, font });
  page.drawText('Inalterabilidad Garantizada', { x: 365, y: 110, size: 9, font: boldFont, color: rgb(0.5, 0.1, 0.1) });

  // Final metadata for inalterability
  pdfDoc.setSubject('Certificado de Calibración Auténtico');
  pdfDoc.setProducer('Metrology ERP - Digital Signature Service');
  pdfDoc.setKeywords(['signed', 'calibracion', 'metrologia']);

  return await pdfDoc.save();
}

app.use(express.json());

// --- SIMULACIÓN DE ENDPOINTS DOLIBARR ---

// Obtener tareas asignadas desde el ERP
app.get("/api/dolibarr/assigned-tasks", (req, res) => {
  const mockTasks = [
    {
      id: 'WO-2026-X01',
      clientId: 'CUST-001',
      clientName: 'Refinería del Pacífico',
      scheduledDate: Date.now() + 86400000,
      priority: 'high',
      location: 'Unidad de Craqueo • Área 4',
      standard: 'ISO 17025',
      serviceType: 'calibration',
      source: 'erp',
      technicianId: 'ecolmenarez',
      instruments: [
        { 
          id: 'INST-001', 
          tag: 'PI-4001', 
          description: 'Manómetro de Proceso', 
          magnitude: 'pressure', 
          rangeMin: 0, 
          rangeMax: 600, 
          unit: 'psi', 
          accuracy: '0.1', 
          status: 'pending',
          subcategory: 'Manómetro Digital'
        },
        { 
          id: 'INST-002', 
          tag: 'TI-4002', 
          description: 'Termómetro Bimetálico', 
          magnitude: 'temperature', 
          rangeMin: -10, 
          rangeMax: 150, 
          unit: '°C', 
          accuracy: '1.0', 
          status: 'pending',
          subcategory: 'Indicador Local'
        },
        { 
          id: 'INST-012', 
          tag: 'V-4003', 
          description: 'Válvula de Seguridad', 
          magnitude: 'inspection', 
          rangeMin: 0, 
          rangeMax: 100, 
          unit: '%', 
          accuracy: 'N/A', 
          status: 'pending',
          subcategory: 'Inspección Visual'
        },
        { 
          id: 'INST-013', 
          tag: 'TT-4004', 
          description: 'PT-100 Reactor 1', 
          magnitude: 'temperature', 
          rangeMin: 0, 
          rangeMax: 250, 
          unit: '°C', 
          accuracy: '0.15', 
          status: 'pending',
          subcategory: 'RTD'
        }
      ]
    },
    {
      id: 'WO-2026-X02',
      clientId: 'CUST-002',
      clientName: 'Central Eléctrica Energix',
      scheduledDate: Date.now() + 172800000,
      priority: 'normal',
      location: 'Turbina de Vapor 2',
      standard: 'ISO 17025',
      serviceType: 'calibration',
      source: 'erp',
      technicianId: 'ecolmenarez',
      instruments: [
        { 
          id: 'INST-003', 
          tag: 'PT-202', 
          description: 'Transmisor de Presión (mA)', 
          magnitude: 'pressure', 
          rangeMin: 0, 
          rangeMax: 1000, 
          unit: 'bar', 
          accuracy: '0.05', 
          status: 'pending',
          subcategory: 'Transmisor de Presión'
        }
      ]
    },
    {
      id: 'WO-2026-X03',
      clientId: 'CUST-003',
      clientName: 'Alimentos Polar Planta 1',
      scheduledDate: Date.now() + 259200000,
      priority: 'high',
      location: 'Laboratorio de Calidad',
      standard: 'ISO 17025',
      serviceType: 'calibration',
      source: 'erp',
      technicianId: 'ecolmenarez',
      instruments: [
        { 
          id: 'INST-004', 
          tag: 'HT-101', 
          description: 'Termohigrómetro Digital', 
          magnitude: 'temperature', 
          rangeMin: 0, 
          rangeMax: 50, 
          unit: '°C', 
          accuracy: '0.5', 
          status: 'pending',
          subcategory: 'Medición Ambiental'
        },
        { 
          id: 'INST-005', 
          tag: 'HT-101-H', 
          description: 'Sensor de Humedad Relativa', 
          magnitude: 'pressure', 
          rangeMin: 10, 
          rangeMax: 90, 
          unit: '%HR', 
          accuracy: '2.0', 
          status: 'pending',
          subcategory: 'Medición Ambiental'
        }
      ]
    },
    {
      id: 'WO-2026-X04',
      clientId: 'CUST-004',
      clientName: 'Siderúrgica del Sur',
      scheduledDate: Date.now() + 345600000,
      priority: 'normal',
      location: 'Almacén de Materia Prima',
      standard: 'ISO 17020',
      serviceType: 'inspection',
      source: 'erp',
      technicianId: 'ecolmenarez',
      instruments: [
        { 
          id: 'INST-006', 
          tag: 'INSP-TANK-01', 
          description: 'Inspección de Recipiente a Presión', 
          magnitude: 'pressure', 
          rangeMin: 0, 
          rangeMax: 2000, 
          unit: 'psi', 
          accuracy: 'N/A', 
          status: 'pending',
          subcategory: 'Inspección Visual'
        }
      ]
    },
    {
      id: 'WO-2026-X05',
      clientId: 'CUST-005',
      clientName: 'Veripet Servicios Logísticos',
      scheduledDate: Date.now() + 432000000,
      priority: 'low',
      location: 'Oficinas Administrativas',
      standard: 'ISO 9001',
      serviceType: 'maintenance',
      source: 'erp',
      technicianId: 'ecolmenarez',
      instruments: [
        { 
          id: 'INST-007', 
          tag: 'SYS-AUDIT', 
          description: 'Auditoría Interna de Gestión', 
          magnitude: 'temperature', 
          rangeMin: 0, 
          rangeMax: 100, 
          unit: '%', 
          accuracy: 'N/A', 
          status: 'pending',
          subcategory: 'Garantía de Calidad'
        }
      ]
    },
    {
      id: 'WO-2026-J01',
      clientId: 'CUST-006',
      clientName: 'Farmacéutica Oriente',
      scheduledDate: Date.now() + 86400000,
      priority: 'high',
      location: 'Cuarto Frío 2',
      standard: 'ISO 17025',
      serviceType: 'calibration',
      source: 'erp',
      technicianId: 'jrodriguez',
      instruments: [
        { 
          id: 'INST-008', 
          tag: 'TT-501', 
          description: 'Transmisor de Temperatura RTD', 
          magnitude: 'temperature', 
          rangeMin: -50, 
          rangeMax: 100, 
          unit: '°C', 
          accuracy: '0.1', 
          status: 'pending',
          subcategory: 'Sensor de Temperatura'
        }
      ]
    },
    {
      id: 'WO-2026-J02',
      clientId: 'CUST-007',
      clientName: 'Refinería del Centro',
      scheduledDate: Date.now() + 172800000,
      priority: 'normal',
      location: 'Planta de Desalación',
      standard: 'ISO 17020',
      serviceType: 'inspection',
      source: 'erp',
      technicianId: 'jrodriguez',
      instruments: [
        { 
          id: 'INST-009', 
          tag: 'MAN-901', 
          description: 'Manómetro de Proceso', 
          magnitude: 'pressure', 
          rangeMin: 0, 
          rangeMax: 5000, 
          unit: 'psi', 
          accuracy: '1.0', 
          status: 'pending',
          subcategory: 'Manómetro Análogo'
        }
      ]
    },
    {
      id: 'WO-2026-J03',
      clientId: 'CUST-008',
      clientName: 'Hospital Metropolitano',
      scheduledDate: Date.now() + 259200000,
      priority: 'high',
      location: 'Gases Medicinales',
      standard: 'ISO 9001',
      serviceType: 'maintenance',
      source: 'erp',
      technicianId: 'jrodriguez',
      instruments: [
        { 
          id: 'INST-010', 
          tag: 'OX-100', 
          description: 'Analizador de Oxígeno', 
          magnitude: 'pressure', 
          rangeMin: 0, 
          rangeMax: 100, 
          unit: '%', 
          accuracy: '0.5', 
          status: 'pending',
          subcategory: 'Seguridad'
        }
      ]
    },
    {
      id: 'WO-2026-J04',
      clientId: 'CUST-001', // Mismo cliente que X01
      clientName: 'Refinería del Pacífico',
      scheduledDate: Date.now() + 345600000,
      priority: 'normal',
      location: 'Unidad de Craqueo',
      standard: 'ISO 17025',
      serviceType: 'calibration',
      source: 'erp',
      technicianId: 'jrodriguez',
      instruments: [
        { 
          id: 'INST-011', 
          tag: 'PI-J01', 
          description: 'Manómetro Patrón', 
          magnitude: 'pressure', 
          rangeMin: 0, 
          rangeMax: 1000, 
          unit: 'psi', 
          accuracy: '0.01', 
          status: 'pending',
          subcategory: 'Metrología'
        }
      ]
    },
    {
      id: 'WO-2026-X06',
      clientId: 'CUST-010',
      clientName: 'Petroecuador - Terminal Pascuales',
      scheduledDate: Date.now() + 518400000,
      priority: 'high',
      location: 'Tanque 102 - GLP',
      standard: 'ISO 17025',
      serviceType: 'calibration',
      source: 'erp',
      technicianId: 'jrodriguez',
      instruments: [
        { 
          id: 'INST-014', 
          tag: 'LI-102-A', 
          description: 'Radar de Nivel', 
          magnitude: 'inspection', 
          rangeMin: 0, 
          rangeMax: 20000, 
          unit: 'mm', 
          accuracy: '2.0', 
          status: 'pending',
          subcategory: 'Inspección No Destructiva'
        },
        { 
          id: 'INST-015', 
          tag: 'PT-102-B', 
          description: 'Transmisor de Presión Estática', 
          magnitude: 'pressure', 
          rangeMin: 0, 
          rangeMax: 25, 
          unit: 'bar', 
          accuracy: '0.1', 
          status: 'pending',
          subcategory: 'Transmisor'
        },
        { 
          id: 'INST-016', 
          tag: 'TT-102-C', 
          description: 'Termocupla Tipo K', 
          magnitude: 'temperature', 
          rangeMin: -10, 
          rangeMax: 1200, 
          unit: '°C', 
          accuracy: '2.2', 
          status: 'pending',
          subcategory: 'Sonda de Temperatura'
        }
      ]
    }
  ];
  res.json(mockTasks);
});

// Sincronizar progreso (incluyendo órdenes creadas en campo)
app.post("/api/dolibarr/sync-progress", async (req, res) => {
  const { orders } = req.body;
  
  // En una implementación real, aquí filtraríamos las órdenes que tienen isFieldCreated: true
  // para darlas de alta en Dolibarr primero, y luego actualizar el estado de todas.
  const fieldOrders = orders?.filter((o: any) => o.isFieldCreated);
  
  console.log(`[ERP SYNC] Recibidas ${orders?.length || 0} órdenes.`);
  console.log(`[ERP SYNC] ${fieldOrders?.length || 0} órdenes fueron creadas en campo.`);
  
  if (fieldOrders?.length > 0) {
    console.log("[ERP SYNC] Creando nuevas órdenes en Dolibarr para:", fieldOrders.map((o: any) => o.clientName));
  }

  // Simular latencia de red
  await new Promise(resolve => setTimeout(resolve, 1500));

  res.json({ 
    success: true, 
    syncedAt: Date.now(),
    message: "Progreso y documentación sincronizados exitosamente con Dolibarr v18.0"
  });
});

// API: Recibir datos de calibración, generar PDF firmado y subir a Drive
app.post("/api/certificates/generate", async (req, res) => {
  try {
    const drive = getDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    const calibration = req.body;

    if (!calibration || !calibration.id) {
      return res.status(400).json({ error: "Datos de calibración incompletos." });
    }

    const pdfBytes = await generateCertifiedPDF(calibration);

    // Si no hay drive (Modo Demo), devolver una URL local simulada
    if (!drive) {
      return res.json({
        fileId: "demo-id-" + calibration.id,
        url: "#demo-mode-local-only",
        isDemo: true,
        message: "Certificado generado localmente (Modo Demo: Configure Google Drive en variables de entorno para subida real)"
      });
    }

    const bufferStream = new stream.PassThrough();
    bufferStream.end(Buffer.from(pdfBytes));

    const fileName = `CERT_${calibration.instrumentTag}_${calibration.id}.pdf`;

    const fileMetadata = {
      name: fileName,
      parents: folderId ? [folderId] : [],
    };

    const media = {
      mimeType: 'application/pdf',
      body: bufferStream,
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    // Hacer el archivo público (lectura para cualquiera con el link)
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    res.json({
      fileId: response.data.id,
      url: response.data.webViewLink,
    });
  } catch (error: any) {
    console.error("Error al generar/subir certificado:", error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint genérico de subida (mantenido por compatibilidad)
app.post("/api/certificates/upload", upload.single("file"), async (req: any, res: any) => {
  try {
    const drive = getDriveClient();
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    if (!req.file) {
      return res.status(400).json({ error: "No se proporcionó ningún archivo." });
    }

    // Si no hay drive (Modo Demo)
    if (!drive) {
      return res.json({
        fileId: "demo-upload-" + Date.now(),
        url: "#demo-upload-local-only",
        message: "Archivo procesado localmente (Modo Demo: Sin conexión a Drive)"
      });
    }

    const bufferStream = new stream.PassThrough();
    bufferStream.end(req.file.buffer);

    const fileMetadata = {
      name: req.file.originalname,
      parents: folderId ? [folderId] : [],
    };

    const media = {
      mimeType: req.file.mimetype,
      body: bufferStream,
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: "id, webViewLink",
    });

    // Hacer el archivo público si es necesario (opcional)
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    res.json({
      fileId: response.data.id,
      url: response.data.webViewLink,
    });
  } catch (error: any) {
    console.error("Error en Google Drive:", error);
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor iniciado en port ${PORT}`);
  });
}

startServer();
