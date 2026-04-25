/**
 * Gemini Vision API — extracts purchase bill data from an image.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const EXTRACTION_PROMPT = `You are an expert at reading Indian purchase bills/invoices, including handwritten and printed text.

Analyze this purchase bill image and extract the following information as JSON:

{
  "date": "YYYY-MM-DD format, the purchase/bill date",
  "supplier_invoice_no": "the invoice/bill number",
  "supplier_invoice_date": "YYYY-MM-DD format",
  "party_name": "vendor/supplier name exactly as printed",
  "items": [
    {
      "bill_item_name": "item name exactly as printed on bill",
      "batch_no": "8-digit batch number in MMSSYYDD format if visible, or raw batch info",
      "actual_qty": number,
      "billed_qty": number,
      "rate": number (price per unit),
      "amount": number (total for this item = qty * rate)
    }
  ],
  "cgst": number (total CGST amount, 0 if not shown),
  "sgst": number (total SGST amount, 0 if not shown),
  "igst": number (total IGST amount, 0 if not shown),
  "round_off": number (round off amount, can be negative, 0 if not shown),
  "total": number (grand total / net payable amount)
}

Important rules:
1. The batch number format is 8 digits: MMSSYYDD where MM=month(01-12), SS=serial number, YY=year(last 2 digits), DD=date. Look for a starting batch number on the bill, and serial numbers written next to each item.
2. If an item has a starting batch like "03012621", subsequent items increment the serial: 03022621, 03032621, etc.
3. Quantities should be numbers only (no units).
4. Rates should be numbers only (no currency symbols).
5. All amounts should be positive numbers.
6. If you can't read a field clearly, use your best guess and note low confidence.
7. Return ONLY valid JSON, no markdown, no explanation.`;

export async function extractBillData(imageBase64, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    console.warn('Gemini API key not set — returning mock data');
    return getMockData();
  }

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: EXTRACTION_PROMPT },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: imageBase64,
                },
              },
            ],
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} — ${err}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Strip markdown code fences if present
    const jsonStr = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(jsonStr);
    return parsed;
  } catch (error) {
    console.error('Gemini extraction failed:', error);
    throw error;
  }
}

function getMockData() {
  return {
    date: new Date().toISOString().split('T')[0],
    supplier_invoice_no: 'DEMO-001',
    supplier_invoice_date: new Date().toISOString().split('T')[0],
    party_name: 'Demo Supplier',
    items: [
      {
        bill_item_name: 'Sample Item 1',
        batch_no: '04012624',
        actual_qty: 12,
        billed_qty: 12,
        rate: 150,
        amount: 1800,
      },
      {
        bill_item_name: 'Sample Item 2',
        batch_no: '04022624',
        actual_qty: 6,
        billed_qty: 6,
        rate: 200,
        amount: 1200,
      },
    ],
    cgst: 75,
    sgst: 75,
    igst: 0,
    round_off: 0,
    total: 3150,
  };
}
