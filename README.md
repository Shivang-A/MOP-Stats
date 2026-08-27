# MOP-Stats — Montreal Protocol Agreement Dashboard

Live site: https://shivang-a.github.io/MOP-Stats/

Institute for Governance & Sustainable Development (IGSD).
Figures for the Montreal Protocol MOP 10th Anniversary publication.

---

## Updating the data

**Everything the dashboard shows comes from `MP-treaty-status-MASTER.xlsx`.**
There is no `data.json` any more — the page reads the spreadsheet directly in the
browser. To publish an update:

1. Open `MP-treaty-status-MASTER.xlsx` → **Parties** sheet.
2. Find the country row (sorted A–Z).
3. Type the date in that instrument's `*_Date` column as **YYYY-MM-DD**.
4. Type the legal act in the matching `*_Method` column
   (`Ratification`, `Acceptance`, `Approval`, `Accession`, `Succession`, `Provisional`).
5. Commit and push. GitHub Pages redeploys automatically.

Every figure — cumulative curve, ratifications per year, first movers, world map,
first-10-to-ratify — recalculates from that one edit. Nothing else needs touching.

Adding a country that is new to the treaties? Add a whole row and fill in
`Country`, `ISO2`, `ISO3` and `Article5` as well. **`ISO3` must be correct or the
country will not be drawn on the world map.**

The Figure 1 annotations (era brackets, the 2007 bar, the 2009 marker and star,
the 2026 Kigali anniversary line) live on the **Milestones** sheet of the same
workbook.

## Exports vs the website

PNG downloads deliberately omit the figure title, the descriptive line beneath it
and the source credit, so those can be typeset in Word alongside the image. The
website still shows all three. This applies to every figure.

## Data provenance

Source of truth is the UNEP Ozone Secretariat: https://ozone.unep.org/all-ratifications

The master file was rebuilt from that page and verified cell-by-cell — all
1,358 country-instrument records (date **and** legal method) match. Party totals
match the UNEP totals row exactly:

| Instrument | Parties |
|---|---|
| Vienna Convention | 198 |
| Montreal Protocol | 198 |
| London Amendment | 197 |
| Copenhagen Amendment | 197 |
| Montreal Amendment | 197 |
| Beijing Amendment | 197 |
| Kigali Amendment | 174 |

Signature dates are kept in `VC_Signature` / `MP_Signature` **for reference only**.
Signing a treaty is not the same as joining it, so those columns are never counted
as becoming a Party.

## Files

| File | Purpose |
|---|---|
| `index.html` | Page structure |
| `style.css` | All styling and scroll animation |
| `datalayer.js` | Reads the spreadsheet and builds the data object the figures consume |
| `app.js` | Figure rendering, annotations, and PNG export |
| `MP-treaty-status-MASTER.xlsx` | **The data.** Parties + Milestones + README sheets |
| `flags/` | 197 country flags as PNG (160×120) |

## Notes

- The page fetches the spreadsheet over HTTP, so it must be **served**, not opened
  as a `file://` document. To preview locally: `python3 -m http.server` then open
  `http://localhost:8000`.
- Flags are bundled PNGs rather than Unicode emoji. Windows' *Segoe UI Emoji* font
  ships no flag glyphs, so emoji flags appeared as two-letter codes (US, CA) on
  Windows and Edge. Bundled images render identically everywhere, and unlike SVG
  they survive the html2canvas PNG export.
- Print-grade exports render natively at `CONFIG.PRINT_DPI` (default 800 DPI →
  7200×4800 for Figure 1). Use Chrome; Safari caps canvas area lower.
