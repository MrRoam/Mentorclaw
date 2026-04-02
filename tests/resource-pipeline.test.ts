import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ConservativeRightsPolicy, DefaultQualityScorer, InMemorySourceRegistry, StubIngestionProvider } from "../src/resources/pipeline.ts";

describe("resource pipeline contracts", () => {
  test("registers sources and scores normalized resources", async () => {
    const registry = new InMemorySourceRegistry();
    registry.registerSource("stub", ["ingest"]);
    assert.deepEqual(registry.listSources(), [{ sourceType: "stub", capabilities: ["ingest"] }]);

    const provider = new StubIngestionProvider();
    const resource = await provider.ingest({ uri: "https://example.com/resource" });
    const scorer = new DefaultQualityScorer();
    const rights = new ConservativeRightsPolicy();

    assert.equal(scorer.score(resource), 0.5);
    assert.equal(rights.resolve(resource), "link_only");
  });
});
