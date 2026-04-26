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
  "date": "YYYY-MM-DD",
  "supplier_invoice_no": "string",
  "supplier_invoice_date": "YYYY-MM-DD",
  "party_name": "Mapped vendor from VALID_LEDGERS (EXACT match)",
  "party_name_raw": "Original vendor on bill",
  "items": [
    {
      "bill_item_name": "Printed item name",
      "handwritten_name_raw": "Handwritten text ABOVE or NEAR the item",
      "name_of_item": "Mapped from VALID_STOCK_ITEMS (EXACT match). Priority to handwritten name.",
      "serials": ["List of handwritten serial numbers for this line, e.g. ['01', '02', '03'] or ['91', '92']"],
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

Rules:
1. Vendor: Identify SELLER. Map to VALID_LEDGERS.
2. Items: Search for HANDWRITTEN names (above/near) and map to VALID_STOCK_ITEMS.
3. Serials: Look for handwritten numbers in front of items (like '01-05' or '91-95'). List each serial in the "serials" array.
4. Quantities: Provide qty PER PIECE (e.g. if 5 pcs total 120mtrs, billed_qty_per_piece is 24).
5. Return ONLY valid JSON.`;

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
      const day = billDate ? billDate.split('-')[2] : '';
      const yearShort = billDate ? billDate.split('-')[0].slice(-2) : '';
      const month = billDate ? billDate.split('-')[1] : '';

      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const serials = (item.serials && item.serials.length > 0) ? item.serials : ['01'];
          for (const sn of serials) {
            unrolledItems.push({
              bill_item_name: item.bill_item_name,
              handwritten_name_raw: item.handwritten_name_raw,
              name_of_item: item.name_of_item,
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
