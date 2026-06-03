// ─────────────────────────────────────────────────────────────────────────────
// samples.js — three synthetic reseller/distributor quotes in three different
// formats + shapes, each with a hand-labeled `expected` extraction (ground
// truth). They make the app demoable with no upload and give the eval harness a
// real golden set on first run. Content is embedded as strings so everything
// works offline (no fetch needed).
// ─────────────────────────────────────────────────────────────────────────────

export const SAMPLES = [
  {
    id: "ingram",
    name: "Ingram Micro — distributor CSV (HW + SW + freight)",
    fileName: "ingram-Q88231.csv",
    mime: "text/csv",
    content:
`Ingram Micro Distribution — Quote
Quote Number: Q-88231,Date: 2026-05-28,Valid Until: 2026-06-30,Currency: USD
Part Number,Description,Qty,Unit Price,Extended
UCSX-210C-M7,Cisco UCS X210c M7 Compute Node,2,4200.00,8400.00
MSWS-2022-STD,Windows Server 2022 Standard License (16-core),4,780.00,3120.00
FREIGHT,Shipping & Handling,1,145.00,145.00
,,,Grand Total,11665.00`,
    expected: {
      source: { vendor: "Ingram Micro", quoteNumber: "Q-88231", currency: "USD", validUntil: "2026-06-30" },
      totals: { grandTotalCost: 11665.00 },
      lineItems: [
        { sku: "UCSX-210C-M7", description: "Cisco UCS X210c M7 Compute Node", category: "hw", quantity: 2, unitCost: 4200, extendedCost: 8400 },
        { sku: "MSWS-2022-STD", description: "Windows Server 2022 Standard License (16-core)", category: "sw", quantity: 4, unitCost: 780, extendedCost: 3120 },
        { sku: "FREIGHT", description: "Shipping & Handling", category: "other", quantity: 1, unitCost: 145, extendedCost: 145 },
      ],
    },
  },
  {
    id: "cdw",
    name: "CDW — reseller PDF-style text (GBP, services)",
    fileName: "cdw-7741920.txt",
    mime: "text/plain",
    content:
`CDW Limited
Quotation  Quote No: 7741920   Valid until: 15/07/2026
Prepared for: Northwind Trading Ltd

Qty   Description                                   Unit       Line Total
1     Dell PowerEdge R760 Rack Server               £6,250.00  £6,250.00
10    Microsoft 365 Business Premium (annual)       £198.00    £1,980.00
3     Onsite Installation & Configuration (per day) £850.00    £2,550.00

                                          Total (ex VAT)  £10,780.00`,
    expected: {
      source: { vendor: "CDW", quoteNumber: "7741920", currency: "GBP", validUntil: "2026-07-15" },
      totals: { grandTotalCost: 10780.00 },
      lineItems: [
        { sku: "", description: "Dell PowerEdge R760 Rack Server", category: "hw", quantity: 1, unitCost: 6250, extendedCost: 6250 },
        { sku: "", description: "Microsoft 365 Business Premium (annual)", category: "sw", quantity: 10, unitCost: 198, extendedCost: 1980 },
        { sku: "", description: "Onsite Installation & Configuration (per day)", category: "ps", quantity: 3, unitCost: 850, extendedCost: 2550 },
      ],
    },
  },
  {
    id: "insight",
    name: "Insight — HTML email quote (HW + PS)",
    fileName: "insight-INS5567.html",
    mime: "text/html",
    content:
`<html><body>
<p>Hi — please find your quote below. Reference <b>INS-5567</b>, prices in USD, valid 30 days.</p>
<p>Regards,<br>Insight Enterprises</p>
<table border="1">
<tr><th>SKU</th><th>Item</th><th>Qty</th><th>Unit</th><th>Total</th></tr>
<tr><td>AP-635</td><td>Aruba AP-635 Wi-Fi 6E Access Point</td><td>6</td><td>520.00</td><td>3120.00</td></tr>
<tr><td>SVC-INSTALL</td><td>Network Installation Services</td><td>1</td><td>1800.00</td><td>1800.00</td></tr>
<tr><td></td><td>Grand Total</td><td></td><td></td><td>4920.00</td></tr>
</table>
</body></html>`,
    expected: {
      source: { vendor: "Insight", quoteNumber: "INS-5567", currency: "USD", validUntil: "" },
      totals: { grandTotalCost: 4920.00 },
      lineItems: [
        { sku: "AP-635", description: "Aruba AP-635 Wi-Fi 6E Access Point", category: "hw", quantity: 6, unitCost: 520, extendedCost: 3120 },
        { sku: "SVC-INSTALL", description: "Network Installation Services", category: "ps", quantity: 1, unitCost: 1800, extendedCost: 1800 },
      ],
    },
  },
];

/** Build a browser File from a sample so it flows through the normal ingest path. */
export function sampleToFile(sample) {
  return new File([sample.content], sample.fileName, { type: sample.mime });
}
