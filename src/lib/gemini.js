/**
 * Gemini Vision API — extracts purchase bill data from an image.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

export async function extractBillData(imageBase64, masterData = { ledgers: [], stockItems: [] }, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    console.warn('Gemini API key not set — returning mock data');
    return getMockData();
  }

  const EXTRACTION_PROMPT = `Analyze this purchase bill image and extract as JSON:

{
  "date": "YYYY-MM-DD (Ensure the year is correct, usually 2024 or 2025. Do NOT swap day and year)",
  "supplier_invoice_no": "string",
  "supplier_invoice_date": "YYYY-MM-DD",
  "party_name": "Mapped vendor name (EXACT match from VALID_LEDGERS)",
  "party_name_raw": "Original vendor name as printed on bill (e.g. 'SALERAJ CORPORATION')",
  "items": [
    {
      "bill_item_name_printed": "Generic printed name",
      "handwritten_name_raw": "The specific handwritten name found ABOVE or NEAR the printed item (e.g. 'shkr', 'smkr')",
      "name_of_item": "Mapped stock item (EXACT match from VALID_STOCK_ITEMS). Use the HANDWRITTEN name for mapping. If no handwritten name, use the printed one.",
      "serials": ["List of handwritten serial numbers for this line, e.g. ['01', '02']"],
      "actual_qty_per_piece": number,
      "billed_qty_per_piece": number,
      "rate": number,
      "amount_total": number
    }
  ],
  "cgst": number,
  "sgst": number,
  "igst": number,
  "round_off": number,
  "total": number
}

VALID_LEDGERS: ${masterData.ledgers.map(l => l.name).join(', ')}
VALID_STOCK_ITEMS: ${masterData.stockItems.map(s => s.name).join(', ')}

Strict Rules:
1. Seller Identification: Find the SELLER (at the top). Map it to VALID_LEDGERS. 
   - Example: If you read "SALERAJ CORPORATION", map it to "Saleraj Corporation" from the list.
2. Handwritten Priority: Printed item names are often generic (like 'ARISTOCRAT'). You MUST find the HANDWRITTEN text near the item (e.g. 'Shkr') and use it to map to VALID_STOCK_ITEMS.
3. Date Parsing: Be very careful. Indian bills use DD/MM/YYYY. If you see 19/12/25, it is Dec 19, 2025, NOT Dec 25, 2019.
4. No Item Unrolling: Return only ONE JSON object per line on the bill. Use the "serials" array to list all serial numbers found for that line.
5. Return ONLY valid JSON.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${GEMINI_API_KEY}`,
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
            response_mime_type: "application/json",
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

    if (!text) throw new Error('Gemini returned an empty response.');

    try {
      let cleaned = text.trim();
      if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
      }
      const data = JSON.parse(cleaned);

      // --- UNROLL ITEMS ---
      const unrolledItems = [];
      const billDate = data.date || data.supplier_invoice_date || '';
      // Ensure we parse the date correctly (expecting YYYY-MM-DD from Gemini)
      const dateParts = billDate.split('-');
      const day = dateParts[2] ? dateParts[2].padStart(2, '0') : '';
      const yearShort = dateParts[0] ? dateParts[0].slice(-2) : '';
      const month = dateParts[1] ? dateParts[1].padStart(2, '0') : '';

      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const serials = (item.serials && item.serials.length > 0) ? item.serials : ['01'];
          for (const sn of serials) {
            unrolledItems.push({
              bill_item_name: item.bill_item_name_printed || item.bill_item_name,
              handwritten_name_raw: item.handwritten_name_raw,
              name_of_item: item.name_of_item,
              // Formula: MM SS YY DD
              batch_no: `${month}${sn.padStart(2, '0')}${yearShort}${day}`,
              actual_qty: item.actual_qty_per_piece || 1,
              billed_qty: item.billed_qty_per_piece || 1,
              rate: item.rate,
              amount: (item.billed_qty_per_piece || 1) * item.rate
            });
          }
        }
      }

      return {
        ...data,
        items: unrolledItems
      };
    } catch (parseErr) {
      console.error('JSON Parse Error. Raw Text:', text);
      throw new Error(`AI generated invalid JSON: ${parseErr.message}`);
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
