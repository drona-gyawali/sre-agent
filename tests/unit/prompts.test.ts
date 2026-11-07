import { describe, expect, it } from "vitest";
import { buildIssueContextPrompt } from "@/app/lib/agent";
import type { SourceResult } from "@/app/lib/datasource/datasource.types";
import {
  formatIdentifiersForPrompt,
  normalizeIdentifiers,
} from "@/app/lib/prompt-guidelines";
import {
  buildExtractIdentifiersPrompt,
  buildReportPrompt,
} from "@/app/lib/utils";

describe("identifier prompt helpers", () => {
  it("normalizes multiple identifier values and drops nested data", () => {
    expect(
      normalizeIdentifiers({
        customerId: "C-1001",
        traceId: ["trace-1", "trace-1", "trace-2"],
        retries: 3,
        metadata: { region: "eu" },
      })
    ).toEqual({
      customerId: "C-1001",
      traceId: "trace-1, trace-2",
      retries: "3",
    });
  });

  it("guides the model when no identifiers were extracted", () => {
    const formatted = formatIdentifiersForPrompt({});

    expect(formatted).toContain("No structured identifiers were extracted");
    expect(formatted).toContain("Do not fabricate identifiers");
  });

  it("formats structured identifiers and their raw JSON", () => {
    const formatted = formatIdentifiersForPrompt({
      customerId: "C-1001",
      traceId: ["trace-1", "trace-2"],
    });

    expect(formatted).toContain("- customerId: C-1001");
    expect(formatted).toContain("- traceId: trace-1, trace-2");
    expect(formatted).toContain('"customerId":"C-1001"');
  });
});

describe("issue context prompt", () => {
  it("handles URLs, compact references, and noisy unrelated numbers", () => {
    const prompt = buildIssueContextPrompt(
      "Checkout 500 for C-1001 at https://github.com/acme/payments/issues/123"
    );

    expect(prompt).toContain("Full URLs");
    expect(prompt).toContain("acme/payments#123");
    expect(prompt).toContain("Ignore customer IDs");
    expect(prompt).toContain("return empty strings for both fields");
    expect(prompt).toContain("untrusted evidence");
    expect(prompt).toContain("https://github.com/acme/payments/issues/123");
  });
});

describe("identifier extraction prompt", () => {
  it("covers real-world identifiers and chaos rules", () => {
    const prompt = buildExtractIdentifiersPrompt(
      "Checkout 500s for C-1001, trace 4bf92f, pod api-7d9"
    );

    expect(prompt).toContain("traceId");
    expect(prompt).toContain("deploymentId");
    expect(prompt).toContain("Preserve the exact spelling");
    expect(prompt).toContain("return an array");
    expect(prompt).toContain("Return {}");
    expect(prompt).toContain("untrusted evidence");
    expect(prompt).toContain("Checkout 500s for C-1001");
  });
});

describe("diagnostic report prompt", () => {
  const sourceResults: Record<string, SourceResult> = {
    database: {
      sourceId: "database",
      sourceName: "orders",
      integrationType: "postgres",
      category: "database",
      status: "success",
      data: [{ customer_id: "C-1001", status: "failed" }],
      query: "SELECT * FROM orders WHERE customer_id = 'C-1001'",
      durationMs: 12,
    },
  };

  it("requires evidence gaps, confidence rationale, and non-fabrication", () => {
    const prompt = buildReportPrompt({
      issueNumber: "123",
      repo: "acme/payments",
      issueDescription: "Checkout errors for C-1001",
      identifiers: { customerId: "C-1001" },
      sourceResults,
    });

    expect(prompt).toContain("## Evidence Gaps");
    expect(prompt).toContain("Absence of evidence is not proof");
    expect(prompt).toContain("Never invent data");
    expect(prompt).toContain("untrusted evidence");
    expect(prompt).toContain('"customerId":"C-1001"');
    expect(prompt).toContain("Status: success (12ms)");
  });

  it("states when no data sources were selected", () => {
    const prompt = buildReportPrompt({
      issueNumber: "123",
      repo: "acme/payments",
      issueDescription: "Unknown symptom",
      identifiers: {},
      sourceResults: {},
    });

    expect(prompt).toContain(
      "No data sources were selected or enabled for this investigation."
    );
    expect(prompt).toContain("No structured identifiers were extracted");
  });
});
