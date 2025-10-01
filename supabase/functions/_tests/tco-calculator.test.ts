import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// TCO Calculator test suite
interface TCOInput {
  quotedPrice: number;
  shippingCosts?: number;
  handlingFees?: number;
  riskScore?: number;
  leadTime?: number;
}

function calculateTCO(input: TCOInput): number {
  const {
    quotedPrice,
    shippingCosts = 0,
    handlingFees = 0,
    riskScore = 0,
    leadTime = 0
  } = input;

  // Base calculation
  let tco = quotedPrice + shippingCosts + handlingFees;

  // Risk premium (0-10% based on risk score)
  const riskPremium = (quotedPrice * riskScore) / 1000;
  tco += riskPremium;

  // Lead time cost (longer lead time = higher cost)
  const leadTimeCost = (quotedPrice * leadTime) / 1000;
  tco += leadTimeCost;

  return Math.round(tco * 100) / 100; // Round to 2 decimals
}

Deno.test("TCO Calculator - Basic calculation with quoted price only", () => {
  const result = calculateTCO({ quotedPrice: 10000 });
  assertEquals(result, 10000);
});

Deno.test("TCO Calculator - With all cost components", () => {
  const result = calculateTCO({
    quotedPrice: 10000,
    shippingCosts: 500,
    handlingFees: 200,
    riskScore: 50,
    leadTime: 30
  });
  
  // 10000 + 500 + 200 + (10000 * 50 / 1000) + (10000 * 30 / 1000)
  // = 10000 + 500 + 200 + 500 + 300 = 11500
  assertEquals(result, 11500);
});

Deno.test("TCO Calculator - High risk scenario", () => {
  const result = calculateTCO({
    quotedPrice: 50000,
    riskScore: 80
  });
  
  // 50000 + (50000 * 80 / 1000) = 50000 + 4000 = 54000
  assertEquals(result, 54000);
});

Deno.test("TCO Calculator - Zero cost edge case", () => {
  const result = calculateTCO({ quotedPrice: 0 });
  assertEquals(result, 0);
});

Deno.test("TCO Calculator - Negative values should be handled", () => {
  // In production, you'd want validation to prevent this
  const result = calculateTCO({
    quotedPrice: 10000,
    shippingCosts: -500
  });
  assertEquals(result, 9500);
});

Deno.test("TCO Calculator - Very large numbers", () => {
  const result = calculateTCO({
    quotedPrice: 1000000,
    shippingCosts: 50000,
    riskScore: 30
  });
  
  // 1000000 + 50000 + 30000 = 1080000
  assertEquals(result, 1080000);
});

Deno.test("TCO Calculator - Decimal precision", () => {
  const result = calculateTCO({
    quotedPrice: 9999.99,
    shippingCosts: 0.01
  });
  assertEquals(result, 10000);
});

Deno.test("TCO Calculator - Low lead time scenario", () => {
  const result = calculateTCO({
    quotedPrice: 20000,
    leadTime: 5
  });
  
  // 20000 + (20000 * 5 / 1000) = 20000 + 100 = 20100
  assertEquals(result, 20100);
});

Deno.test("TCO Calculator - Combined risk and lead time", () => {
  const result = calculateTCO({
    quotedPrice: 15000,
    riskScore: 60,
    leadTime: 45
  });
  
  // 15000 + (15000 * 60 / 1000) + (15000 * 45 / 1000)
  // = 15000 + 900 + 675 = 16575
  assertEquals(result, 16575);
});

Deno.test("TCO Calculator - Minimum viable vendor", () => {
  const result = calculateTCO({
    quotedPrice: 5000,
    shippingCosts: 100,
    handlingFees: 50,
    riskScore: 10,
    leadTime: 7
  });
  
  // 5000 + 100 + 50 + 50 + 35 = 5235
  assertEquals(result, 5235);
});
