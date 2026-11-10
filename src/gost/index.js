/**
 * Точка входа «оформления по ГОСТ»: размеры, реестр символов и стандартные надписи.
 */
import { createMetrics, METRICS, MM_PER_PT, DEFAULT_SPEC } from './metrics.js';
import { createSymbols } from './symbols.js';
import { TEXTS, letterId } from './texts.js';

/**
 * @param {Parameters<typeof createMetrics>[0]} [overrides]
 */
export function createGost(overrides) {
  const metrics = overrides ? createMetrics(overrides) : METRICS;
  return Object.freeze({ metrics, symbols: createSymbols(metrics), texts: TEXTS });
}

/** Оформление по умолчанию — общий неизменяемый экземпляр. */
export const GOST = createGost();

export { createMetrics, createSymbols, METRICS, MM_PER_PT, DEFAULT_SPEC, TEXTS, letterId };
