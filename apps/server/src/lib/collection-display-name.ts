const PROTECTED_INBOX_NAME = "Inbox";

export function collectionDisplayName(
  collection: { isProtected: boolean; name: string },
  inboxLabel: string,
) {
  if (collection.isProtected && collection.name === PROTECTED_INBOX_NAME) return inboxLabel;
  return collection.name;
}
