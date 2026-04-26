const fs = require('fs');
const path = require('path');

// Mock a simple fetch for Node
const env = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf-8');
const GEMINI_API_KEY = env.match(/GEMINI_API_KEY=(.*)/)[1].trim();

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

  for (const item of list) {
    const itemName = item.name.toLowerCase().trim();
    if (itemName === target) return item.name;
    
    if (itemName.includes(target) || target.includes(itemName)) {
      const dist = Math.abs(itemName.length - target.length) * 0.1; 
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = item.name;
      }
      continue;
    }

    const distance = getLevenshteinDistance(target, itemName);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = item.name;
    }
  }

  if (bestDistance <= Math.max(3, target.length * 0.6)) {
    return bestMatch;
  }
  return null;
}

async function extractBillData(imageBase64, masterData = { ledgers: [], stockItems: [] }, mimeType = 'image/jpeg') {
  const EXTRACTION_PROMPT = `Analyze this purchase bill image and extract as JSON:

{
  "date": "YYYY-MM-DD (Indian bills are DD/MM/YYYY. If you see 19/12/25, it is 2025-12-19)",
  "supplier_invoice_no": "string",
  "supplier_invoice_date": "YYYY-MM-DD",
  "party_name_raw": "Original seller/vendor name at the top of the bill (e.g. 'SALERAJ CORPORATION'). Ignore the buyer name (like Seksaria Vastra Bhandar).",
  "items": [
    {
      "seller_item_name": "Item name as written by seller (could be printed or handwritten)",
      "buyer_item_name_raw": "The handwritten item name added by the buyer. Look closely at the VERY TOP of the table (it might be written as 'SHKR 12012519'). If it's at the top, apply it to EVERY item. Otherwise, look ABOVE or IN FRONT of the item. INHERIT from the row above if missing.",
      "serials": ["List of handwritten serials for this line, e.g. ['01', '02', '03']"],
      "total_qty": number,
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
1. Seller: Extract the main seller name at the top.
2. Items & Inheritance: The buyer often writes the general item name (e.g. 'SHKR') ONCE at the top of the bill/table, sometimes next to a batch number. If you see this, apply that name (e.g. 'SHKR') to ALL items. If not at the top, look next to each item and inherit down.
3. Date: Indian format is DD/MM/YYYY.
4. Serials & Context: Handwritten '0' often looks like '9'. If you see a sequence like '91, 92, 93' followed by '04, 05, 06', use SMART LOGIC to correct it to '01, 02, 03'. Serial numbers almost always start from '01'. Expand ranges into full arrays (e.g., "01-05" -> ["01", "02", "03", "04", "05"]).
5. No Item Unrolling: Return only ONE JSON object per line.
6. Return ONLY valid JSON.`;

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
      }),
    }
  );

  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  
  const candidate = result.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text || '';
  if (!text) throw new Error('Empty response');
  
  const data = JSON.parse(text);

  // --- FUZZY MATCHING ---
  data.party_name = findBestMatch(data.party_name_raw, masterData.ledgers);

  // --- UNROLL ---
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
      
      const mappedName = findBestMatch(item.buyer_item_name_raw, masterData.stockItems);
      const qtyPerPiece = item.total_qty ? (item.total_qty / numPieces) : 1;
      const rate = item.rate || 0;

      for (const sn of serials) {
        unrolledItems.push({
          bill_item_name: item.seller_item_name,
          handwritten_name_raw: item.buyer_item_name_raw,
          name_of_item: mappedName,
          batch_no: `${month}${sn.padStart(2, '0')}${yearShort}${day}`,
          actual_qty: qtyPerPiece,
          billed_qty: qtyPerPiece,
          rate: rate,
          amount: qtyPerPiece * rate
        });
      }
    }
  }

  return { ...data, items: unrolledItems };
}

// RUN TEST
(async () => {
  const imagePath = process.argv[2] || 'sample-bill.jpeg';
  const base64 = fs.readFileSync(imagePath).toString('base64');
  const masterData = {
    ledgers: [{ name: 'Saleraj Corporation' }, { name: 'Seksaria Vastra Bhandar' }],
    stockItems: [{ name: 'Shkr' }, { name: 'ARISTOCRAT-174' }]
  };

  try {
    const data = await extractBillData(base64, masterData);
    console.log('✅ VALID DATA (UNROLLED AND FUZZY MATCHED)');
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Test Failed:', err);
  }
})();
