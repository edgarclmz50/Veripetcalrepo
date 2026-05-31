import { UncertaintyResults } from '../types';

interface UncertaintySource {
  name: string;
  value: number;
  distribution: 'rectangular' | 'normal' | 'triangular';
}

/**
 * Performs a Monte Carlo simulation to estimate expanded uncertainty.
 * @param sources List of uncertainty sources (standard uncertainty values)
 * @param iterations Number of iterations (e.g., 10000)
 * @param k Coverage factor (usually 2.0 for 95%)
 */
export function estimateUncertaintyMonteCarlo(
  sources: UncertaintySource[],
  iterations: number = 10000,
  k: number = 2.0
): UncertaintyResults {
  const samples: number[] = new Array(iterations).fill(0);

  for (let i = 0; i < iterations; i++) {
    let sumOfDeviations = 0;

    for (const source of sources) {
      let randomValue = 0;
      
      switch (source.distribution) {
        case 'normal':
          // Box-Muller transform for normal distribution
          const u1 = Math.random();
          const u2 = Math.random();
          const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
          randomValue = z * source.value;
          break;
          
        case 'rectangular':
          // Random value between -u and +u with uniform probability
          // Note: In metrology, if half-width is 'a', standard uncertainty is a/sqrt(3)
          // Here we assume 'source.value' is the standard uncertainty (a/sqrt(3))
          // So we need to re-scale it to the full range
          const halfWidth = source.value * Math.sqrt(3);
          randomValue = (Math.random() * 2 - 1) * halfWidth;
          break;
          
        case 'triangular':
          // Sum of two uniform distributions
          const t1 = Math.random();
          const t2 = Math.random();
          const halfWidthT = source.value * Math.sqrt(6);
          randomValue = (t1 + t2 - 1) * halfWidthT;
          break;
      }
      
      sumOfDeviations += randomValue;
    }
    
    samples[i] = sumOfDeviations;
  }

  // Calculate Mean and Standard Deviation (Combined Uncertainty)
  const mean = samples.reduce((a, b) => a + b, 0) / iterations;
  const variance = samples.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (iterations - 1);
  const combined = Math.sqrt(variance);
  const expanded = combined * k;

  return {
    combined,
    expanded,
    coverageFactor: k,
    iterations,
    method: 'monte_carlo',
    contributions: sources.map(s => ({
      source: s.name,
      value: s.value,
      distribution: s.distribution
    }))
  };
}

/**
 * Standard uncertainty sources for a typical pressure/temp instrument
 */
export function getStandardSources(
  resolution: number,
  accuracy: number, // inaccuracy of the instrument under test
  referenceUncertainty: number // uncertainty of the master standard
): UncertaintySource[] {
  return [
    {
      name: 'Resolución del Instrumento',
      value: resolution / (2 * Math.sqrt(3)), // Half-resolution, rectangular
      distribution: 'rectangular'
    },
    {
      name: 'Error de la Trazabilidad (Patrón)',
      value: referenceUncertainty / 2, // Assuming k=2 for the standard
      distribution: 'normal'
    },
    {
      name: 'Estabilidad de la Magnitud',
      value: (resolution * 0.5) / Math.sqrt(3),
      distribution: 'rectangular'
    }
  ];
}
