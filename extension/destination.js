export function destinationKey(settings, localBase = "") {
  if (settings.storageMode === "cloud") {
    const endpoint = (settings.cloudUrl || "https://pinar.dev").replace(/\/+$/, "");
    return `cloud:${endpoint}`;
  }
  return localBase ? "local" : "local:unavailable";
}

export function collectionDestination(tree, collectionId) {
  for (const project of tree?.projects ?? []) {
    const collection = project.collections?.find((item) => item.id === collectionId);
    if (collection) return { collectionId: collection.id, projectId: project.id };
  }
  return null;
}

export function defaultDestination(tree) {
  for (const project of tree?.projects ?? []) {
    const protectedCollection = project.collections?.find((collection) => collection.isProtected);
    if (protectedCollection) return { collectionId: protectedCollection.id, projectId: project.id };
  }
  const project = tree?.projects?.[0];
  const collection = project?.collections?.[0];
  return project && collection ? { collectionId: collection.id, projectId: project.id } : null;
}

export function resolveDestinationPreference(tree, saved) {
  return collectionDestination(tree, saved?.collectionId) || defaultDestination(tree);
}
