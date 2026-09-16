import { describe, expect, it } from "vitest";
import { tallerHandoff } from "../src/posapp/utils/tallerHandoff";
describe("Taller handoff location", () => {
 it("constructs only a local order route and encodes query-like order text", () => {
  expect(tallerHandoff("?taller_order=RO%2F1%3Fnext%3Dhttps%3A%2F%2Fevil.test")).toEqual({order:"RO/1?next=https://evil.test",returnUrl:"/taller/orders/RO%2F1%3Fnext%3Dhttps%3A%2F%2Fevil.test?tab=cobro"});
 });
 it("ignores missing, empty, control-character and oversized identifiers", () => {
  for (const query of ["", "?taller_order=", "?taller_order=%00", "?taller_order="+"a".repeat(141)]) expect(tallerHandoff(query)).toBeNull();
 });
});
