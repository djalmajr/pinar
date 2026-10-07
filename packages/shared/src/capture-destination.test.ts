import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { captureDestinationOptions, captureDestinationPath } from "./capture-destination/index.js";
import type { ProjectTree, ProjectTreeCollection, ProjectTreeProject } from "./types/index.js";

const now = "2026-10-07T00:00:00.000Z";

function collection(overrides: Partial<ProjectTreeCollection> & Pick<ProjectTreeCollection, "id">): ProjectTreeCollection {
  return {
    createdAt: now,
    isProtected: false,
    name: overrides.id,
    ownerId: "owner",
    parentId: null,
    position: 0,
    projectId: "p1",
    sessions: [],
    updatedAt: now,
    ...overrides,
  };
}

function project(overrides: Partial<ProjectTreeProject> & Pick<ProjectTreeProject, "id">): ProjectTreeProject {
  return {
    collections: [],
    createdAt: now,
    icon: "folder",
    isProtected: false,
    name: overrides.id,
    ownerId: "owner",
    position: 0,
    updatedAt: now,
    ...overrides,
  };
}

const tree: ProjectTree = {
  projects: [
    project({ id: "p2", name: "Second", position: 2 }),
    project({
      collections: [
        collection({ id: "inbox", isProtected: true, position: 0 }),
        collection({ id: "middle", parentId: "inbox", position: 1 }),
        collection({ id: "leaf", parentId: "middle", position: 2 }),
        collection({ id: "orphan", parentId: "missing", position: 3 }),
        collection({ id: "cyc-a", parentId: "cyc-b", position: 4 }),
        collection({ id: "cyc-b", parentId: "cyc-a", position: 5 }),
      ],
      id: "p1",
      name: "First",
      position: 1,
    }),
  ],
};

describe("captureDestinationOptions", () => {
  test("builds one node per project in position order with nested, orphan and cyclic collections at the top", () => {
    const options = captureDestinationOptions({
      collectionIcon: (collection) => collection.id,
      collectionLabel: (collection) => collection.name,
      tree,
    });
    assert.deepEqual(options, [
      {
        children: [
          {
            children: [
              {
                children: [{ icon: "leaf", label: "leaf", selectable: true, value: "leaf" }],
                icon: "middle",
                label: "middle",
                selectable: true,
                value: "middle",
              },
            ],
            icon: "inbox",
            label: "inbox",
            selectable: true,
            value: "inbox",
          },
          { icon: "orphan", label: "orphan", selectable: true, value: "orphan" },
          { icon: "cyc-a", label: "cyc-a", selectable: true, value: "cyc-a" },
          { icon: "cyc-b", label: "cyc-b", selectable: true, value: "cyc-b" },
        ],
        disabled: false,
        label: "First",
        selectable: false,
        value: "p1",
      },
      { children: [], disabled: true, label: "Second", selectable: false, value: "p2" },
    ]);
  });

  test("only collections are passed to collectionLabel and collectionIcon", () => {
    const labels: string[] = [];
    const icons: string[] = [];
    captureDestinationOptions({
      collectionIcon: (collection) => { icons.push(collection.id); return `icon-${collection.id}`; },
      collectionLabel: (collection) => { labels.push(collection.id); return `label-${collection.id}`; },
      tree,
    });
    assert.deepEqual([...icons].sort(), ["cyc-a", "cyc-b", "inbox", "leaf", "middle", "orphan"]);
    assert.deepEqual([...labels].sort(), ["cyc-a", "cyc-b", "inbox", "leaf", "middle", "orphan"]);
    assert.ok(!icons.includes("p1") && !icons.includes("p2"));
    assert.ok(!labels.includes("p1") && !labels.includes("p2"));
  });

  test("returns no options for an empty tree", () => {
    assert.deepEqual(captureDestinationOptions({
      collectionIcon: (collection) => collection.id,
      collectionLabel: (collection) => collection.name,
      tree: { projects: [] },
    }), []);
  });

  test("calls projectIcon once per project, puts the icon on the node, and omits it when absent", () => {
    const calls: string[] = [];
    const withIcon = captureDestinationOptions({
      collectionIcon: (collection) => `ci-${collection.id}`,
      collectionLabel: (collection) => collection.name,
      projectIcon: (project) => { calls.push(project.id); return `pi-${project.id}`; },
      tree,
    });
    assert.deepEqual(calls, ["p1", "p2"]);
    assert.equal(withIcon[0].icon, "pi-p1");
    assert.equal(withIcon[1].icon, "pi-p2");
    const withoutIcon = captureDestinationOptions({
      collectionIcon: (collection) => `ci-${collection.id}`,
      collectionLabel: (collection) => collection.name,
      tree,
    });
    assert.ok(!("icon" in withoutIcon[0]));
    assert.ok(!("icon" in withoutIcon[1]));
  });
});

describe("captureDestinationPath", () => {
  test("resolves the root-to-collection path inside the destination project", () => {
    assert.deepEqual(captureDestinationPath(tree, { collectionId: "inbox", projectId: "p1" }), ["p1", "inbox"]);
    assert.deepEqual(captureDestinationPath(tree, { collectionId: "leaf", projectId: "p1" }), ["p1", "inbox", "middle", "leaf"]);
  });

  test("keeps orphan and cyclic collections at the top, matching the options", () => {
    assert.deepEqual(captureDestinationPath(tree, { collectionId: "orphan", projectId: "p1" }), ["p1", "orphan"]);
    assert.deepEqual(captureDestinationPath(tree, { collectionId: "cyc-a", projectId: "p1" }), ["p1", "cyc-a"]);
  });

  test("returns null for a missing destination, project or collection", () => {
    assert.equal(captureDestinationPath(tree, null), null);
    assert.deepEqual(captureDestinationPath(tree, { collectionId: "ghost", projectId: "p1" }), null);
    assert.deepEqual(captureDestinationPath(tree, { collectionId: "inbox", projectId: "ghost" }), null);
  });
});
