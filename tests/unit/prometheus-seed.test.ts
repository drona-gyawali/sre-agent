import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const metrics = readFileSync(
  new URL("../../seed/prometheus/metrics.txt", import.meta.url),
  "utf8"
);

describe("Prometheus dev seed", () => {
  it("uses the same error_code label as the other payment metrics", () => {
    expect(metrics).toContain(
      'checkout_errors_total{service="checkout",error_code="card_declined"} 12'
    );
    expect(metrics).not.toMatch(/checkout_errors_total\{[^}]*\bcode="/);
  });
});
