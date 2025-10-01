# Edge Cases & Invalid Inputs for Document Parsing

## 1. File-Level Edge Cases

### Missing or Corrupted Files
- **Empty file** (0 bytes)
- **Truncated PDF** (incomplete file structure)
- **Corrupted PDF header** (invalid magic bytes)
- **Password-protected PDF** without password
- **Encrypted PDF** with unsupported encryption
- **PDF with corrupted internal structure** (broken xref table)
- **Non-PDF file with .pdf extension**
- **File exceeds maximum size limit** (>20MB)

### Unusual File Characteristics
- **Scanned documents** (pure images, no text layer)
- **Mixed content** (some pages scanned, some digital)
- **Very large files** (hundreds of pages)
- **Low-quality scans** (poor OCR results expected)
- **Non-standard page sizes** (extremely wide/tall)
- **Rotated pages** (90°, 180°, 270° orientations)
- **Multi-column layouts**

## 2. Content Structure Edge Cases

### Missing Required Fields
- **No vendor name** in document
- **Missing pricing information**
- **Absent delivery/lead time data**
- **No item descriptions** or quantities
- **Missing currency symbols** or indicators
- **Incomplete contact information**
- **No date or validity period**

### Ambiguous or Multiple Values
- **Multiple vendor names** mentioned (distributor vs. manufacturer)
- **Different prices** for same item (retail vs. bulk)
- **Multiple currencies** in same document
- **Conflicting dates** (quote date vs. validity date)
- **Multiple shipping options** with different costs
- **Alternative offers** (Option A vs. Option B)

### Unusual Table Formats
- **Nested tables** (tables within tables)
- **Merged cells** in critical columns
- **Split tables** across pages
- **Vertical text** in headers
- **Tables without borders** (space-separated values)
- **Multi-line cell content**
- **Tables with varying column counts** per row
- **Footnotes within tables**
- **Color-coded information** (not text-based)

## 3. Data Format Edge Cases

### Numeric Values
- **Numbers with unusual formatting**
  - `1.234.567,89` (European format)
  - `1,234,567.89` (US format)
  - `1 234 567,89` (space separators)
  - `12,34,567.89` (Indian format)
- **Scientific notation** (`1.5e6`)
- **Numbers as words** ("five thousand")
- **Ranges instead of exact values** ("$5000-$7000")
- **Missing decimal points** (ambiguous: "1234" vs "12.34")
- **Negative values** (returns, credits, discounts)
- **Zero values** (free items, no-cost services)

### Currency Handling
- **Missing currency symbols**
- **Multiple currencies** in one document
- **Obsolete currencies** (old ISO codes)
- **Cryptocurrency mentions**
- **Ambiguous symbols** ($ could be USD, CAD, AUD, etc.)
- **Currency codes vs. symbols** (USD vs. $)

### Date Formats
- **Ambiguous date formats** (02/03/2024 - is it Feb 3 or Mar 2?)
- **Non-standard date formats** ("Q1 2024", "Spring 2024")
- **Relative dates** ("30 days from order")
- **Invalid dates** (Feb 30, 2024)
- **Year-only or month-only** dates
- **Multiple date standards** in same document

### Text Content
- **Special characters** in vendor names (é, ñ, ü, etc.)
- **All caps text** (harder for NER)
- **Misspellings** in key fields
- **Abbreviations** without definitions
- **Whitespace issues** (extra spaces, tabs, line breaks)
- **HTML/XML entities** in text
- **Mixed language content** (English + Spanish)

## 4. Document-Specific Edge Cases

### Quote/RFQ Documents
- **Conditional pricing** ("If ordered by X date...")
- **Volume discounts** (tiered pricing)
- **Bundle offers** (package deals)
- **Optional items** marked separately
- **Taxes listed separately** vs. included
- **Partial fulfillment** options
- **Rush order surcharges**
- **Minimum order quantities**

### Bill of Materials (BOM)
- **Hierarchical BOMs** (assemblies with sub-assemblies)
- **BOM references external documents** (part specs)
- **Alternate parts** listed
- **"Do not populate" items**
- **Custom or made-to-order items**
- **Long-lead items** flagged
- **Obsolete part warnings**

### Invoices vs. Quotes
- **Document type ambiguity** (looks like both)
- **Pro forma invoices** (not actual invoices)
- **Credit notes** (negative invoices)
- **Partial shipment invoices**

## 5. OCR-Specific Edge Cases

### Text Recognition Issues
- **Handwritten annotations** on printed documents
- **Faded or light text** (poor contrast)
- **Text over images** or watermarks
- **Overlapping text elements**
- **Very small font sizes** (<6pt)
- **Unusual fonts** (decorative, script)
- **Text in images** (logos, diagrams)

### Layout Issues
- **Text in unexpected positions** (margins, headers, footers)
- **Vertical or diagonal text**
- **Text in non-standard reading order**
- **Forms with handwritten entries**
- **Stamps and seals** obscuring text

## 6. Edge Cases for AI/LLM Processing

### Context Understanding
- **Industry-specific jargon** without context
- **Product codes** that look like random strings
- **Internal reference numbers** (PO numbers, job codes)
- **Vendor-specific terminology**
- **Ambiguous abbreviations** (EA = each? East Asia?)

### Extraction Challenges
- **Information split across pages**
- **Repeated headers/footers** confusing content
- **Similar-looking but different vendors** (Acme Corp vs. Acme Corporation)
- **Contact info in unexpected locations** (signatures, letterhead)
- **Legal disclaimers** that look like terms

## 7. Business Logic Edge Cases

### Pricing Anomalies
- **Price = 0** (free samples, evaluations)
- **Negative prices** (credits, returns)
- **Unreasonably high prices** (data entry error?)
- **Unreasonably low prices** (missing zeros?)
- **Price per unit** vs. **total price** confusion

### Lead Time Issues
- **Indefinite lead times** ("to be determined")
- **Conditional lead times** ("5 days if in stock")
- **Business days** vs. **calendar days**
- **Lead time in various units** (hours, days, weeks, months)
- **Immediate availability** ("ships same day")

## 8. System/Technical Edge Cases

### Performance Issues
- **Very long processing times** (>60 seconds)
- **Memory exhaustion** on large files
- **Timeout scenarios**
- **Concurrent processing** of same document

### Integration Edge Cases
- **Network failures** during processing
- **API rate limits** exceeded
- **Partial results** after errors
- **Stale cache data**

## 9. Security & Validation

### Malicious Inputs
- **Injection attempts** in vendor names (SQL, XSS)
- **Excessively long field values** (buffer overflow attempts)
- **Special characters** meant to break parsing
- **Embedded scripts** or macros in documents

### Data Integrity
- **Checksum mismatches**
- **Modified documents** (digitally signed but altered)
- **Duplicate submissions** (same document uploaded twice)

## Testing Strategy Recommendations

1. **Create a test document library** with examples of each edge case
2. **Implement progressive fallbacks** (if main method fails, try alternatives)
3. **Add comprehensive logging** for debugging edge cases
4. **Set up monitoring** for unusual patterns
5. **Build a feedback loop** for continuous improvement
6. **Implement circuit breakers** for known problematic patterns
7. **Create manual review queues** for low-confidence extractions

## Priority Levels

**Critical (Must Handle):**
- Empty/corrupted files
- Missing required fields
- Invalid numeric formats
- Unsupported file types

**High Priority:**
- Multiple currencies
- Unusual table formats
- OCR errors
- Ambiguous dates

**Medium Priority:**
- Special characters
- Mixed content
- Performance issues
- Conditional pricing

**Low Priority:**
- Cosmetic issues
- Non-standard terminology
- Minor formatting variations
