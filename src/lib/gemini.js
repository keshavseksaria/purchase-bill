/**
 * Gemini Vision API — extracts purchase bill data from an image.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function extractBillData(imageBase64, masterData = { ledgers: [], stockItems: [] }, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    console.warn('Gemini API key not set — returning mock data');
    return getMockData();
  }

  const EXTRACTION_PROMPT = `You are an expert at reading Indian purchase bills/invoices, including handwritten and printed text.

Analyze this purchase bill image and extract the following information as JSON:

{
  "date": "YYYY-MM-DD format, the purchase/bill date",
  "supplier_invoice_no": "the invoice/bill number",
  "supplier_invoice_date": "YYYY-MM-DD format",
  "party_name": "Mapped vendor name from the provided VALID_LEDGERS list",
  "party_name_raw": "Original vendor name as printed on the bill",
  "items": [
    {
      "bill_item_name": "Original item name as printed or handwritten on bill",
      "name_of_item": "Mapped item name from the provided VALID_STOCK_ITEMS list",
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

Important rules:
1. Party Name: Identify the Seller (at the top) and map it to the closest matching name in VALID_LEDGERS. Strictly ignore the buyer "SEKSARIA VASTRA BHANDAR".
2. Item Name: Ignore printed names. Look for HANDWRITTEN names above items. Map the handwritten name to the closest match in VALID_STOCK_ITEMS.
3. Batch Number (MMSSYYDD): Formula is Month(MM), Serial(SS), Year(YY), Date(DD). Serial is handwritten in front of items.
4. Item Unrolling: If a line has "pcs" (e.g. 5) and "mtrs" (e.g. 120) and a serial range (e.g. 01-05), split it into separate entries (e.g. 5 entries of 24 mtrs each).
5. Ensure the JSON is complete and valid. Return ONLY valid JSON.`;

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
