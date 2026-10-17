// The thresholds and the candidate shape of the capture filing (F3.5
// contract §1), shared by the engines. choose.ts re-exports them, so
// callers outside filing/ keep importing from there.
//
// The similarity thresholds are the deployment's configuration (F3.5 §1):
// FILING_SIMILARITY_MIN and FILING_SIMILARITY_MARGIN, plain decimals in
// 0-1, read from the environment at each capture; the constants below are
// their defaults (calibrated for the appliance's embedding model).

export const FILING_TIMEOUT_MS = 3000;
export const FILING_DECISIONS_MIN = 0.7;
export const FILING_SIMILARITY_MIN = 0.7;
export const FILING_SIMILARITY_MARGIN = 0.05;
export const FILING_NONE_OPTION = "None of these";

/** The similarity thresholds of one capture, resolved from the deployment's configuration. */
export interface FilingSimilarityThresholds {
  margin: number;
  min: number;
}

/** The raw env fields that configure the similarity thresholds (F3.5 §1). */
export interface FilingThresholdEnv {
  FILING_SIMILARITY_MARGIN?: string;
  FILING_SIMILARITY_MIN?: string;
}

// A configured threshold: a plain non-negative decimal within 0-1. The
// shape is the same strict decimal the cost parsing uses, so "1e-1", ".5"
// and "1." are not thresholds.
const THRESHOLD_DECIMAL = /^\d+(\.\d+)?$/;

function thresholdValue(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === "" || !THRESHOLD_DECIMAL.test(raw)) return fallback;
  const value = Number(raw);
  return value > 1 ? fallback : value;
}

/**
 * The similarity thresholds of a deployment (F3.5 §1): FILING_SIMILARITY_MIN
 * and FILING_SIMILARITY_MARGIN, plain decimals in 0-1, read one by one from
 * `read`. An absent, blank or invalid value (not a plain decimal, outside
 * 0-1) falls back to that field's default, independently of the other
 * field. Never throws: a bad value must not break a capture.
 */
export function filingSimilarityThresholds(read: (name: string) => string | undefined): FilingSimilarityThresholds {
  return {
    margin: thresholdValue(read("FILING_SIMILARITY_MARGIN"), FILING_SIMILARITY_MARGIN),
    min: thresholdValue(read("FILING_SIMILARITY_MIN"), FILING_SIMILARITY_MIN),
  };
}

export interface FilingCandidate {
  collectionId: string;
  label: string; // "Project / Collection", unique among the candidates, up to 200 characters
  examples: string[]; // up to 3 titles of the collection's recent sessions
  lastUsedAt: string | null; // last session captured into it (ISO), for the cut
}
