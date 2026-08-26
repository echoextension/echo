# ECHO Bilibili Feed History Probe

Local research tool only. It is not referenced by ECHO's production `manifest.json` and must not be included in the production extension package.

## Purpose

The probe measures facts needed before implementing reversible Bilibili homepage feed batches:

- Current `.feed-card` count and unique target count.
- Aggregate card types derived from target URL shape.
- Coverage of target URL, title, cover, author, duration, and statistics fields.
- URL overlap between consecutive observed batches.
- Time and animation frames required for URL identity and field coverage to settle after a batch change.
- Same-target field updates observed after the initial two-frame settle point, which indicate that the proposed completion rule may be too early.

The probe does not click **换一换**, replace cards, intercept network requests, or persist history. Raw URLs, BV identifiers, titles, authors, covers, and card HTML remain in memory and are never included in the downloaded report.

## Run

1. Open `edge://extensions/`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this directory.
4. Open or refresh `https://www.bilibili.com/`.
5. Choose **开始观察** in the probe panel.
6. Click Bilibili's native **换一换** several times at a normal pace.
7. Download the aggregate report and inspect it before sharing.

Run separate sessions while logged in and logged out. Record browser version, viewport, and any visible homepage variant outside the report if those facts are needed for comparison.

## Interpretation

A batch is recorded only after its target URL sequence differs from the previous batch and the extracted identity plus field-coverage signature remains unchanged for two animation frames. This is a measurement rule, not yet a production completion contract. Timeouts and incomplete fields are retained as aggregate diagnostics. A non-zero `lateSameTargetUpdates` value means fields continued changing after that settle point.
