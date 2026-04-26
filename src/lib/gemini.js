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
1. Party Name: Extract the *Seller's name* (the entity issuing the bill at the top). STRICTLY IGNORE the buyer's name (which is "SEKSARIA VASTRA BHANDAR" or variations).
2. Item Name: Ignore the printed item names. Look ONLY for HANDWRITTEN item names (e.g., "shkr") written above or next to items. A handwritten item name applies to all subsequent items below it until a new handwritten name appears.
3. Batch Number (MMSSYYDD): An 8-digit batch number will always be handwritten at the top of the items. The formula is MM (Month of invoice), SS (Serial number), YY (Last 2 digits of year), DD (Day of invoice). A serial number range (e.g., 01-05) or full batch number will be handwritten in front of each item. If the handwriting is unclear, cross-check it using the MMSSYYDD formula based on the invoice date.
4. Item Unrolling (Crucial): If a printed line contains a piece count (e.g., 5 pcs), a total meter count (e.g., 120 mtrs), AND a handwritten serial range (e.g., "01-05" or "11-12"), you MUST unroll this single line into multiple separate JSON entries (one for each piece).
   - Example unrolling: "5 pcs, 120 mtrs, range 01-05" becomes 5 entries.
   - For each unrolled entry: The quantity (actual_qty and billed_qty) is total meters / pieces (e.g., 120 / 5 = 24).
   - The amount is the unrolled quantity * rate (e.g., 24 * 118).
   - The batch number for each unrolled entry uses the incrementing serial number from the range (01, 02, 03, 04, 05).
   - If an item has only one unit (e.g., 5 pcs, no meters) and NO serial range, keep it as a single entry.
5. Quantities and Rates: Should be numbers only (no units or currency symbols). All amounts must be positive numbers.
6. If you can't read a field clearly, use your best guess and note low confidence. Return ONLY valid JSON, no markdown, no explanation.`;

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
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
          ],
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
    let jsonStr = text.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
    
    // Robust JSON extraction: look for the first '{' and last '}'
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    if (jsonStr === '') {
      throw new Error('Gemini returned an empty response (possibly blocked by safety filters).');
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return parsed;
    } catch (parseErr) {
      console.error('JSON Parse Error. Raw text:', text);
      throw new Error(`AI generated invalid JSON. Raw: ${text.substring(0, 100)}...`);
    }
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
