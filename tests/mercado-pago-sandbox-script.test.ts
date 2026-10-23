import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { verifySandbox } from "../scripts/verify-mercado-pago-sandbox";

const env = {
  MERCADO_PAGO_TEST_ACCESS_TOKEN: "TEST-synthetic-script-token",
  MERCADO_PAGO_TEST_COLLECTOR_ID: "123456",
  MERCADO_PAGO_SANDBOX_PAYER_EMAIL: "sandbox@example.invalid",
  MERCADO_PAGO_SANDBOX_CPF: "19119119100",
  MERCADO_PAGO_SANDBOX_NOTIFICATION_URL:
    "https://sandbox.example.invalid/api/webhooks/mercadopago",
  MERCADO_PAGO_SANDBOX_BACK_URL: "https://sandbox.example.invalid/return",
};
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function removeTestDirectory(root: string) {
  const target = resolve(root);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith("wf-mp-sandbox-"));
  await rm(target, { recursive: true, force: true });
}

test("sandbox requires TEST credentials and rejects production callbacks before any request", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    throw new Error("Should not fetch");
  };
  for (const configuration of [
    { ...env, MERCADO_PAGO_TEST_ACCESS_TOKEN: "APP_USR-not-test" },
    { ...env, MERCADO_PAGO_SANDBOX_BACK_URL: "https://webfidelize.com/planos" },
    { ...env, MERCADO_PAGO_SANDBOX_BACK_URL: "https://localhost:3000/return" },
  ])
    await assert.rejects(
      verifySandbox({
        argv: ["card/create", "--run", "guard-test", "--amount-cents", "4990"],
        env: configuration,
        fetchImpl,
        output: () => {},
      }),
    );
  assert.equal(calls, 0);
});

test("ambiguous card POST is durably recorded, redacted and never blindly retried", async () => {
  const root = await mkdtemp(join(tmpdir(), "wf-mp-sandbox-"));
  const output: string[] = [];
  let posts = 0,
    gets = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    if (init?.method === "POST") {
      posts++;
      const intent = JSON.parse(
        await readFile(join(root, "card-test", "intent.json"), "utf8"),
      );
      assert.equal(intent.mode, "test");
      assert.ok(
        JSON.parse(
          await readFile(join(root, "card-test", "submitted.json"), "utf8"),
        ),
      );
      assert.equal(
        JSON.parse(String(init.body)).external_reference,
        intent.checkoutId,
      );
      return response(
        {
          error: "bad_request",
          message: "private-email@example.com private-token",
          cause: [{ code: "2006", description: "private-cpf" }],
        },
        503,
      );
    }
    gets++;
    return response({ results: [], paging: { total: 0, offset: 0 } });
  };
  try {
    const options = {
      argv: ["card/create", "--run", "card-test", "--amount-cents", "4990"],
      env,
      artifactRoot: root,
      fetchImpl,
      output: (line: string) => output.push(line),
    };
    await assert.rejects(verifySandbox(options));
    await assert.rejects(verifySandbox(options));
    assert.equal(posts, 1);
    await verifySandbox({
      ...options,
      argv: ["inspect", "--run", "card-test"],
    });
    assert.equal(posts, 1);
    assert.equal(gets, 1);
    const contents = (
      await Promise.all(
        (await readdir(join(root, "card-test"))).map((file) =>
          readFile(join(root, "card-test", file), "utf8"),
        ),
      )
    ).join("\n");
    assert.doesNotMatch(
      contents + output.join("\n"),
      /private-email|private-token|private-cpf|19119119100|sandbox@example\.invalid|TEST-synthetic/,
    );
    assert.match(contents, /"outcome": "unknown"/);
    assert.match(contents, /2006/);
    assert.equal(JSON.parse(output.at(-1)!).retryPostAllowed, false);
  } finally {
    await removeTestDirectory(root);
  }
});

test("Pix creates only the explicit test amount and stores a safe real-response summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "wf-mp-sandbox-"));
  const output: string[] = [];
  let posts = 0;
  try {
    await verifySandbox({
      argv: ["pix/create", "--run", "pix-test", "--amount-cents", "4990"],
      env,
      artifactRoot: root,
      output: (line) => output.push(line),
      fetchImpl: async (_url, init) => {
        posts++;
        const body = JSON.parse(String(init?.body));
        assert.equal(body.transaction_amount, 49.9);
        assert.equal(
          body.payer.identification.number,
          env.MERCADO_PAGO_SANDBOX_CPF,
        );
        const intent = JSON.parse(
          await readFile(join(root, "pix-test", "intent.json"), "utf8"),
        );
        assert.equal(body.external_reference, intent.checkoutId);
        const now = new Date().toISOString();
        return response(
          {
            id: 987654,
            collector_id: 123456,
            live_mode: false,
            external_reference: intent.checkoutId,
            currency_id: "BRL",
            transaction_amount: 49.9,
            transaction_amount_refunded: 0,
            status: "pending",
            payment_method_id: "pix",
            date_last_updated: now,
            date_of_expiration: now,
            point_of_interaction: {
              transaction_data: {
                qr_code: "PRIVATE-QR-CONTENT",
                qr_code_base64:
                  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlNIAAAAASUVORK5CYII=",
              },
            },
          },
          201,
        );
      },
    });
    assert.equal(posts, 1);
    const report = JSON.parse(output.at(-1)!);
    assert.equal(report.productionAccessGranted, false);
    assert.equal(report.payment.liveMode, false);
    assert.equal(report.payment.paymentConfirmedInSandbox, false);
    assert.equal(report.payment.hasQrCode, true);
    assert.doesNotMatch(
      output.join("\n"),
      /PRIVATE|19119119100|sandbox@example\.invalid/,
    );
  } finally {
    await removeTestDirectory(root);
  }
});
