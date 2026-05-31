import { db } from './db';

export async function seedStandards() {
  const count = await db.standards.count();
  if (count > 0) return;

  const initialStandards = [
    {
      id: 'STD-001',
      alias: 'Manómetro Patrón Fluke 2700G',
      tipo: 'manometro',
      unidad: 'psi',
      resolucion: 0.001,
      incertidumbre_expandida: 0.005,
      deriva: 0.002,
      rango_max: 300,
      curva_calibracion: [
        { indicacion: 0, correccion: 0 },
        { indicacion: 100, correccion: 0.01 },
        { indicacion: 200, correccion: -0.01 },
        { indicacion: 300, correccion: 0 }
      ]
    },
    {
      id: 'STD-002',
      alias: 'Balanza de Pesos Muertos DH-Budenberg',
      tipo: 'manometro',
      unidad: 'bar',
      resolucion: 0.0001,
      incertidumbre_expandida: 0.0005,
      deriva: 0.0001,
      rango_max: 600,
      curva_calibracion: [
        { indicacion: 0, correccion: 0 },
        { indicacion: 300, correccion: 0.05 },
        { indicacion: 600, correccion: 0.08 }
      ]
    },
    {
       id: 'ENV-001',
       alias: 'Thermohygrometer Testo 608-H1',
       tipo: 'termo',
       incertidumbre_temp: 0.5,
       incertidumbre_hr: 3.0
    },
    {
       id: 'BAR-001',
       alias: 'Barometer Vaisala PTB110',
       tipo: 'baro',
       incertidumbre_hpa: 0.3
    }
  ];

  await db.standards.bulkPut(initialStandards);
  console.log('Standards seeded successfully');
}
