import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findCascaderPath, isCascaderSelectable, searchCascaderPaths, truncateCascaderPath, type CascaderOption } from "./cascader-model";

const tree: CascaderOption[] = [
  {
    children: [
      {
        children: [
          { label: "Filha", value: "filha" },
          { label: "Ação", value: "acao" },
        ],
        label: "Coleções",
        selectable: true,
        value: "colecoes",
      },
      {
        children: [{ label: "Espectro", value: "espectro" }],
        disabled: true,
        label: "Ghost",
        value: "ghost",
      },
    ],
    label: "Personal",
    value: "personal",
  },
  {
    children: [{ label: "Projeto X", value: "projeto-x" }],
    label: "Projetos",
    value: "projetos",
  },
  { label: "Acme", value: "acme" },
];

describe("cascader isCascaderSelectable", () => {
  test("leaf without selectable flag is selectable", () => {
    assert.equal(isCascaderSelectable({ label: "Acme", value: "acme" }), true);
  });

  test("node with children and no selectable flag is not selectable", () => {
    assert.equal(
      isCascaderSelectable({ children: [{ label: "Filha", value: "filha" }], label: "Personal", value: "personal" }),
      false,
    );
  });

  test("node with children and selectable true is selectable", () => {
    assert.equal(
      isCascaderSelectable({
        children: [{ label: "Filha", value: "filha" }],
        label: "Personal",
        selectable: true,
        value: "personal",
      }),
      true,
    );
  });

  test("disabled option is not selectable even with selectable true", () => {
    assert.equal(isCascaderSelectable({ disabled: true, label: "Ghost", selectable: true, value: "ghost" }), false);
  });

  test("node with empty children is treated as a selectable leaf", () => {
    assert.equal(isCascaderSelectable({ children: [], label: "Vazio", value: "vazio" }), true);
  });
});

describe("cascader findCascaderPath", () => {
  test("finds a three-level path", () => {
    const path = findCascaderPath(tree, ["personal", "colecoes", "filha"]);
    assert.deepEqual(path?.map((option) => option.value), ["personal", "colecoes", "filha"]);
    assert.deepEqual(path?.map((option) => option.label), ["Personal", "Coleções", "Filha"]);
  });

  test("finds a single-level path", () => {
    const path = findCascaderPath(tree, ["acme"]);
    assert.deepEqual(path?.map((option) => option.value), ["acme"]);
  });

  test("returns null for null or empty value", () => {
    assert.equal(findCascaderPath(tree, null), null);
    assert.equal(findCascaderPath(tree, []), null);
  });

  test("returns null when a step does not exist", () => {
    assert.equal(findCascaderPath(tree, ["missing"]), null);
    assert.equal(findCascaderPath(tree, ["personal", "missing", "filha"]), null);
  });

  test("returns null when the value continues past a leaf", () => {
    assert.equal(findCascaderPath(tree, ["acme", "filha"]), null);
  });
});

describe("cascader truncateCascaderPath", () => {
  test("keeps a fully resolvable prefix unchanged", () => {
    assert.deepEqual(truncateCascaderPath(tree, ["personal", "colecoes", "filha"]), ["personal", "colecoes", "filha"]);
  });

  test("cuts at the first step that no longer exists", () => {
    assert.deepEqual(truncateCascaderPath(tree, ["personal", "colecoes", "missing"]), ["personal", "colecoes"]);
    assert.deepEqual(truncateCascaderPath(tree, ["missing", "personal"]), []);
  });

  test("cuts a value that continues past a leaf", () => {
    assert.deepEqual(truncateCascaderPath(tree, ["acme", "filha"]), ["acme"]);
  });

  test("empty input returns an empty prefix", () => {
    assert.deepEqual(truncateCascaderPath(tree, []), []);
  });

  test("returns an empty prefix when the options become empty", () => {
    assert.deepEqual(truncateCascaderPath([], ["personal", "colecoes"]), []);
  });
});

describe("cascader searchCascaderPaths", () => {
  test("blank query returns no paths", () => {
    assert.deepEqual(searchCascaderPaths(tree, ""), []);
    assert.deepEqual(searchCascaderPaths(tree, "   "), []);
  });

  test("matches without accents or case sensitivity", () => {
    const paths = searchCascaderPaths(tree, "acao");
    assert.deepEqual(paths.map((path) => path.map((option) => option.value)), [["personal", "colecoes", "acao"]]);
  });

  test("matches a label of any ancestor in the path", () => {
    const paths = searchCascaderPaths(tree, "projetos");
    assert.deepEqual(paths.map((path) => path.map((option) => option.value)), [["projetos", "projeto-x"]]);
  });

  test("returns paths in pre-order, parent before descendants", () => {
    const paths = searchCascaderPaths(tree, "cole");
    assert.deepEqual(
      paths.map((path) => path.map((option) => option.value)),
      [
        ["personal", "colecoes"],
        ["personal", "colecoes", "filha"],
        ["personal", "colecoes", "acao"],
      ],
    );
  });

  test("does not return a non-selectable node as a path end", () => {
    const paths = searchCascaderPaths(tree, "personal");
    assert.deepEqual(
      paths.map((path) => path.map((option) => option.value)),
      [
        ["personal", "colecoes"],
        ["personal", "colecoes", "filha"],
        ["personal", "colecoes", "acao"],
      ],
    );
    assert.ok(paths.every((path) => path.length > 1));
  });

  test("excludes disabled nodes and their descendants", () => {
    assert.deepEqual(searchCascaderPaths(tree, "ghost"), []);
    assert.deepEqual(searchCascaderPaths(tree, "espectro"), []);
  });

  test("matches a root-level leaf", () => {
    const paths = searchCascaderPaths(tree, "acme");
    assert.deepEqual(paths.map((path) => path.map((option) => option.value)), [["acme"]]);
  });
});
