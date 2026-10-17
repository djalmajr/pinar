// The thresholds and the candidate shape of the capture filing (F3.5
// contract §1), shared by the engines. choose.ts re-exports them, so
// callers outside filing/ keep importing from there.

export const FILING_TIMEOUT_MS = 3000;
export const FILING_DECISIONS_MIN = 0.7;
export const FILING_SIMILARITY_MIN = 0.55;
export const FILING_SIMILARITY_MARGIN = 0.05;
export const FILING_NONE_OPTION = "None of these";

export interface FilingCandidate {
  collectionId: string;
  label: string; // "Project / Collection", unique among the candidates, up to 200 characters
  examples: string[]; // up to 3 titles of the collection's recent sessions
  lastUsedAt: string | null; // last session captured into it (ISO), for the cut
}
