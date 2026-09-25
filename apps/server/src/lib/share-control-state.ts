export type ShareOperation = "publish" | "revoke" | null;

export interface ShareControlState {
  branch: "publish" | "shared";
  copyEnabled: boolean;
  publishDisabled: boolean;
  publishLabel: "publish" | "publishing";
  revokeDisabled: boolean;
  revokeLabel: "revoke" | "revoking";
}

/** Which share controls stay on screen while publish or revoke is in flight. */
export function shareControlState(input: {
  operation: ShareOperation;
  revokeSettled: boolean;
  token: string | null;
}): ShareControlState {
  if (input.operation === "publish") {
    return {
      branch: "publish",
      copyEnabled: false,
      publishDisabled: true,
      publishLabel: "publishing",
      revokeDisabled: true,
      revokeLabel: "revoke",
    };
  }
  if (input.operation === "revoke") {
    const tokenRevoked = input.revokeSettled || input.token === null;
    return {
      branch: "shared",
      copyEnabled: Boolean(input.token) && !tokenRevoked,
      publishDisabled: true,
      publishLabel: "publish",
      revokeDisabled: true,
      revokeLabel: "revoking",
    };
  }
  const shared = Boolean(input.token);
  return {
    branch: shared ? "shared" : "publish",
    copyEnabled: shared,
    publishDisabled: false,
    publishLabel: "publish",
    revokeDisabled: false,
    revokeLabel: "revoke",
  };
}
