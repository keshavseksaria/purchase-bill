/**
 * Gemini Vision API — extracts purchase bill data from an image.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- Helper: Levenshtein Distance for Fuzzy Matching ---
function getLevenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          Math.min(
            matrix[i][j - 1] + 1, // insertion
            matrix[i - 1][j] + 1  // deletion
          )
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function findBestMatch(rawName, list) {
  if (!rawName || !list || list.length === 0) return null;
  const target = rawName.toLowerCase().trim();
  
  let bestMatch = null;
  let bestDistance = Infinity;

  // 1. First Pass: Look for EXACT matches
  for (const item of list) {
    if (item.name.toLowerCase().trim() === target) return item.name;
  }

  // 2. Second Pass: Look for best fuzzy match
  for (const item of list) {
    const itemName = item.name.toLowerCase().trim();
    
    // Substring match: only prioritize if it's a very strong match
    if (target.includes(itemName) && itemName.length >= target.length * 0.4) {
      const dist = Math.abs(target.length - itemName.length) * 0.1;
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = item.name;
      }
    }
    
    const distance = getLevenshteinDistance(target, itemName);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = item.name;
    }
  }

  // Threshold: Max 30% difference
  const threshold = Math.max(3, target.length * 0.3);
  if (bestDistance <= threshold) {
    return bestMatch;
  }
  return null;
}

export async function extractBillData(imageBase64, masterData = { ledgers: [], stockItems: [] }, mimeType = 'image/jpeg') {
  if (!GEMINI_API_KEY) {
    console.warn('Gemini API key not set — returning mock data');
    return getMockData();
  }

  const EXTRACTION_PROMPT = `Analyze this purchase bill image and extract as JSON.
CRITICAL: UNROLL EVERY LINE. If a line shows "5 Pcs" or a serial range "01-05", you must return 5 separate objects in the "items" array, one for each individual piece.

{
  "date": "YYYY-MM-DD",
  "supplier_invoice_no": "string",
  "supplier_invoice_date": "YYYY-MM-DD",
  "party_name_raw": "Extract the SELLER name from the invoice header.",
  "items": [
    {
      "bill_item_name": "The printed description (e.g. ARISTOCRAT-174)",
      "buyer_item_name_raw": "The HANDWRITTEN code (e.g. SHKR, SMKR). Look for ink text in margins or header. IGNORE the printed columns for this field.",
      "serial": "The individual serial number (e.g. '01', '02'). If a range like 01-05 is given, you must create 5 separate item objects with serials '01', '02', '03', '04', '05'.",
      "actual_qty": "The quantity for this SINGLE piece (e.g. if 120mtr total for 5pcs, this value is 24).",
      "rate": number,
      "amount": number
    }
  ],
  "cgst": number,
  "sgst": number,
  "total": number
}

Extraction Rules:
1. UNROLLING: You must return ONE item object per serial number. Do not return ranges.
2. HANDWRITTEN CODES: Look for ink text (like SHKR). These can be anywhere. If written once, apply to all items in that group.
3. SMART SERIALS: Use logic to fix misreads. Serial numbers almost always start from '01'. If you see '91-85', it is '01-05'.
4. MATH: Ensure (actual_qty * rate) equals the amount for each unrolled row.
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

      // --- POST-PROCESSING ---
      data.party_name = findBestMatch(data.party_name_raw, masterData.ledgers);

      const billDate = data.date || data.supplier_invoice_date || '';
      const dateParts = billDate.split('-');
      const yearShort = dateParts[0] ? dateParts[0].slice(-2) : '25';
      const month = dateParts[1] ? dateParts[1].padStart(2, '0') : '01';
      const day = dateParts[2] ? dateParts[2].padStart(2, '0') : '01';

      if (data.items && Array.isArray(data.items)) {
        data.items = data.items.map(item => {
          const mappedName = findBestMatch(item.buyer_item_name_raw, masterData.stockItems);
          const sn = item.serial || '01';
          return {
            ...item,
            name_of_item: mappedName,
            handwritten_name_raw: item.buyer_item_name_raw,
            batch_no: `${month}${sn.padStart(2, '0')}${yearShort}${day}`,
            billed_qty: item.actual_qty,
            unit: 'No.'
          };
        });
      }

      return data;
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
