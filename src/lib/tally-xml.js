/**
 * Generates Tally-compatible XML for a purchase voucher.
 * Based on actual Tally export analysis of Purchase_96.xml.
 */

const COMPANY_NAME = 'SEKSARIA VASTRA BHANDAR - (from 1-Apr-2020)';

/**
 * Build Tally XML from an entry + items.
 * All amounts in entry/items are in "invoice math" (positive).
 * This function applies Tally sign conventions (debit=negative, credit=positive).
 */
export function generateTallyXML(entry, items) {
  const date = (entry.date || '').replace(/-/g, ''); // YYYYMMDD
  const refDate = (entry.supplier_invoice_date || entry.date || '').replace(/-/g, '');
  const partyName = escapeXml(entry.party_name);
  const reference = escapeXml(entry.supplier_invoice_no);

  // Calculate totals
  const itemsTotal = items.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0);
  const cgst = parseFloat(entry.cgst) || 0;
  const sgst = parseFloat(entry.sgst) || 0;
  const igst = parseFloat(entry.igst) || 0;
  const roundOff = parseFloat(entry.round_off) || 0;
  // Party pays: items + taxes - round_off (round_off is subtracted if positive means favorable rounding)
  const partyAmount = parseFloat(entry.total) || (itemsTotal + cgst + sgst + igst - roundOff);

  let inventoryXML = '';
  for (const item of items) {
    const amount = parseFloat(item.amount) || 0;
    const unit = item.unit || 'No.';
    const qty = parseFloat(item.actual_qty) || 0;
    const billedQty = parseFloat(item.billed_qty) || qty;
    const rate = parseFloat(item.rate) || 0;
    const discount = parseFloat(item.discount) || 0;

    inventoryXML += `
      <ALLINVENTORYENTRIES.LIST>
       <STOCKITEMNAME>${escapeXml(item.name_of_item || item.bill_item_name)}</STOCKITEMNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
       <ISAUTONEGATE>No</ISAUTONEGATE>
       <ISCUSTOMSCLEARANCE>No</ISCUSTOMSCLEARANCE>
       <ISTRACKCOMPONENT>No</ISTRACKCOMPONENT>
       <ISTRACKPRODUCTION>No</ISTRACKPRODUCTION>
       <ISPRIMARYITEM>No</ISPRIMARYITEM>
       <ISSCRAP>No</ISSCRAP>
       <RATE>${rate.toFixed(2)}/${unit}</RATE>
       <DISCOUNT> ${discount.toFixed(2)}</DISCOUNT>
       <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
       <ACTUALQTY> ${qty.toFixed(2)} ${unit}</ACTUALQTY>
       <BILLEDQTY> ${billedQty.toFixed(2)} ${unit}</BILLEDQTY>
       <BATCHALLOCATIONS.LIST>
        <GODOWNNAME>Main Location</GODOWNNAME>
        <BATCHNAME>${escapeXml(item.batch_no)}</BATCHNAME>
        <DESTINATIONGODOWNNAME>Main Location</DESTINATIONGODOWNNAME>
        <INDENTNO>&#4; Not Applicable</INDENTNO>
        <ORDERNO>&#4; Not Applicable</ORDERNO>
        <TRACKINGNUMBER>&#4; Not Applicable</TRACKINGNUMBER>
        <DYNAMICCSTISCLEARED>No</DYNAMICCSTISCLEARED>
        <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
        <ACTUALQTY> ${qty.toFixed(2)} ${unit}</ACTUALQTY>
        <BILLEDQTY> ${billedQty.toFixed(2)} ${unit}</BILLEDQTY>
       </BATCHALLOCATIONS.LIST>
       <ACCOUNTINGALLOCATIONS.LIST>
        <OLDAUDITENTRYIDS.LIST TYPE="Number">
         <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
        </OLDAUDITENTRYIDS.LIST>
        <LEDGERNAME>Purchases</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <ISPARTYLEDGER>No</ISPARTYLEDGER>
        <AMOUNT>-${amount.toFixed(2)}</AMOUNT>
       </ACCOUNTINGALLOCATIONS.LIST>
      </ALLINVENTORYENTRIES.LIST>`;
  }

  // Ledger entries
  let ledgerXML = '';

  // Party ledger (credit = positive)
  ledgerXML += `
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>${partyName}</LEDGERNAME>
       <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
       <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
       <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
       <AMOUNT>${partyAmount.toFixed(2)}</AMOUNT>
       <BILLALLOCATIONS.LIST>
        <NAME>${reference}</NAME>
        <BILLTYPE>New Ref</BILLTYPE>
        <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
        <AMOUNT>${partyAmount.toFixed(2)}</AMOUNT>
       </BILLALLOCATIONS.LIST>
      </LEDGERENTRIES.LIST>`;

  // CGST (debit = negative)
  if (cgst > 0) {
    ledgerXML += `
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>CGST</LEDGERNAME>
       <METHODTYPE>GST</METHODTYPE>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
       <REMOVEZEROENTRIES>Yes</REMOVEZEROENTRIES>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>-${cgst.toFixed(2)}</AMOUNT>
      </LEDGERENTRIES.LIST>`;
  }

  // SGST (debit = negative)
  if (sgst > 0) {
    ledgerXML += `
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>SGST</LEDGERNAME>
       <METHODTYPE>GST</METHODTYPE>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
       <REMOVEZEROENTRIES>Yes</REMOVEZEROENTRIES>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>-${sgst.toFixed(2)}</AMOUNT>
      </LEDGERENTRIES.LIST>`;
  }

  // IGST (debit = negative)
  if (igst > 0) {
    ledgerXML += `
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <LEDGERNAME>IGST</LEDGERNAME>
       <METHODTYPE>GST</METHODTYPE>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
       <REMOVEZEROENTRIES>Yes</REMOVEZEROENTRIES>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <AMOUNT>-${igst.toFixed(2)}</AMOUNT>
      </LEDGERENTRIES.LIST>`;
  }

  // Round Off
  if (roundOff !== 0) {
    // In XML: if roundOff>0 means we rounded down (credit), negative means rounded up (debit)
    // The sign in XML: positive = deemed positive (credit side in this context)
    ledgerXML += `
      <LEDGERENTRIES.LIST>
       <OLDAUDITENTRYIDS.LIST TYPE="Number">
        <OLDAUDITENTRYIDS>-1</OLDAUDITENTRYIDS>
       </OLDAUDITENTRYIDS.LIST>
       <ROUNDTYPE>Normal Rounding</ROUNDTYPE>
       <LEDGERNAME>Round Off</LEDGERNAME>
       <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
       <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
       <ISPARTYLEDGER>No</ISPARTYLEDGER>
       <ROUNDLIMIT> 1</ROUNDLIMIT>
       <AMOUNT>-${roundOff.toFixed(2)}</AMOUNT>
      </LEDGERENTRIES.LIST>`;
  }

  const xml = `<ENVELOPE>
 <HEADER>
  <TALLYREQUEST>Import Data</TALLYREQUEST>
 </HEADER>
 <BODY>
  <IMPORTDATA>
   <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
     <SVCURRENTCOMPANY>${escapeXml(COMPANY_NAME)}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
   </REQUESTDESC>
   <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">
      <DATE>${date}</DATE>
      <REFERENCEDATE>${refDate}</REFERENCEDATE>
      <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
      <PARTYNAME>${partyName}</PARTYNAME>
      <PARTYLEDGERNAME>${partyName}</PARTYLEDGERNAME>
      <REFERENCE>${reference}</REFERENCE>
      <PERSISTEDVIEW>Invoice Voucher View</PERSISTEDVIEW>
      <ISINVOICE>Yes</ISINVOICE>
      <HASDISCOUNTS>Yes</HASDISCOUNTS>
      <DIFFACTUALQTY>Yes</DIFFACTUALQTY>
      <ISDELETED>No</ISDELETED>
      <ISSYSTEM>No</ISSYSTEM>
      <ISCANCELLED>No</ISCANCELLED>
${inventoryXML}
${ledgerXML}
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>
  </IMPORTDATA>
 </BODY>
</ENVELOPE>`;

  return xml;
}

function escapeXml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
