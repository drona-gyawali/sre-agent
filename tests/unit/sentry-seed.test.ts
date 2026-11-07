import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const seed = JSON.parse(
  readFileSync(new URL("../../seed/sentry/data.json", import.meta.url), "utf8")
) as {
  organization: { slug: string };
  projects: Array<{ id: string; slug: string }>;
  issues: Array<{
    id: string;
    shortId: string;
    status: string;
    project: { slug: string };
    tags?: Record<string, string>;
  }>;
};

describe("Sentry dev seed", () => {
  it("defines the local organization and projects", () => {
    expect(seed.organization.slug).toBe("acme");
    expect(seed.projects.map((project) => project.slug)).toEqual([
      "payments",
      "checkout",
    ]);
  });

  it("defines seeded issues for the demo incident identifiers", () => {
    expect(seed.issues.map((issue) => issue.shortId)).toEqual(
      expect.arrayContaining(["PAY-1", "PAY-2", "CHK-1", "PAY-0"])
    );

    const pay1 = seed.issues.find((issue) => issue.shortId === "PAY-1");

    expect(pay1).toMatchObject({
      status: "unresolved",
      project: { slug: "payments" },
      tags: {
        service: "checkout",
        error_code: "card_declined",
      },
    });
  });
});
