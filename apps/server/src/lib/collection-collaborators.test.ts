import { describe, expect, test } from "bun:test";
import type { AccountAuthSession, InstallationAuthSession, LocalAuthSession } from "@pinar/shared";
import {
  canManageCollectionCollaborators,
  collaboratorInviteFailure,
  inviteCollectionCollaborator,
  parseCollaboratorsResponse,
  parseInvitationsResponse,
  parseSharedCollectionsResponse,
} from "./collection-collaborators";

describe("collection collaborators eligibility", () => {
  const proSession: AccountAuthSession = {
    email: "owner@example.com",
    kind: "account",
    plan: "pro",
    userId: "usr_123",
  };

  const freeSession: AccountAuthSession = {
    email: "guest@example.com",
    kind: "account",
    plan: "free",
    userId: "usr_456",
  };

  const installSession: InstallationAuthSession = {
    installationId: "inst_123",
    kind: "installation",
    plan: "free",
  };

  const localSession: LocalAuthSession = {
    kind: "local",
    plan: "free",
  };

  test("allows Pro account on Cloud runtime", () => {
    expect(canManageCollectionCollaborators(proSession, "cloud")).toBe(true);
  });

  test("blocks Free account on Cloud runtime", () => {
    expect(canManageCollectionCollaborators(freeSession, "cloud")).toBe(false);
  });

  test("blocks any account on local runtime", () => {
    expect(canManageCollectionCollaborators(proSession, "local")).toBe(false);
    expect(canManageCollectionCollaborators(freeSession, "local")).toBe(false);
  });

  test("blocks installation or local session", () => {
    expect(canManageCollectionCollaborators(installSession, "cloud")).toBe(false);
    expect(canManageCollectionCollaborators(localSession, "cloud")).toBe(false);
  });

  test("blocks null session before auth resolves", () => {
    expect(canManageCollectionCollaborators(null, "cloud")).toBe(false);
    expect(canManageCollectionCollaborators(null, "local")).toBe(false);
  });
});

describe("collaborators response parser", () => {
  test("parses valid collaborators list with pending and accepted statuses", () => {
    const raw = {
      collaborators: [
        {
          createdAt: "2026-09-25T12:00:00Z",
          email: "colleague1@example.com",
          id: "mem_1",
          status: "pending",
        },
        {
          email: "colleague2@example.com",
          membershipId: "mem_2",
          status: "accepted",
        },
      ],
      ok: true,
    };
    const parsed = parseCollaboratorsResponse(raw);
    expect(parsed).toEqual([
      {
        createdAt: "2026-09-25T12:00:00Z",
        email: "colleague1@example.com",
        id: "mem_1",
        role: undefined,
        status: "pending",
      },
      {
        createdAt: undefined,
        email: "colleague2@example.com",
        id: "mem_2",
        role: undefined,
        status: "accepted",
      },
    ]);
  });

  test("returns empty array for empty collaborators list", () => {
    expect(parseCollaboratorsResponse({ collaborators: [], ok: true })).toEqual([]);
  });

  test("returns null for malformed or non-ok responses", () => {
    expect(parseCollaboratorsResponse(null)).toBeNull();
    expect(parseCollaboratorsResponse({ error: "forbidden" })).toBeNull();
    expect(parseCollaboratorsResponse({ collaborators: "invalid", ok: true })).toBeNull();
    expect(parseCollaboratorsResponse({ ok: false })).toBeNull();
  });
});

describe("collection invitations response parser", () => {
  test("parses valid invitations list", () => {
    const raw = {
      invitations: [
        {
          collectionId: "col_100",
          collectionName: "Design System Review",
          createdAt: "2026-09-25T14:00:00Z",
          id: "inv_1",
          ownerEmail: "owner@company.com",
        },
        {
          collection_id: "col_200",
          id: "inv_2",
          invitedBy: "lead@agency.com",
          name: "Sprint Retrospective",
        },
      ],
      ok: true,
    };
    const parsed = parseInvitationsResponse(raw);
    expect(parsed).toEqual([
      {
        collectionId: "col_100",
        collectionName: "Design System Review",
        createdAt: "2026-09-25T14:00:00Z",
        id: "inv_1",
        ownerEmail: "owner@company.com",
      },
      {
        collectionId: "col_200",
        collectionName: "Sprint Retrospective",
        createdAt: undefined,
        id: "inv_2",
        ownerEmail: "lead@agency.com",
      },
    ]);
  });

  test("returns null for malformed invitations response", () => {
    expect(parseInvitationsResponse({})).toBeNull();
    expect(parseInvitationsResponse({ invitations: {}, ok: true })).toBeNull();
    expect(parseInvitationsResponse({ ok: false })).toBeNull();
  });
});

describe("shared collections response parser", () => {
  test("parses valid shared collections list", () => {
    const raw = {
      collections: [
        {
          id: "col_shared_1",
          name: "Alpha Feedback",
          ownerEmail: "designer@company.com",
          role: "reviewer",
          sessionCount: 5,
        },
        {
          id: "col_shared_2",
          name: "Beta QA",
          sessions: [{ id: "sess_1" }, { id: "sess_2" }],
        },
      ],
      ok: true,
    };
    const parsed = parseSharedCollectionsResponse(raw);
    expect(parsed).toEqual([
      {
        createdAt: undefined,
        id: "col_shared_1",
        isSuspended: false,
        name: "Alpha Feedback",
        ownerEmail: "designer@company.com",
        role: "reviewer",
        sessionCount: 5,
        status: "active",
        updatedAt: undefined,
      },
      {
        createdAt: undefined,
        id: "col_shared_2",
        isSuspended: false,
        name: "Beta QA",
        ownerEmail: undefined,
        role: "reviewer",
        sessionCount: 2,
        status: "active",
        updatedAt: undefined,
      },
    ]);
  });

  test("parses suspended status when owner loses Pro", () => {
    const raw = {
      collections: [
        {
          id: "col_suspended_1",
          name: "Old Sprint",
          status: "suspended",
        },
        {
          id: "col_suspended_2",
          name: "Lapsed Pro",
          suspended: true,
        },
        {
          id: "col_suspended_3",
          name: "Downgraded Pro",
          ownerPlan: "free",
        },
      ],
      ok: true,
    };
    const parsed = parseSharedCollectionsResponse(raw);
    expect(parsed).toEqual([
      {
        createdAt: undefined,
        id: "col_suspended_1",
        isSuspended: true,
        name: "Old Sprint",
        ownerEmail: undefined,
        role: "reviewer",
        sessionCount: undefined,
        status: "suspended",
        updatedAt: undefined,
      },
      {
        createdAt: undefined,
        id: "col_suspended_2",
        isSuspended: true,
        name: "Lapsed Pro",
        ownerEmail: undefined,
        role: "reviewer",
        sessionCount: undefined,
        status: "suspended",
        updatedAt: undefined,
      },
      {
        createdAt: undefined,
        id: "col_suspended_3",
        isSuspended: true,
        name: "Downgraded Pro",
        ownerEmail: undefined,
        role: "reviewer",
        sessionCount: undefined,
        status: "suspended",
        updatedAt: undefined,
      },
    ]);
  });

  test("returns null for non-ok or malformed response", () => {
    expect(parseSharedCollectionsResponse(null)).toBeNull();
    expect(parseSharedCollectionsResponse({ collections: null, ok: true })).toBeNull();
  });
});

describe("collaborator invite HTTP errors", () => {
  const cases = [
    { error: "Cannot invite yourself", failure: "invite_self", status: 400 },
    { error: "Collaborator already invited or accepted", failure: "invite_exists", status: 409 },
    { error: "Pro plan required to invite collaborators", failure: "invite_pro_required", status: 403 },
  ] as const;

  test("maps known status and error text, and hides every other payload", async () => {
    for (const item of cases) {
      expect(collaboratorInviteFailure(item.status, { code: "ignored", error: item.error, leak: "secret" })).toBe(item.failure);
    }
    expect(collaboratorInviteFailure(400, { error: "Valid email required" })).toBe("invite_collaborator_failed");
    expect(collaboratorInviteFailure(403, { error: "Cannot invite yourself" })).toBe("invite_collaborator_failed");
    expect(collaboratorInviteFailure(500, { error: "database password=secret" })).toBe("invite_collaborator_failed");
    expect(collaboratorInviteFailure(400, null)).toBe("invite_collaborator_failed");

    const original = globalThis.fetch;
    try {
      for (const item of cases) {
        globalThis.fetch = (async () => new Response(JSON.stringify({
          error: item.error,
          leak: "do-not-show",
        }), { status: item.status })) as typeof fetch;
        await expect(inviteCollectionCollaborator("col_1", "Teammate@Example.com")).rejects.toThrow(item.failure);
      }
      globalThis.fetch = (async () => new Response("not-json", { status: 502 })) as typeof fetch;
      await expect(inviteCollectionCollaborator("col_1", "a@b.co")).rejects.toThrow("invite_collaborator_failed");
      let sent = "";
      globalThis.fetch = (async (_input, init) => {
        sent = String(init?.body);
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }) as typeof fetch;
      await expect(inviteCollectionCollaborator("col_1", " Teammate@Example.com ")).resolves.toBeUndefined();
      expect(sent).toContain("teammate@example.com");
    } finally {
      globalThis.fetch = original;
    }
  });
});
