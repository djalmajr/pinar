import type { AuthSession } from "@pinar/shared";

export interface AccountTabStateFixture {
  authError: string;
  authLoading: boolean;
  authReady: boolean;
  copiedCode: boolean;
  email: string;
  emailCode: string;
  emailCodeRequested: boolean;
  expired: boolean;
  id: string;
  label: string;
  regenerateCodeOpen: boolean;
  session: AuthSession | null;
  temporaryCode: string;
  temporaryCodeCountdown: string;
}

const MOCK_CODE = "FV8UJAZS";
const MOCK_COUNTDOWN = "4:32";
const MOCK_EMAIL = "you@example.com";
const MOCK_OTP = "482917";
const FREE_SESSION: AuthSession = {
  installationId: "inst_mock",
  kind: "installation",
  plan: "free",
};

function freeState(overrides: Partial<AccountTabStateFixture> & Pick<AccountTabStateFixture, "id" | "label">): AccountTabStateFixture {
  return {
    authError: "",
    authLoading: false,
    authReady: true,
    copiedCode: false,
    email: MOCK_EMAIL,
    emailCode: "",
    emailCodeRequested: false,
    expired: false,
    regenerateCodeOpen: false,
    session: FREE_SESSION,
    temporaryCode: "",
    temporaryCodeCountdown: "",
    ...overrides,
  };
}

function paidState(
  plan: "founder" | "pro",
  email: string,
  label: string,
): AccountTabStateFixture {
  return {
    authError: "",
    authLoading: false,
    authReady: true,
    copiedCode: false,
    email: "",
    emailCode: "",
    emailCodeRequested: false,
    expired: false,
    id: `paid-${plan}`,
    label,
    regenerateCodeOpen: false,
    session: { email, kind: "account", plan, userId: `user_${plan}` },
    temporaryCode: "",
    temporaryCodeCountdown: "",
  };
}

export const ACCOUNT_TAB_STATES: AccountTabStateFixture[] = [
  freeState({
    authReady: false,
    id: "loading",
    label: "Carregando — sessão ainda não chegou",
    session: null,
  }),
  freeState({
    id: "free-no-code",
    label: "Free — ainda sem código",
  }),
  freeState({
    authLoading: true,
    id: "free-generating",
    label: "Free — gerando código temporário",
  }),
  freeState({
    id: "free-code-ready",
    label: "DEFAULT — Free com código gerado",
    temporaryCode: MOCK_CODE,
    temporaryCodeCountdown: MOCK_COUNTDOWN,
  }),
  freeState({
    copiedCode: true,
    id: "free-copied",
    label: "Free — código copiado",
    temporaryCode: MOCK_CODE,
    temporaryCodeCountdown: MOCK_COUNTDOWN,
  }),
  freeState({
    id: "free-regenerate",
    label: "Free — confirmar gerar outro",
    regenerateCodeOpen: true,
    temporaryCode: MOCK_CODE,
    temporaryCodeCountdown: MOCK_COUNTDOWN,
  }),
  freeState({
    expired: true,
    id: "free-expired",
    label: "Free — código temporário expirado",
    temporaryCode: MOCK_CODE,
    temporaryCodeCountdown: "0:00",
  }),
  freeState({
    authLoading: true,
    id: "free-email-sending",
    label: "Free — enviando código de e-mail",
  }),
  freeState({
    emailCodeRequested: true,
    id: "free-email-sent",
    label: "Free — e-mail enviado, aguardando o código",
    temporaryCode: MOCK_CODE,
    temporaryCodeCountdown: MOCK_COUNTDOWN,
  }),
  freeState({
    emailCode: MOCK_OTP,
    emailCodeRequested: true,
    id: "free-email-filled",
    label: "Free — código de e-mail preenchido",
    temporaryCode: MOCK_CODE,
    temporaryCodeCountdown: MOCK_COUNTDOWN,
  }),
  freeState({
    authLoading: true,
    emailCode: MOCK_OTP,
    emailCodeRequested: true,
    id: "free-email-verifying",
    label: "Free — verificando o código de e-mail",
    temporaryCode: MOCK_CODE,
    temporaryCodeCountdown: MOCK_COUNTDOWN,
  }),
  freeState({
    authError: "O código é inválido ou expirou.",
    emailCode: MOCK_OTP,
    emailCodeRequested: true,
    id: "free-email-invalid",
    label: "Free — código de e-mail inválido ou expirado",
    temporaryCode: MOCK_CODE,
    temporaryCodeCountdown: MOCK_COUNTDOWN,
  }),
  freeState({
    authError: "O serviço de conta está indisponível.",
    id: "free-unavailable",
    label: "Erro — serviço de conta indisponível",
    session: null,
  }),
  paidState("pro", "ada@pinar.dev", "Paga — Pro autenticada neste navegador"),
  paidState("founder", "djalma@pinar.dev", "Paga — Founder autenticada neste navegador"),
];
