import assert from "node:assert/strict";
import test from "node:test";
import { jsonApiError, readJsonApiResponse, transactionNetworkError } from "./json-api-response.ts";

test("reads a successful JSON API response", async () => {
  const response = Response.json({ data: { operationId: "operation" } });
  assert.deepEqual(await readJsonApiResponse(response), { data: { operationId: "operation" } });
});

test("reads a JSON API error with a stable safe code and message", async () => {
  const response = jsonApiError("market_not_active", "This market is not active for secondary trading.", 409);
  const parseResponse = response.clone();
  assert.equal(response.status, 409);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
  assert.deepEqual(await response.json(), {
    error: { code: "market_not_active", message: "This market is not active for secondary trading." },
  });
  await assert.rejects(readJsonApiResponse(parseResponse), /not active for secondary trading/);
});

test("reports a missing API route instead of parsing its HTML 404 page", async () => {
  await assert.rejects(
    readJsonApiResponse(new Response("<!DOCTYPE html><html><body>Not found</body></html>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } })),
    /endpoint was not found \(HTTP 404\)/,
  );
});

test("reports other HTML error responses without exposing their contents", async () => {
  await assert.rejects(
    readJsonApiResponse(new Response("<!DOCTYPE html><body>internal upstream detail</body>", { status: 502, headers: { "content-type": "text/html" } })),
    (error) => error instanceof Error && /non-JSON transaction API response \(HTTP 502\)/.test(error.message) && !error.message.includes("internal upstream detail"),
  );
});

test("reports empty responses safely", async () => {
  await assert.rejects(readJsonApiResponse(new Response(null, { status: 204 })), /empty transaction API response \(HTTP 204\)/);
});

test("reports malformed JSON safely", async () => {
  await assert.rejects(
    readJsonApiResponse(new Response("{broken", { status: 200, headers: { "content-type": "application/json" } })),
    /malformed JSON from the transaction API/,
  );
});

test("maps fetch network failures to a safe no-transaction message", () => {
  assert.match(transactionNetworkError(new TypeError("socket disconnected")), /could not be reached/);
  assert.doesNotMatch(transactionNetworkError(new TypeError("socket disconnected")), /socket disconnected/);
});
