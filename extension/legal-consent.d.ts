export interface LegalBundle {
  acceptableUseUrl: string;
  privacyUrl: string;
  termsUrl: string;
  version: string;
}

export interface RemoteLegalAcceptance {
  acceptableUseVersion: string;
  accepted: true;
  acceptedAt?: string;
  locale: "en" | "pt";
  privacyVersion: string;
  termsVersion: string;
}

export function acceptedRemoteLegalAcceptance(
  value: unknown,
  bundle: LegalBundle | null,
): RemoteLegalAcceptance | null;
export function createRemoteLegalAcceptance(
  bundle: LegalBundle | null,
  language: string,
  acceptedAt?: string,
): RemoteLegalAcceptance | null;
export function parseLegalBundle(value: unknown): LegalBundle | null;
