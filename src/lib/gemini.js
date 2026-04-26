/**
 * Gemini Vision API — extracts purchase bill data from an image.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function extractBillData(imageBase64, masterData = { ledgers: [], stockItems: [] }, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    console.warn('Gemini API key not set — returning mock data');
    return getMockData();
  }

  const EXTRACTION_PROMPT = `You are an expert at reading Indian purchase bills/invoices, including messy handwritten notes and printed text.

Analyze this purchase bill image and extract the following information as JSON:

{
  "date": "YYYY-MM-DD format, the purchase/bill date",
  "supplier_invoice_no": "the invoice/bill number",
  "supplier_invoice_date": "YYYY-MM-DD format",
  "party_name": "Mapped vendor name from the provided VALID_LEDGERS list (MUST be an EXACT string match from the list)",
  "party_name_raw": "Original vendor name as printed on the bill",
  "items": [
    {
      "bill_item_name": "Printed item name on the bill",
      "handwritten_name_raw": "The raw handwritten text found near this item (look above the line, in the margins, or in front of the printed name)",
      "name_of_item": "Mapped item name from the provided VALID_STOCK_ITEMS list (MUST be an EXACT string match from the list)",
      "batch_no": "8-digit batch number in MMSSYYDD format",
      "actual_qty": number,
      "billed_qty": number,
      "rate": number,
      "amount": number
    }
  ],
  "cgst": number,
  "sgst": number,
  "igst": number,
  "round_off": number,
  "total": number
}

VALID_LEDGERS:
${masterData.ledgers.map(l => l.name).join(', ')}

VALID_STOCK_ITEMS:
${masterData.stockItems.map(s => s.name).join(', ')}

Critical Mapping Rules:
1. Vendor Mapping: Identify the SELLER (at the top). Map it to the closest name in VALID_LEDGERS. Do NOT use the buyer name.
2. Handwritten Item Priority: The printed item names on the bill are often generic. Look for HANDWRITTEN text near each item. This handwritten text is the REAL item name.
3. Strict Stock Mapping: Map the handwritten text to the MOST SIMILAR name in the VALID_STOCK_ITEMS list. 
   - Example: If you see handwritten "shkr", map it to "Shkr" from the list.
   - Example: If you see "PR", look for an item in the list that matches "PR" or similar.
   - Do NOT return a name that is not in the VALID_STOCK_ITEMS list for "name_of_item".
4. Batch Number (MMSSYYDD): 
   - MM = Month (e.g., 04 for April)
   - SS = Serial Number (Handwritten in front of the item, usually 2 digits like 01, 02)
   - YY = Year (e.g., 24 for 2024)
   - DD = Date (The day part of the bill date)
5. Item Unrolling: If a single bill line represents multiple pieces (e.g., "5 pcs" with a serial range "01-05"), create 5 separate entries in the "items" array.
6. Return ONLY valid JSON. No markdown formatting.`;

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
            maxOutputTokens: 8192,
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

    let jsonStr = text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];

    if (jsonStr === '') throw new Error('Gemini returned an empty response.');

    try {
      return JSON.parse(jsonStr);
    } catch (parseErr) {
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
    items: [],
    total: 0,
  };
}
