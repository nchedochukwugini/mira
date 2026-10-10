import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("./composer-state.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const state = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);

test("Composer disabled state is a deterministic boolean for server and client inputs", () => {
  for (const [value, loading, expected] of [["", false, true], ["   ", false, true], ["Bitcoin", false, false], ["Bitcoin", true, true]]) {
    const server = state.isComposerSendDisabled(value, loading);
    const client = state.isComposerSendDisabled(value, loading);
    assert.equal(typeof server, "boolean");
    assert.equal(server, client);
    assert.equal(server, expected);
  }
  assert.equal(state.isComposerSendDisabled("retry", false), false, "a failed request returns to an enabled state when input is preserved");
});
