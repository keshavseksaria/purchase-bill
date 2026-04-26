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

  const EXTRACTION_PROMPT = `Analyze this purchase bill image and extract as JSON:

{
  "date": "YYYY-MM-DD (Indian bills are DD/MM/YYYY. If you see 19/12/25, it is 2025-12-19)",
  "supplier_invoice_no": "string",
  "supplier_invoice_date": "YYYY-MM-DD",
  "party_name_raw": "Original seller/vendor name at the top of the bill (e.g. 'SALERAJ CORPORATION'). Ignore the buyer name (like Seksaria Vastra Bhandar).",
  "items": [
    {
      "seller_item_name": "Item name as written by seller (could be printed or handwritten)",
      "buyer_item_name_raw": "The handwritten item name or category added by the buyer. Look for handwritten text at the top of the table or near the item rows. If a row is blank, inherit the handwritten name from the preceding row or the header.",
      "serials": ["Array of individual serial numbers extracted from handwritten notes (e.g., expand ranges like '01-05' into ['01', '02', '03', '04', '05'])"],
      "total_qty": "The primary quantity used for billing (e.g., total meters, total weight). If multiple numbers exist (like piece count vs total weight), extract the one that represents the base unit of the rate/amount.",
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

Extraction Rules:
1. Seller Identification: Extract the original seller name from the header. Ignore the buyer name.
2. Primary Quantity: Purchase bills often list packaging counts (pieces/bundles) alongside total quantity (meters/kgs). Extract the total quantity used for the final amount calculation.
3. Handwritten Context: Buyers often write internal item names or batch markers by hand. Extract these accurately. If written once at the top of a section, apply it to all items in that section.
4. Serial Expansion: If a line includes a handwritten range of serial numbers, expand it into an array of individual strings.
5. Smart Number Recognition: Use surrounding context to resolve ambiguous handwritten digits (e.g., ensuring serial sequences are logical).
6. Date Format: Strictly follow the DD/MM/YYYY format found on Indian invoices.
7. Return valid JSON only.`;

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

      // --- FUZZY MATCHING ---
      data.party_name = findBestMatch(data.party_name_raw, masterData.ledgers);

      // --- UNROLL ITEMS ---
      const unrolledItems = [];
      const billDate = data.date || data.supplier_invoice_date || '';
      const dateParts = billDate.split('-');
      const yearShort = dateParts[0] ? dateParts[0].slice(-2) : '25';
      const month = dateParts[1] ? dateParts[1].padStart(2, '0') : '01';
      const day = dateParts[2] ? dateParts[2].padStart(2, '0') : '01';

      if (data.items && Array.isArray(data.items)) {
        for (const item of data.items) {
          const serials = (item.serials && item.serials.length > 0) ? item.serials : ['01'];
          const numPieces = serials.length;
          
          // Fuzzy match the item name
          const mappedName = findBestMatch(item.buyer_item_name_raw, masterData.stockItems);
          
          // Calculate qty per piece
          const qtyPerPiece = item.total_qty ? (item.total_qty / numPieces) : 1;
          const rate = item.rate || 0;

          for (const sn of serials) {
            unrolledItems.push({
              bill_item_name: item.seller_item_name,
              handwritten_name_raw: item.buyer_item_name_raw,
              name_of_item: mappedName,
              // Formula: MM SS YY DD
              batch_no: `${month}${sn.padStart(2, '0')}${yearShort}${day}`,
              actual_qty: qtyPerPiece,
              billed_qty: qtyPerPiece,
              rate: rate,
              amount: qtyPerPiece * rate
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
