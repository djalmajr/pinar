import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DEFAULT_LOOP_METRICS_OPT_IN,
  LOOP_METRIC_FORBIDDEN_KEYS,
  LoopMetricError,
  planLoopMetricRequest,
  sanitizeLoopMetric,
} from "./loop-metrics/index.js";
import { adaptHandoffAll, HANDOFF_AGENTS } from "./handoff/index.js";
import { parseVisualCapture } from "./visual-context/index.js";
import { VISUAL_CONTEXT_FIXTURES } from "./visual-context/fixtures.js";

describe("loop metrics", () => {
  test("stays off by default and does not send when opt-in is missing", () => {
    assert.equal(DEFAULT_LOOP_METRICS_OPT_IN, false);
    assert.deepEqual(
      planLoopMetricRequest(false, [{ event: "handoff", durationMs: 40, agent: "claude" }]),
      { reason: "opt_in_off", send: false },
    );
    assert.deepEqual(
      planLoopMetricRequest(undefined, [{ event: "handoff" }]),
      { reason: "opt_in_off", send: false },
    );
  });

  test("rejects comments, URLs, selectors, screenshots and DOM before send", () => {
    const payload = {
      agent: "cursor",
      comment: "Make the CTA bolder",
      event: "handoff",
      selector: "#save",
      screenshot: "data:image/png;base64,aaa",
      url: "https://example.test/pricing",
    };
    assert.equal(
      LOOP_METRIC_FORBIDDEN_KEYS.some((key) => key in payload),
      true,
    );
    assert.throws(() => sanitizeLoopMetric(payload), (error: unknown) => (
      error instanceof LoopMetricError && error.code === "forbidden_fields"
    ));
    assert.deepEqual(
      planLoopMetricRequest(true, [payload]),
      { reason: "forbidden_fields", send: false },
    );
  });

  test("keeps only allowlisted funnel fields when opt-in is explicit", () => {
    const planned = planLoopMetricRequest(true, [{
      agent: "grok",
      degraded: true,
      durationMs: 1_200,
      event: "relocation_failed",
      locationConfidence: "unresolved",
    }]);
    assert.deepEqual(planned, {
      events: [{
        agent: "grok",
        degraded: true,
        durationMs: 1_200,
        event: "relocation_failed",
        locationConfidence: "unresolved",
      }],
      send: true,
    });
    if (planned.send) {
      const serialized = JSON.stringify(planned.events);
      assert.equal(serialized.includes("http"), false);
      assert.equal(serialized.includes("#"), false);
      assert.equal(serialized.includes("comment"), false);
    }
  });
});

describe("closed-loop handoff adapters", () => {
  test("the same capture fixture stays equivalent for every agent adapter", () => {
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
    const adapted = adaptHandoffAll(capture, "http://127.0.0.1:17373/v/cap_element_v0.md");
    assert.deepEqual(Object.keys(adapted).sort(), [...HANDOFF_AGENTS].sort());
    const comments = new Set(HANDOFF_AGENTS.map((agent) => JSON.stringify({
      captureId: adapted[agent].captureId,
      comments: adapted[agent].comments,
      pinIds: adapted[agent].pinIds,
      url: adapted[agent].url,
    })));
    assert.equal(comments.size, 1);
  });
});
