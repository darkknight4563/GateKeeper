# Developer Toggles

This document describes environment variables that control ClarityChain's behavior during development and testing.

## Available Toggles

### `USE_DEMO_FIXTURE`

**Default:** `false`  
**Type:** Boolean (`"true"` or `"false"`)

Controls whether the system uses demo/fixture data instead of real processing.

```bash
# Enable demo mode
USE_DEMO_FIXTURE=true

# Disable demo mode (default)
USE_DEMO_FIXTURE=false
```

**When to use:**
- Testing frontend UI without real backend calls
- Demo presentations
- Development when you don't have real documents

**Warning:** Never enable this in production. Always verify this is `false` before deploying.

---

### `BLOCK_COMPOSE_ON_GAPS`

**Default:** `true`  
**Type:** Boolean (`"true"` or `"false"`)

Controls whether the report composition pipeline blocks when critical data gaps are detected.

```bash
# Block composition if critical fields are missing (recommended)
BLOCK_COMPOSE_ON_GAPS=true

# Allow composition with partial data
BLOCK_COMPOSE_ON_GAPS=false
```

**Behavior when `true`:**
- `/compose_report` returns HTTP 422 if ALL documents are missing:
  - `delivery_weeks` or `terms.delivery_weeks`
  - `warranty_months` or `terms.warranty_months`
  - `line_items[]` or `items[]`

**Behavior when `false`:**
- Report composition proceeds even with missing critical fields
- Report will show "[Data Gap]" placeholders where data is missing
- Useful for testing report layout with incomplete extraction

**When to use `false`:**
- Development/testing report generation logic
- Debugging extraction pipeline failures
- Testing UI with partial data

**When to use `true` (recommended):**
- Production deployments
- Preventing misleading reports with fabricated data
- Ensuring data quality before presenting to users

---

## Setting Environment Variables

### In Supabase Dashboard

1. Go to **Settings** → **Edge Functions**
2. Add secret/environment variable:
   - Name: `USE_DEMO_FIXTURE` or `BLOCK_COMPOSE_ON_GAPS`
   - Value: `true` or `false`
3. Restart edge functions for changes to take effect

### In Local Development

Create a `.env.local` file in `supabase/functions/`:

```bash
USE_DEMO_FIXTURE=false
BLOCK_COMPOSE_ON_GAPS=true
```

---

## Edge Functions Using These Toggles

### `compose_report`

- ✅ `USE_DEMO_FIXTURE` - Controls demo mode (if implemented)
- ✅ `BLOCK_COMPOSE_ON_GAPS` - Blocks composition on critical gaps

**Example error when blocked:**

```json
{
  "diagnostic": true,
  "blocked_by": "BLOCK_COMPOSE_ON_GAPS=true",
  "blocked_reason": "critical_data_gaps",
  "message": "Blocked compose: critical data gaps",
  "details": "ALL suppliers missing critical data...",
  "hint": "Set BLOCK_COMPOSE_ON_GAPS=false to allow composition with partial data"
}
```

---

## Best Practices

1. **Production Settings:**
   ```
   USE_DEMO_FIXTURE=false
   BLOCK_COMPOSE_ON_GAPS=true
   ```

2. **Development Settings:**
   ```
   USE_DEMO_FIXTURE=false  # Only enable for specific testing
   BLOCK_COMPOSE_ON_GAPS=true  # Keep strict validation
   ```

3. **Demo/Presentation Settings:**
   ```
   USE_DEMO_FIXTURE=true
   BLOCK_COMPOSE_ON_GAPS=false
   ```

4. **Always log toggle values** at function startup for debugging:
   ```typescript
   console.log('[FUNCTION] Developer toggles:', { 
     USE_DEMO_FIXTURE, 
     BLOCK_COMPOSE_ON_GAPS 
   });
   ```

---

## Troubleshooting

**Q: Report composition is blocked with "critical data gaps" error**  
A: Check if `BLOCK_COMPOSE_ON_GAPS=true`. Set to `false` if you want to allow partial reports, or fix the extraction pipeline to populate missing fields.

**Q: Getting demo data instead of real processing**  
A: Check if `USE_DEMO_FIXTURE=true`. Set to `false` to use real processing.

**Q: Changes to environment variables don't take effect**  
A: Restart the edge functions or redeploy. Environment variables are read at function initialization.
