# ECHO Zhihu Blocklist Probe

Local research tool only. It is versioned so the investigation can continue across devices, but it is not referenced by ECHO's production `manifest.json` and is not part of the extension package.

## Purpose

The probe measures facts needed before designing the production feature:

- Whether Zhihu accepts blocklist page sizes of 20, 50, or 100.
- Reported total count and actual unique count.
- Pagination completeness, duplicates, and missing stable identifiers.
- Per-page latency, response size, retries, and rate-limit behavior.
- Approximate full-sync wall time for a large account.

It performs GET requests only. Reports do not include names, raw user IDs, URL tokens, cookies, or response bodies. A short SHA-256 prefix identifies the logged-in account so reports from different accounts can be distinguished without exposing the account ID.

## Run

1. Open `edge://extensions/`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this directory.
4. Open or refresh `https://www.zhihu.com/` while logged in.
5. Use the panel in the lower-right corner.

Use **Quick probe** first. It makes three blocklist requests. Use **Full scan** only when ready to read every page; requests are serial with a 250 ms delay, retry `429` and server errors with backoff, and can be stopped.

Download the JSON report after completion. Inspect it before sharing. The most important fields are `limitProbe`, `fullScan.expectedTotals`, `fullScan.uniqueIds`, `fullScan.totalsMatch`, `fullScan.pages`, `fullScan.totalElapsedMs`, `fullScan.totalResponseBytes`, and `fullScan.retryCount`.

## Cleanup

Remove the unpacked extension from `edge://extensions/` when research is complete. Keep generated reports only after confirming that they contain aggregate metrics rather than raw account or blocklist data.

## Versioned baseline

The repository includes `../echo-zhihu-blocklist-probe-2026-08-25T15-14-21-424Z.json`, an anonymized full-scan baseline from a 2,097-user blocklist. It contains aggregate page metrics only and is intentionally retained for comparison with later devices, accounts, and Zhihu versions.
