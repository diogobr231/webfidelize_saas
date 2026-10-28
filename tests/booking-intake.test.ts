import assert from "node:assert/strict";
import test from "node:test";
import { bookingCopy, bookingCopyByNiche } from "../src/lib/booking-copy";
import {
  bookingIntakeSchema,
  compactBookingDetails,
  safeDeliveryLocation,
} from "../src/lib/booking-intake";

test("segment booking pages have clear, truthful copy", () => {
  for (const [niche, copy] of Object.entries(bookingCopyByNiche)) {
    assert.ok(copy.headline.length > 12, niche);
    assert.ok(copy.description.length > 20, niche);
    assert.ok(copy.servicePrompt.length > 6, niche);
  }
  assert.match(bookingCopy("restaurante").description, /mesas.*ainda não/i);
  assert.match(bookingCopy("clinica").headline, /atendimento/i);
  assert.match(bookingCopy("unknown").headline, /horário/);
});

test("booking-specific intake is bounded and omits empty values", () => {
  const parsed = bookingIntakeSchema.parse({
    delivery_location: " Rua 1, Centro ",
    pet_name: "",
    pet_species: "",
    pet_size: "",
    meeting_topic: "",
  });
  assert.deepEqual(compactBookingDetails(parsed), {
    delivery_location: "Rua 1, Centro",
  });
  assert.equal(
    bookingIntakeSchema.safeParse({
      delivery_location: "x".repeat(501),
      pet_name: "",
      pet_species: "",
      pet_size: "",
      meeting_topic: "",
    }).success,
    false,
  );
  assert.equal(
    bookingIntakeSchema.safeParse({
      delivery_location: "",
      pet_name: "",
      pet_species: "parrot",
      pet_size: "",
      meeting_topic: "",
    }).success,
    false,
  );
});

test("delivery locations allow an address or verified Google Maps URL only", () => {
  assert.equal(safeDeliveryLocation("Rua Central, 10 - Centro"), true);
  assert.equal(safeDeliveryLocation("https://maps.app.goo.gl/abc123"), true);
  assert.equal(
    safeDeliveryLocation("https://attacker.example/redirect"),
    false,
  );
  assert.equal(safeDeliveryLocation("http://maps.google.com/?q=1"), false);
});
