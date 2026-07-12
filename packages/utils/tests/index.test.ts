import { expect, test } from "vite-plus/test";
import { normalizeTags, tagsMatch } from "../src/index.ts";

test("normalizeTags trims and dedupes case-insensitively", () => {
  expect(normalizeTags([" foo ", "bar", "Foo", "bar"])).toEqual(["foo", "bar"]);
});

test("tagsMatch compares case-insensitively", () => {
  expect(tagsMatch("Foo", "foo")).toBe(true);
  expect(tagsMatch("foo", "bar")).toBe(false);
});
