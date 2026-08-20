# Original User Request

## 2026-08-17T06:37:50Z

This is a single self-contained fix; keep it small and focused. Fix the 'AI service temporarily unavailable (Gemini returned an empty response. Please try again.). Please try again in a moment or enter an API key in Settings.' error permanently across the client application and Netlify serverless function.

Working directory: /Users/ronit/Downloads/ExcelsisAdvisors-main
Integrity mode: development

## Requirements

### R1. Robust Response Parsing and Safety Filter Handling
Gracefully parse Google Gemini API responses across both `netlify/functions/gemini.js` and `js/ai.js`. Handle empty parts, safety finish reasons (`SAFETY`, `RECITATION`, `BLOCKLIST`, `OTHER`), thinking token blocks, and non-standard candidate formats without throwing uncaught empty response exceptions.

### R2. Resilient Model Fallback and Automatic Retries
Implement multi-tier fallback sequences across active Gemini model endpoints (including `gemini-2.0-flash`, `gemini-1.5-flash-latest`, `gemini-1.5-flash`, `gemini-1.5-pro`) when a model returns an empty payload, a safety block, or transient rate limits / 503s.

### R3. Transparent Error & Fallback Diagnostics
Ensure actionable error messaging that clearly differentiates between missing API keys, rate limit exhaustions, safety blocks, and network timeouts, and provide transparent fallback logging so users are not blocked by transient model outages.

## Acceptance Criteria

### Reliability & Error Prevention
- [ ] An empty or blocked candidate response from a primary model triggers an automatic fallback to the next candidate model instead of immediately failing.
- [ ] Both client-side direct API calls and serverless function invocations handle missing parts and edge-case finish reasons gracefully.
- [ ] When valid API credentials or serverless keys exist, transient model empty responses no longer display a false "temporarily unavailable" blocking prompt if alternative models succeed.
- [ ] Verification script or test harness confirms that simulating an empty response or 503 on the primary model cleanly cascades to fallback models and succeeds.
