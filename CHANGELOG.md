# Changelog

## 2.0 — 2026-09-07
- Universal: pods and all-in-ones (plus NY live-resin tin, turn one, online hemp line) with per-device applicability.
- New factors from turn's public asset hub: barcode vs 323 published UPCs, pouch artwork vs device, size vs per-state matrix.
- Catalog grown to 198 products with device, state and line metadata.
- Front end rebuilt as a mobile-first app shell: tab bar, product tiles, segmented answers, coverage matrix, live engine facts, animated result ring. Same logic layer (`app.js`), enhancement layer added (`ui.js`).
- Verified / Stats screens restyled; all emoji removed in favour of inline SVG.

## 1.x — 2026-09-07 (same day, earlier)
- QR-first flow against NY/CA Metrc Retail ID registry; malformed / not-issued / unknown code discrimination.
- Vision "visual match" factor removed after it scored a confirmed fake higher than a genuine unit.
- Device selector, pod-only checks skipped honestly for non-pouch products.
- Public anonymous stats; test-scan exclusion.
