export interface CheckoutActivation {
  email?: string;
  offer?: string;
  plan?: string;
}

export type CheckoutActivationError =
  | { kind: "message"; value: string }
  | { kind: "translation"; value: "success.checkoutFailed" | "success.sessionMissing" };

export type CheckoutActivationState =
  | { status: "idle" }
  | { status: "activating" }
  | { activation: CheckoutActivation; status: "active" }
  | { error: CheckoutActivationError; status: "error" };

export type CheckoutActivationAction =
  | { type: "activate" }
  | { type: "missing" }
  | { activation: CheckoutActivation; type: "succeed" }
  | { error: CheckoutActivationError; type: "fail" };

export function reduceCheckoutActivation(
  _state: CheckoutActivationState,
  action: CheckoutActivationAction,
): CheckoutActivationState {
  if (action.type === "activate") return { status: "activating" };
  if (action.type === "missing") {
    return _state.status === "idle"
      ? { error: { kind: "translation", value: "success.sessionMissing" }, status: "error" }
      : _state;
  }
  if (action.type === "succeed") return { activation: action.activation, status: "active" };
  return { error: action.error, status: "error" };
}
