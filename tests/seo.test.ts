import test from "node:test";
import assert from "node:assert/strict";
import { resolveSite, siteMap, siteRobots } from "../src/lib/seo";

test("local, preview and invalid origins never become indexable", () => {
  for (const raw of [
    undefined,
    "not a url",
    "javascript:alert(1)",
    "https://localhost",
    "https://127.0.0.1",
    "https://10.1.2.3",
    "https://demo.invalid",
    "https://user:secret@example.com",
  ]) {
    const config = resolveSite(raw);
    assert.equal(config.indexable, false);
    assert.deepEqual(siteMap(config), []);
    assert.deepEqual(siteRobots(config).rules, {
      userAgent: "*",
      disallow: "/",
    });
    assert.equal(config.url.username, "");
  }
  assert.equal(
    resolveSite("https://www.example.com", "preview").indexable,
    false,
  );
  assert.equal(
    resolveSite("https://www.example.com", "development").indexable,
    false,
  );
});

test("production sitemap includes only canonical commercial home, never private or demo pages", () => {
  const config = resolveSite(
    "https://www.example.com/path?ref=private#fragment",
    "production",
  );
  assert.equal(config.indexable, true);
  assert.equal(config.url.href, "https://www.example.com/");
  assert.deepEqual(
    siteMap(config).map((page) => page.url),
    ["https://www.example.com/"],
  );
  assert.equal(
    siteRobots(config).sitemap,
    "https://www.example.com/sitemap.xml",
  );
  const rules = siteRobots(config).rules;
  assert.ok(!Array.isArray(rules));
  assert.ok(rules.disallow?.includes("/painel"));
  assert.ok(rules.disallow?.includes("/agendar/"));
});
