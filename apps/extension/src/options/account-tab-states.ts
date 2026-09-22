import type { AuthSession } from "@pinar/shared";

export interface AccountTabStateFixture {
  authError: string;
  authLoading: boolean;
  authReady: boolean;
  email: string;
  emailCode: string;
  emailCodeRequested: boolean;
  id: string;
  label: string;
  session: AuthSession | null;
}

const SIGNED_OUT: AccountTabStateFixture = {
  authError: "",
  authLoading: false,
  authReady: true,
  email: "you@example.com",
  emailCode: "",
  emailCodeRequested: false,
  id: "email-entry",
  label: "Sem sessão — informar e-mail",
  session: null,
};

export const ACCOUNT_TAB_STATES: AccountTabStateFixture[] = [
  { ...SIGNED_OUT, authReady: false, id: "loading", label: "Carregando sessão" },
  SIGNED_OUT,
  { ...SIGNED_OUT, authLoading: true, id: "email-sending", label: "Enviando código por e-mail" },
  { ...SIGNED_OUT, emailCodeRequested: true, id: "email-sent", label: "Aguardando código por e-mail" },
  { ...SIGNED_OUT, emailCode: "482917", emailCodeRequested: true, id: "email-filled", label: "Código preenchido" },
  { ...SIGNED_OUT, authLoading: true, emailCode: "482917", emailCodeRequested: true, id: "email-verifying", label: "Verificando código" },
  { ...SIGNED_OUT, authError: "O código é inválido ou expirou.", emailCode: "482917", emailCodeRequested: true, id: "email-invalid", label: "Código inválido" },
  { ...SIGNED_OUT, authError: "O serviço de conta está indisponível.", id: "unavailable", label: "Serviço indisponível" },
  { ...SIGNED_OUT, id: "free-account", label: "Conta Free autenticada", session: { email: "you@example.com", kind: "account", plan: "free", userId: "user_free" } },
  { ...SIGNED_OUT, id: "paid-pro", label: "Conta Pro autenticada", session: { email: "ada@pinar.dev", kind: "account", plan: "pro", userId: "user_pro" } },
];
