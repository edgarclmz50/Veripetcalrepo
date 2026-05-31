/**
 * Metrological calculations for Pressure Calibration based on DKD-R 6-1
 */

// --- Air Density Calculation (CIPM-2007) ---
export class AireCIPM {
  static readonly R = 8.314472;
  static readonly Mv = 0.01801528;
  static readonly AbsZero = 273.15;

  static psvCipm(tK: number): number {
    // CIPM-2007 standard coefficients
    const A1 = -6.3431645e3;
    const A2 = 3.4077530e1;
    const A3 = -1.1340048e-2;
    const A4 = 1.2873851e-5;
    const expVal = (A4 * tK * tK) + (A3 * tK) + A2 + (A1 / tK);
    return Math.exp(expVal);
  }

  static factorF(pPa: number, tK: number): number {
    const tC = tK - 273.15;
    const alpha = 1.00062;
    const beta = 3.14 * 10 ** -8;
    const gamma = 5.6 * 10 ** -7;
    return alpha + beta * pPa + gamma * (tC ** 2);
  }

  static factorZ(pPa: number, tK: number, xv: number): number {
    const tC = tK - 273.15;
    const ma0 = 1.58123e-6, ma1 = -2.9331e-8, ma2 = 1.1043e-10;
    const mb0 = 5.707e-6, mb1 = -2.051e-8;
    const mc0 = 1.9898e-4, mc1 = -2.376e-6;
    const termAir = ma0 + ma1 * tC + ma2 * tC ** 2;
    const termWater = mb0 + mb1 * tC;
    const termMix = mc0 + mc1 * tC;
    const zCorrection = (pPa / tK) * (termAir + xv * (termWater - termAir) + xv ** 2 * termMix);
    return 1 - zCorrection;
  }

  static calcularDensidad(tC: number, pPa: number, hrPercent: number, xCo2Ppm: number = 420): number {
    const tK = tC + this.AbsZero;
    const xCo2 = xCo2Ppm * 10 ** -6;
    const psv = this.psvCipm(tK);
    const f = this.factorF(pPa, tK);
    const xv = (hrPercent / 100) * f * psv / pPa;
    const z = this.factorZ(pPa, tK, xv);
    const ma = (28.96546 + 12.011 * (xCo2 - 0.0004)) * 10 ** -3;
    const rho = (pPa * ma) / (z * this.R * tK) * (1 - xv * (1 - this.Mv / ma));
    return rho;
  }

  /**
   * Calculates air density uncertainty using GUM law of propagation.
   * @param tC Temperature in Celsius
   * @param pPa Pressure in Pascal
   * @param hrPercent Relative Humidity in %
   * @param ut Uncertainty of temperature (k=1)
   * @param up Uncertainty of pressure (k=1)
   * @param uhr Uncertainty of humidity (k=1)
   */
  static calcularIncertidumbre(
    tC: number, 
    pPa: number, 
    hrPercent: number, 
    ut: number = 0.5, 
    up: number = 10, 
    uhr: number = 3
  ): number {
    const rho = this.calcularDensidad(tC, pPa, hrPercent);
    const dt = 0.01;
    const dp = 0.1;
    const dhr = 0.1;

    // Sensitivity coefficients (Numerical)
    const ct = (this.calcularDensidad(tC + dt, pPa, hrPercent) - rho) / dt;
    const cp = (this.calcularDensidad(tC, pPa + dp, hrPercent) - rho) / dp;
    const chr = (this.calcularDensidad(tC, pPa, hrPercent + dhr) - rho) / dhr;

    // Standard formula uncertainty (CIPM-2007)
    const uForm = 0.000022 * rho;

    const uComb = Math.sqrt(
      Math.pow(ct * ut, 2) + 
      Math.pow(cp * up, 2) + 
      Math.pow(chr * uhr, 2) + 
      Math.pow(uForm, 2)
    );

    return uComb;
  }
}

// --- Unit Conversion ---
export class ConversorUnidades {
  static readonly FACTORES_KPA: Record<string, number> = {
    'kpa': 1.0,
    'pa': 0.001,
    'hpa': 0.1,
    'mpa': 1000.0,
    'psi': 6.89476,
    'bar': 100.0,
    'mbar': 0.1,
    'kgf/cm2': 98.0665,
    'mmhg': 0.133322,
    'inhg': 3.38639
  };

  static normalizar(valor: number, unidadOrigen?: string, unidadDestino: string = 'kpa'): number {
    if (!unidadOrigen) return valor;
    const uIn = unidadOrigen.toLowerCase().trim();
    const uOut = unidadDestino.toLowerCase().trim();
    
    if (uIn === uOut) return valor;

    const factorIn = this.FACTORES_KPA[uIn] || 1.0;
    const factorOut = this.FACTORES_KPA[uOut] || 1.0;

    const valorKpa = valor * factorIn;
    return valorKpa / factorOut;
  }
}

// --- Linear Regression for BFSL ---
export class AnalisisLineal {
  static calcularBFSL(pVals: number[], iVals: number[]) {
    const n = pVals.length;
    if (n < 2) return { m: 1, b: 0, r2: 0 };

    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += pVals[i];
      sumY += iVals[i];
      sumXY += pVals[i] * iVals[i];
      sumX2 += pVals[i] * pVals[i];
      sumY2 += iVals[i] * iVals[i];
    }

    const m = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const b = (sumY - m * sumX) / n;
    
    // R-squared
    const num = (n * sumXY - sumX * sumY);
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    const r2 = Math.pow(num / (den || 1e-12), 2);

    return { m, b, r2 };
  }
}

// --- Types ---
export interface CalibrationPoint {
  nominal: number;
  readingsAsc: number[];
  readingsDesc: number[];
}

export interface CalibrationResult {
  nominal: number;
  meanReading: number;
  refCorrected: number;
  pressureEquivalent?: number;
  error: number;
  hysteresis: number;
  uExp: number;
  uncertaintyComps: {
    uRep: number;
    uResInst: number;
    uPat: number;
    uHist: number;
    uZero: number;
    uAmb: number;
  };
}

// --- Calculation Sequence ---
export interface CalibrationSequence {
  secuencia: string;
  precargas: number;
  ciclosAsc: number;
  ciclosDesc: number;
  minPuntos: number;
}

export function determinarSecuencia(clase: number, norm: string = 'DKD-R 6-1'): CalibrationSequence {
  const c = Math.abs(clase);

  if (norm === 'CEM ME-017') {
    // CEM ME-017 specifies 3 complete cycles (M1-M6)
    return { secuencia: 'CEM', precargas: 3, ciclosAsc: 3, ciclosDesc: 3, minPuntos: 5 };
  }

  if (norm === 'NTE INEN 1825') {
    if (c <= 0.6) return { secuencia: 'INEN', precargas: 2, ciclosAsc: 1, ciclosDesc: 1, minPuntos: 8 };
    if (c <= 2.5) return { secuencia: 'INEN', precargas: 1, ciclosAsc: 1, ciclosDesc: 1, minPuntos: 5 };
    return { secuencia: 'INEN', precargas: 1, ciclosAsc: 1, ciclosDesc: 1, minPuntos: 3 };
  }

  // DKD-R 6-1 / PROC-TC-012
  if (c < 0.1) return { secuencia: 'A', precargas: 3, ciclosAsc: 2, ciclosDesc: 2, minPuntos: 9 };
  if (c <= 0.6) return { secuencia: 'B', precargas: 2, ciclosAsc: 2, ciclosDesc: 1, minPuntos: 9 };
  return { secuencia: 'C', precargas: 1, ciclosAsc: 1, ciclosDesc: 1, minPuntos: 5 };
}

/** @deprecated Use determinarSecuencia */
export function determinarSecuenciaDKD(clase: number) {
  return determinarSecuencia(clase, 'DKD-R 6-1');
}

export function generarPuntosCalibracion(clase: number, max: number, min: number = 0, norm: string = 'DKD-R 6-1', manualPuntos?: number): number[] {
  const span = max - min;
  const seq = determinarSecuencia(clase, norm);
  const n = manualPuntos || seq.minPuntos;

  if (min < 0 && max > 0) {
    const puntosVacio = [min, min / 2.0, 0.0];
    const nPos = Math.max(2, n - 3);
    const puntosPos = Array.from({ length: nPos }, (_, i) => max * ((i + 1) / nPos));
    return Array.from(new Set([...puntosVacio, ...puntosPos])).sort((a, b) => a - b);
  }

// --- Distribution for points ---
  const points = Array.from({ length: n }, (_, i) => min + (i * span / (Math.max(1, n - 1))));
  return points;
}

export class PressureCalibrator {
  private inst: any;
  private env: any;
  private params: any;
  private patron: any;
  private fluido: any;
  private methodology: string = 'digital';
  
  public rhoAire: number = 1.2;
  public uRhoAire: number = 0.01;
  public uZeroVal: number = 0.0;
  
  // Best Fit Straight Line parameters
  public bfsl = { m: 0, b: 0, r2: 0 };
  private configTransmisor: any = {};

  constructor(datosInst: any, equipos: any, condiciones: any, params: any) {
    this.inst = datosInst;
    this.env = condiciones;
    this.params = params;
    this.patron = equipos.presion || {};
    this.fluido = equipos.fluido || { nombre: 'Aire', densidad: 1.2, u_densidad: 0.01 };
    this.methodology = params.methodology || 'digital';
    
    this.calcularPropiedadesAire(equipos);
  }

  // Pre-calculate BFSL for transmitters before processing points
  prepareTransmitterBFSL(datos: { nominal: number, readings: number[] }[]) {
    const pVals: number[] = [];
    const iVals: number[] = [];

    datos.forEach(pt => {
      const meanI = pt.readings.reduce((a, b) => a + b, 0) / pt.readings.length;
      pVals.push(pt.nominal);
      iVals.push(meanI);
    });

    this.bfsl = AnalisisLineal.calcularBFSL(pVals, iVals);
    
    // Extract f0 (error de cero)
    const ptCero = datos.find(d => d.nominal === 0);
    if (ptCero && ptCero.readings.length > 0) {
      const lecturaInicial = ptCero.readings[0];
      const desviaciones = ptCero.readings.map(l => Math.abs(l - lecturaInicial));
      this.uZeroVal = Math.max(...desviaciones) / Math.sqrt(3);
    }
  }

  setTransmitterConfig(config: { resoDut: number, coefTempDut: number, coefTempPat: number, deltaT: number }) {
    this.configTransmisor = config;
  }

  private calcularPropiedadesAire(equipos: any) {
    const t = this.env.ambientTemp || 20;
    const pHpa = this.env.pressureAtmHpa || 1013.25;
    const hr = this.env.humidity || 50;
    const pPa = pHpa * 100;

    // Standard uncertainties (k=1)
    // Default values if no auxiliary equipment is specified
    let ut = 0.5 / Math.sqrt(3); 
    let up = 0.5 * 100 / Math.sqrt(3);
    let uhr = 3.0 / Math.sqrt(3);

    if (equipos.termo) {
      // Assuming accuracyClass is the tolerance +/-
      ut = parseFloat(equipos.termo.accuracyClass || '0.5') / Math.sqrt(3);
      uhr = parseFloat(equipos.termo.humidityAccuracy || '3') / Math.sqrt(3);
    }
    
    if (equipos.barometro) {
      up = parseFloat(equipos.barometro.accuracyClass || '0.5') * 100 / Math.sqrt(3);
    }
    
    this.rhoAire = AireCIPM.calcularDensidad(t, pPa, hr);
    this.uRhoAire = AireCIPM.calcularIncertidumbre(t, pPa, hr, ut, up, uhr);
  }

  setZeroError(lecturas: number[]) {
    if (lecturas.length < 2) {
      this.uZeroVal = 0;
      return;
    }
    const diff = Math.max(...lecturas) - Math.min(...lecturas);
    this.uZeroVal = diff / Math.sqrt(3);
  }

  private correccionAltura(): number {
    const g = this.env.gravedad || 9.77;
    const rhoFluido = this.fluido.densidad || this.rhoAire;
    const rhoEfectiva = rhoFluido - this.rhoAire;
    const deltaHM = ((this.env.altura_patron_mm || 0) - (this.env.altura_inst_mm || 0)) / 1000;
    
    const presionColumnaPa = deltaHM * rhoEfectiva * g;
    return ConversorUnidades.normalizar(presionColumnaPa, 'pa', this.inst.unidad);
  }

  private interpolarCorreccionPatron(nominal: number): number {
    const curva = this.patron.curva_calibracion || [];
    if (curva.length === 0) return 0;

    const nominalEnPatron = ConversorUnidades.normalizar(nominal, this.inst.unidad, this.patron.unidad);
    curva.sort((a: any, b: any) => a.indicacion - b.indicacion);

    let corrEnPatron = 0;
    let found = false;
    for (let i = 0; i < curva.length - 1; i++) {
      const p1 = curva[i];
      const p2 = curva[i+1];
      if (nominalEnPatron >= p1.indicacion && nominalEnPatron <= p2.indicacion) {
        const m = (p2.correccion - p1.correccion) / (p2.indicacion - p1.indicacion || 1e-9);
        corrEnPatron = p1.correccion + m * (nominalEnPatron - p1.indicacion);
        found = true;
        break;
      }
    }

    if (!found) {
      if (nominalEnPatron < curva[0].indicacion) corrEnPatron = curva[0].correccion;
      else if (nominalEnPatron > curva[curva.length - 1].indicacion) corrEnPatron = curva[curva.length - 1].correccion;
    }

    return ConversorUnidades.normalizar(corrEnPatron, this.patron.unidad, this.inst.unidad);
  }

  procesarPunto(nominal: number, asc: number[], desc: number[]): CalibrationResult | null {
    const todas = [...asc, ...desc];
    if (todas.length === 0) return null;

    const promedio = todas.reduce((a, b) => a + b, 0) / todas.length;
    const corrH = this.correccionAltura();
    
    let error = 0;
    let refCorrected = 0;
    let corrPatron = 0;

    if (this.methodology === 'analog') {
      // Caso A: Ajusto IBC (Nominal) -> Leo Patrón (Lecturas)
      // La corrección del patrón debe aplicarse a la lectura del patrón (promedio)
      corrPatron = this.interpolarCorreccionPatron(promedio);
      const patternMeanCorrected = promedio + corrPatron + corrH;
      
      // Error = Indicación IBC - Valor de Referencia
      // En este caso, la Indicación IBC es el punto ajustado (nominal)
      error = nominal - patternMeanCorrected;
      refCorrected = patternMeanCorrected;
    } else {
      // Caso B: Ajusto Patrón (Nominal) -> Leo IBC (Lecturas)
      // La corrección del patrón debe aplicarse al valor nominal ajustado en el patrón
      corrPatron = this.interpolarCorreccionPatron(nominal);
      refCorrected = nominal + corrPatron + corrH;
      
      // Error = Indicación IBC - Valor de Referencia
      // En este caso, la Indicación IBC es el promedio de lecturas
      error = promedio - refCorrected;
    }

    // Incertidumbre
    const uRep = todas.length > 1 
      ? Math.sqrt(todas.map(x => Math.pow(x - promedio, 2)).reduce((a, b) => a + b, 0) / (todas.length - 1)) / Math.sqrt(todas.length)
      : 0;

    const uResInst = (this.inst.resolucion || 0.1) / (2 * Math.sqrt(3));
    
    const resPatConv = ConversorUnidades.normalizar(this.patron.resolucion || 0.01, this.patron.unidad, this.inst.unidad);
    const uResPat = resPatConv / (2 * Math.sqrt(3));

    let uHist = 0;
    if (asc.length > 0 && desc.length > 0) {
      const promAsc = asc.reduce((a, b) => a + b, 0) / asc.length;
      const promDesc = desc.reduce((a, b) => a + b, 0) / desc.length;
      uHist = Math.abs(promAsc - promDesc) / (2 * Math.sqrt(3));
    }

    const uCertConv = ConversorUnidades.normalizar(this.patron.incertidumbre_expandida || 0, this.patron.unidad, this.inst.unidad);
    const uPatronCert = uCertConv / 2;

    const uDeriva = ConversorUnidades.normalizar(this.patron.deriva || 0, this.patron.unidad, this.inst.unidad) / Math.sqrt(3);

    // Incertidumbre por condiciones ambientales (Altura/Empuje)
    const g = this.env.gravedad || 9.80665;
    const deltaHM = ((this.env.altura_patron_mm || 0) - (this.env.altura_inst_mm || 0)) / 1000;
    const rhoFluido = this.fluido.densidad || this.rhoAire;
    const uRhoFluido = (this.fluido.u_densidad || 0.01) / 2; // de k=2 a k=1
    const rhoEff = Math.abs(rhoFluido - this.rhoAire);
    
    const ug = 0.0001; // Incertidumbre de gravedad local m/s2
    const uDH = 0.005;  // Incertidumbre de medición de altura m
    const uRhoEff = Math.sqrt(Math.pow(uRhoFluido, 2) + Math.pow(this.uRhoAire, 2));
    
    const uCorrHPa = Math.sqrt(
      Math.pow(deltaHM * g * uRhoEff, 2) + 
      Math.pow(rhoEff * g * uDH, 2) + 
      Math.pow(deltaHM * rhoEff * ug, 2)
    );
    const uAmb = ConversorUnidades.normalizar(uCorrHPa, 'pa', this.inst.unidad);

    const metodo = this.params.metodo_incertidumbre || 'GUM';
    let uComb = 0;
    let uExp = 0;

    // BFSL Specific logic for transmitters
    let sesgoBFSL = 0;
    if (this.bfsl.m !== 0 && this.params.magnitude === 'pressure_transmitter') {
      const pInd = (promedio - this.bfsl.b) / this.bfsl.m;
      sesgoBFSL = (pInd + corrH) - refCorrected;
      // Overwrite standard error with BFSL bias if requested
      error = sesgoBFSL;
    }

    if (metodo === 'Monte Carlo' || metodo === 'monte_carlo') {
      const M = 100000; // EURAMET recommendation & User request
      const samples = new Float64Array(M);
      const resInst = parseFloat(this.inst.resolucion || '0.001');
      
      for (let i = 0; i < M; i++) {
        // 1. Patrón Presión (Referencia)
        const sPatCert = this.randn() * uPatronCert;
        const sPatDeriva = (Math.random() - 0.5) * (uDeriva * 2 * Math.sqrt(3));
        const sPatRes = (Math.random() - 0.5) * (uResPat * 2 * Math.sqrt(3));
        
        // Coef Temp Patrón (si existiera config)
        const limTempPat = (this.configTransmisor.coefTempPat / 100 || 0) * nominal * (this.configTransmisor.deltaT || 1.0);
        const sPatTemp = (Math.random() - 0.5) * (limTempPat * 2);

        const pRefSim = nominal + sPatCert + sPatDeriva + sPatRes + sPatTemp;

        // 2. Sistema Eléctrico (Indicación DUT)
        const sRep = this.randn() * uRep;
        const sResInst = (Math.random() - 0.5) * (resInst);
        const sHist = (Math.random() - 0.5) * (uHist * 2 * Math.sqrt(3));
        const sZero = (Math.random() - 0.5) * (this.uZeroVal * 2 * Math.sqrt(3));
        
        // Coef Temp DUT
        const spanMa = (this.inst.outputRangeMax || 20) - (this.inst.outputRangeMin || 4);
        const limTempDut = (this.configTransmisor.coefTempDut / 100 || 0) * spanMa * (this.configTransmisor.deltaT || 1.0);
        const sDutTemp = (Math.random() - 0.5) * (limTempDut * 2);

        const iLeidaSim = promedio + sRep + sResInst + sHist + sZero + sDutTemp;

        // 3. Modelo de Medición
        const pIndSim = this.bfsl.m !== 0 
          ? (iLeidaSim - this.bfsl.b) / this.bfsl.m 
          : ConversorUnidades.normalizar(iLeidaSim, 'pa', this.inst.unidad); // Fallback
          
        samples[i] = (pIndSim + corrH) - pRefSim;
      }
      
      samples.sort();
      const qLow = samples[Math.floor(M * 0.02275)];
      const qHigh = samples[Math.floor(M * 0.97725)];
      uExp = (qHigh - qLow) / 2.0;
      uComb = uExp / 2.0;
      error = samples.reduce((a, b) => a + b, 0) / M; // Mean bias
    } else {
      // GUM Analítico
      uComb = Math.sqrt(
        Math.pow(uRep, 2) + Math.pow(uResInst, 2) + Math.pow(uResPat, 2) + 
        Math.pow(uHist, 2) + Math.pow(uPatronCert, 2) + Math.pow(uDeriva, 2) + 
        Math.pow(this.uZeroVal, 2) + Math.pow(uAmb, 2)
      );
      uExp = uComb * 2;
    }

    const pEquiv = this.bfsl.m !== 0 && this.params.magnitude === 'pressure_transmitter'
      ? (promedio - this.bfsl.b) / this.bfsl.m
      : ConversorUnidades.normalizar(promedio, 'pa', this.inst.unidad); // Fallback ideal o normalizado

    return {
      nominal,
      meanReading: promedio,
      refCorrected: refCorrected,
      pressureEquivalent: pEquiv,
      error,
      hysteresis: uHist * 2 * Math.sqrt(3),
      uExp: uExp,
      uncertaintyComps: {
        uRep,
        uResInst,
        uPat: uPatronCert,
        uHist,
        uZero: this.uZeroVal,
        uAmb
      }
    };
  }

  // Box-Muller transform for normal distribution
  private randn() {
    let u = 0, v = 0;
    while(u === 0) u = Math.random();
    while(v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }
}
