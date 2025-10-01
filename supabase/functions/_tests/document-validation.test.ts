import { assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";

// Document validation test suite
interface VendorDocument {
  vendorName?: string;
  quotedPrice?: number;
  currency?: string;
  items?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
  }>;
  leadTime?: number;
}

function validateVendorDocument(doc: VendorDocument): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  if (!doc.vendorName || doc.vendorName.trim() === "") {
    errors.push("Vendor name is required");
  }

  if (doc.quotedPrice === undefined || doc.quotedPrice === null) {
    errors.push("Quoted price is required");
  } else if (doc.quotedPrice < 0) {
    errors.push("Quoted price cannot be negative");
  }

  // Optional but validated if present
  if (doc.currency && doc.currency.length !== 3) {
    errors.push("Currency must be 3-letter ISO code");
  }

  if (doc.items) {
    if (!Array.isArray(doc.items)) {
      errors.push("Items must be an array");
    } else if (doc.items.length === 0) {
      errors.push("Items array cannot be empty if provided");
    } else {
      doc.items.forEach((item, index) => {
        if (!item.description) {
          errors.push(`Item ${index + 1}: description is required`);
        }
        if (typeof item.quantity !== 'number' || item.quantity <= 0) {
          errors.push(`Item ${index + 1}: quantity must be a positive number`);
        }
        if (typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
          errors.push(`Item ${index + 1}: unit price cannot be negative`);
        }
      });
    }
  }

  if (doc.leadTime !== undefined && doc.leadTime < 0) {
    errors.push("Lead time cannot be negative");
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Test cases

Deno.test("Document Validation - Valid complete document", () => {
  const doc: VendorDocument = {
    vendorName: "Acme Corp",
    quotedPrice: 10000,
    currency: "USD",
    items: [
      { description: "Widget A", quantity: 10, unitPrice: 100 }
    ],
    leadTime: 30
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, true);
  assertEquals(result.errors.length, 0);
});

Deno.test("Document Validation - Missing vendor name", () => {
  const doc: VendorDocument = {
    quotedPrice: 5000
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("Vendor name is required"), true);
});

Deno.test("Document Validation - Empty vendor name", () => {
  const doc: VendorDocument = {
    vendorName: "   ",
    quotedPrice: 5000
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
});

Deno.test("Document Validation - Missing quoted price", () => {
  const doc: VendorDocument = {
    vendorName: "Test Vendor"
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("Quoted price is required"), true);
});

Deno.test("Document Validation - Negative quoted price", () => {
  const doc: VendorDocument = {
    vendorName: "Test Vendor",
    quotedPrice: -1000
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("Quoted price cannot be negative"), true);
});

Deno.test("Document Validation - Invalid currency code", () => {
  const doc: VendorDocument = {
    vendorName: "Test Vendor",
    quotedPrice: 5000,
    currency: "US" // Should be 3 letters
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
  assertEquals(result.errors.includes("Currency must be 3-letter ISO code"), true);
});

Deno.test("Document Validation - Empty items array", () => {
  const doc: VendorDocument = {
    vendorName: "Test Vendor",
    quotedPrice: 5000,
    items: []
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
});

Deno.test("Document Validation - Item with missing description", () => {
  const doc: VendorDocument = {
    vendorName: "Test Vendor",
    quotedPrice: 5000,
    items: [
      { description: "", quantity: 10, unitPrice: 100 }
    ]
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
});

Deno.test("Document Validation - Item with zero quantity", () => {
  const doc: VendorDocument = {
    vendorName: "Test Vendor",
    quotedPrice: 5000,
    items: [
      { description: "Product", quantity: 0, unitPrice: 100 }
    ]
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
});

Deno.test("Document Validation - Item with negative unit price", () => {
  const doc: VendorDocument = {
    vendorName: "Test Vendor",
    quotedPrice: 5000,
    items: [
      { description: "Product", quantity: 5, unitPrice: -50 }
    ]
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
});

Deno.test("Document Validation - Negative lead time", () => {
  const doc: VendorDocument = {
    vendorName: "Test Vendor",
    quotedPrice: 5000,
    leadTime: -10
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
});

Deno.test("Document Validation - Multiple validation errors", () => {
  const doc: VendorDocument = {
    quotedPrice: -1000,
    currency: "X",
    items: [
      { description: "", quantity: -5, unitPrice: -100 }
    ]
  };

  const result = validateVendorDocument(doc);
  assertEquals(result.valid, false);
  assertEquals(result.errors.length > 3, true);
});
