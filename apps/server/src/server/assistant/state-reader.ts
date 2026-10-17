// State reads for assistant proposals.
//
// Preparing a proposal and undoing it read the current state through this
// interface instead of the MCP read tools, which do not expose what a
// proposal needs (for example, a session's collectionId by id). Each surface
// implements it with direct reads under the same access scope as its MCP
// tools (in the Cloud, the owner and accepted collaboration the write
// handlers already check). Every read resolves to null when the entity does
// not exist or is not visible.

export interface AssistantStateReader {
  batch(id: string): Promise<{ finishedAt: string | null; id: string; label: string } | null>;
  collection(id: string): Promise<{ id: string; name: string; parentId: string | null; projectId: string; sessionCount: number } | null>;
  /** Placements in the exact shape `pinar.reorder_collections` accepts in `items`. */
  collectionPlacements(projectId: string): Promise<unknown[] | null>;
  comment(sessionId: string, pinId: string, commentId: string): Promise<{ body: string; id: string } | null>;
  pin(sessionId: string, pinId: string): Promise<{ comment: string; id: string; number: number } | null>;
  project(id: string): Promise<{ collectionCount: number; id: string; name: string } | null>;
  projectOrder(): Promise<string[]>;
  session(id: string): Promise<{ batchId: string | null; collectionId: string; id: string; pinCount: number; title: string } | null>;
  sessionOrder(collectionId: string): Promise<string[] | null>;
  /** Cloud only; the local reader returns null. */
  share(resourceType: string, resourceId: string): Promise<{ active: boolean; name: string } | null>;
}
