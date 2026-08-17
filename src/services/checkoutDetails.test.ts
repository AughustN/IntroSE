import { beforeEach, describe, expect, it } from "vitest";
import { clearCheckoutDetails, loadCheckoutDetails, saveCheckoutDetails } from "./checkoutDetails";

/*
 * The buyer's details have to survive a trip to VNPay and back (UC-13 A6).
 *
 * Topping up replaces the whole document, so the checkout form unmounts. The hold survived that
 * already; the typed name, e-mail and phone did not — and `handleSubmit` refuses to run while any
 * of them is blank, so the buyer came back to their own seats and a submit button that did nothing.
 */

// `vitest.web.config.ts` runs this project in `node`, which has no Web Storage.
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  globalThis.sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
});

const details = {
  reservationId: 42,
  name: "Nguyễn Văn A",
  email: "a@example.com",
  phone: "0900000001",
  agreeTerms: true,
};

describe("checkout details across a top-up detour", () => {
  it("gives back exactly what was typed for that reservation", () => {
    saveCheckoutDetails(details);
    expect(loadCheckoutDetails(42)).toEqual(details);
  });

  it("refuses to hand one hold's details to another", () => {
    saveCheckoutDetails(details);
    // Two purchases in one tab can be for two different people. Prefilling somebody else's name
    // onto a ticket is worse than an empty field.
    expect(loadCheckoutDetails(43)).toBeNull();
  });

  it("has nothing to restore before a hold exists", () => {
    saveCheckoutDetails(details);
    expect(loadCheckoutDetails(null)).toBeNull();
  });

  it("drops the copy when the hold it belonged to goes", () => {
    saveCheckoutDetails(details);
    clearCheckoutDetails();
    expect(loadCheckoutDetails(42)).toBeNull();
  });

  it("survives a partly written record rather than throwing at the form", () => {
    store.set("tixhub_checkout_details_v1", JSON.stringify({ reservationId: 42, name: "A" }));
    expect(loadCheckoutDetails(42)).toEqual({
      reservationId: 42,
      name: "A",
      email: "",
      phone: "",
      agreeTerms: true,
    });
  });

  it("treats unreadable storage as nothing stored", () => {
    store.set("tixhub_checkout_details_v1", "{not json");
    expect(loadCheckoutDetails(42)).toBeNull();
  });
});
