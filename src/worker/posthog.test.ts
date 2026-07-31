import { describe, expect, test } from "bun:test";
import { posthogUpstreamUrl } from "./posthog";

describe("posthogUpstreamUrl", () => {
  test("event capture goes to the ingestion host", () => {
    expect(posthogUpstreamUrl("https://progress.example.com/ph/e/?compression=gzip-js")).toBe(
      "https://us.i.posthog.com/e/?compression=gzip-js",
    );
  });

  test("lazily-loaded SDK bundles go to the assets host", () => {
    expect(posthogUpstreamUrl("https://progress.example.com/ph/static/surveys.js")).toBe(
      "https://us-assets.i.posthog.com/static/surveys.js",
    );
  });

  test("remote-config fetches keep their path and query", () => {
    expect(posthogUpstreamUrl("http://localhost:8000/ph/flags/?v=2")).toBe(
      "https://us.i.posthog.com/flags/?v=2",
    );
  });

  test("the bare prefix maps to the upstream root", () => {
    expect(posthogUpstreamUrl("https://progress.example.com/ph")).toBe("https://us.i.posthog.com/");
  });
});
