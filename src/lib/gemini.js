/**
 * Gemini Vision API — extracts purchase bill data from an image.
 * 
 * ARCHITECTURE:
 * 1. Gemini extracts RAW data from the image (serial numbers, handwritten codes, etc.)
 * 2. Post-processing in JS handles: fuzzy matching, batch number generation (MMSSYYDD)
 * 3. processor.js saves to DB
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

  // 1. Exact match
  for (const item of list) {
    if (item.name.toLowerCase().trim() === target) return item.name;
  }

  // 2. Fuzzy match
  for (const item of list) {
    const itemName = item.name.toLowerCase().trim();
    
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

  const EXTRACTION_PROMPT = `You are an expert at reading Indian purchase bills / invoices from photos.

CONTEXT:
- The buyer is "Seksaria Vastra Bhandar" (or similar). This is NOT the party name we need.
- The SELLER / SUPPLIER name (usually printed at the very top of the bill) is what we need as "party_name_raw".
- If the seller name is in Hindi, transliterate/translate it to English.
- The buyer handwrites additional information on the bill AFTER receiving it:
  a) An ITEM CODE — a short single-word code like SHKR, SUJE, BD, TO, SHSI (no spaces). 
  b) A SAMPLE BATCH NUMBER — an 8-digit number like 08012511 (format: MMSSYYDD where MM=month, SS=serial, YY=year, DD=date).
  c) Individual SERIAL NUMBERS — written in front of / next to each item line (e.g., 01, 02, 03...).

ITEM CODE RULES:
- If ALL items share the same code, it is written ONCE somewhere on the bill (top, bottom, or margin). Apply it to every item.
- If items have DIFFERENT codes, the code is written next to the item where it changes. Items without a code next to them inherit the PREVIOUS item's code.
  Example: Item1 has "SHKR" written → Item2 has nothing → Item3 has nothing → Item4 has "SHSI" → Items 1,2,3 are SHKR; Item4 is SHSI.

BATCH NUMBER / SERIAL RULES:
- Look for an 8-digit handwritten number like "08012511" — this is the TEMPLATE batch number.
- Look for individual serial numbers (usually 2-digit) written next to each item (01, 02, 03...).
- Serials are almost always sequential. If you read 01, 02, 04 — the 04 is probably 03 misread.
- Serials may reset between different item codes: SHKR 01,02,03 then SHSI 01,02.

UNROLLING RULES:
- If a single line says "5 Pcs" or "Qty: 5" with serial range "01-05", create 5 separate item objects.
- If individual piece quantities (breakdown) are written (usually to the left/below), use those exact quantities.
- If no breakdown is given, divide total quantity equally: e.g., 120 mtrs / 5 pcs = 24 each.

DISCOUNT:
- Look for any percentage discount mentioned for items. Return as a number (e.g., 10 for 10%).

GST:
- GST is EITHER (CGST 2.5% + SGST 2.5%) OR (IGST 5%), never both simultaneously.
- Extract the actual rupee amounts from the bill.

ROUND OFF:
- The final amount is usually rounded to the nearest integer.
- Round down for ≤49 paisa, round up for ≥50 paisa.

Return ONLY a valid JSON object with this exact structure:
{
  "date": "YYYY-MM-DD (bill date)",
  "supplier_invoice_no": "invoice number string",
  "supplier_invoice_date": "YYYY-MM-DD",
  "party_name_raw": "Seller/Supplier name in English",
  "batch_template": "the 8-digit handwritten batch number template if found, e.g. 08012511",
  "items": [
    {
      "seller_item_name": "printed item description from the bill (translate Hindi to English)",
      "handwritten_code": "the handwritten item code (e.g. SHKR). Single word, no spaces. null if not found.",
      "serial": "2-digit serial number for this piece (e.g. '01'). null if not found.",
      "qty": number,
      "rate": number,
      "discount": number or 0,
      "amount": number
    }
  ],
  "cgst": number or 0,
  "sgst": number or 0,
  "igst": number or 0,
  "round_off": number,
  "total": number
}

IMPORTANT:
- Return ONLY the JSON. No markdown, no explanation.
- All number values must be plain numbers (no commas, no currency symbols).
- If a field is not found, use null for strings and 0 for numbers.`;

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
            maxOutputTokens: 65535,
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

      // ─── POST-PROCESSING ───────────────────────────────────

      // 1. Party name: fuzzy match against ledgers
      data.party_name = findBestMatch(data.party_name_raw, masterData.ledgers);

      // 2. Extract batch template parts (MMSSYYDD)
      const template = data.batch_template || '';
      let tmplMM = '', tmplYY = '', tmplDD = '';
      
      if (template.length === 8) {
        tmplMM = template.slice(0, 2);
        // skip SS (2,4)
        tmplYY = template.slice(4, 6);
        tmplDD = template.slice(6, 8);
      } else {
        // Fallback: derive from bill date
        const billDate = data.date || data.supplier_invoice_date || '';
        const dateParts = billDate.split('-');
        tmplYY = dateParts[0] ? dateParts[0].slice(-2) : '25';
        tmplMM = dateParts[1] ? dateParts[1].padStart(2, '0') : '01';
        tmplDD = dateParts[2] ? dateParts[2].padStart(2, '0') : '01';
      }

      // 3. Process each item
      if (data.items && Array.isArray(data.items)) {
        data.items = data.items.map(item => {
          // Fuzzy match handwritten code → stock item
          const rawCode = item.handwritten_code || null;
          const mappedName = findBestMatch(rawCode, masterData.stockItems);

          // Generate batch number: MMSSYYDD
          let batch_no = '';
          if (item.serial && tmplMM) {
            const ss = String(item.serial).padStart(2, '0');
            batch_no = `${tmplMM}${ss}${tmplYY}${tmplDD}`;
          }

          // Compute amount if discount is present but amount seems off
          const qty = parseFloat(item.qty) || 0;
          const rate = parseFloat(item.rate) || 0;
          const disc = parseFloat(item.discount) || 0;
          const subtotal = qty * rate;
          const computedAmount = disc > 0 ? subtotal - (subtotal * disc / 100) : subtotal;

          return {
            bill_item_name: item.seller_item_name || '',
            name_of_item: mappedName || rawCode || '',
            handwritten_name_raw: rawCode,
            batch_no: batch_no,
            serial: item.serial || null,
            actual_qty: qty,
            billed_qty: qty,
            rate: rate,
            discount: disc,
            amount: item.amount || computedAmount,
            unit: 'No.',
          };
        });
      }

      // 4. Compute round_off if not provided
      if (data.items && data.items.length > 0) {
        const itemsTotal = data.items.reduce((sum, it) => sum + (parseFloat(it.amount) || 0), 0);
        const gst = (parseFloat(data.cgst) || 0) + (parseFloat(data.sgst) || 0) + (parseFloat(data.igst) || 0);
        const rawTotal = itemsTotal + gst;
        const roundedTotal = Math.round(rawTotal);
        
        if (!data.round_off && data.total) {
          data.round_off = parseFloat((data.total - rawTotal).toFixed(2));
        }
      }

      return data;
    } catch (parseErr) {
      console.error('JSON Parse Error. Raw Text:', text.substring(0, 500));
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
