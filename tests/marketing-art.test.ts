import test from "node:test";
import assert from "node:assert/strict";
import { marketingArt } from "../src/lib/marketing-art";

test("marketing SVG escapes markup and never embeds scripts, remote images or foreignObject", () => {
  const svg = marketingArt({
    headline: '<script>alert("teste")</script> & título',
    cta: '<image href="https://evil.invalid/a" />',
  });
  assert.match(svg, /width="1080" height="1350"/);
  assert.doesNotMatch(
    svg,
    /<script|<image|foreignObject|(?:xlink:)?href="https?:/,
  );
  assert.match(svg, /&lt;/);
  assert.match(svg, /sem cobrança automática/);
});

test("long marketing headlines stay bounded and a draft label is not baked into the graphic", () => {
  const svg = marketingArt({
    headline: "Modelo editável: " + "x".repeat(120),
    cta: "Conhecer a demonstração",
  });
  assert.doesNotMatch(svg, /Modelo editável:/);
  assert(svg.includes("…") || svg.includes("xxxxx"));
  assert.equal((svg.match(/<tspan x="100"/g) ?? []).length, 5);
});
