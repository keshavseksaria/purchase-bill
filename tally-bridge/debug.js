// Debug: Try different Tally XML request formats
const fetch = (...args) => import('node-fetch').then(m => m.default(...args));
const TALLY_HOST = 'http://localhost:9000';

// Format 1: TallyPrime style with TYPE=COLLECTION
const FORMAT_1 = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>List of Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Format 2: TDL Collection approach
const FORMAT_2 = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>List of Accounts</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVCURRENTCOMPANY/>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <REPORT NAME="List of Accounts">
            <FORMS>List of Accounts</FORMS>
          </REPORT>
          <FORM NAME="List of Accounts">
            <PARTS>List of Accounts</PARTS>
          </FORM>
          <PART NAME="List of Accounts">
            <LINES>List of Accounts</LINES>
            <REPEAT>List of Accounts : Collection of Ledgers</REPEAT>
            <SCROLLED>Vertical</SCROLLED>
          </PART>
          <LINE NAME="List of Accounts">
            <FIELDS>LedgerName</FIELDS>
            <FIELDS>LedgerParent</FIELDS>
          </LINE>
          <FIELD NAME="LedgerName">
            <SET>$Name</SET>
          </FIELD>
          <FIELD NAME="LedgerParent">
            <SET>$Parent</SET>
          </FIELD>
          <COLLECTION NAME="Collection of Ledgers">
            <TYPE>Ledger</TYPE>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

// Format 3: Simple collection export
const FORMAT_3 = `<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>List of Ledgers</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>`;

// Format 4: Collection-based (common for TallyPrime)
const FORMAT_4 = `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>All Ledgers</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="All Ledgers" ISMODIFY="No">
            <TYPE>Ledger</TYPE>
            <FETCH>NAME, PARENT, OPENINGBALANCE</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;

async function tryFormat(label, xml) {
    try {
        console.log(`\n--- ${label} ---`);
        const res = await fetch(TALLY_HOST, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            body: xml,
        });
        const text = await res.text();
        const isError = text.includes('Unknown Request') || text.includes('cannot be processed');
        console.log(`Status: ${res.status} | Length: ${text.length} | Error: ${isError}`);
        if (!isError && text.length > 100) {
            console.log('RESPONSE (first 3000 chars):\n', text.substring(0, 3000));
        } else {
            console.log('Response:', text.trim());
        }
    } catch (err) {
        console.log('CONNECTION ERROR:', err.message);
    }
}

async function main() {
    console.log('Testing different Tally XML formats...\n');
    await tryFormat('Format 1: Collection Header', FORMAT_1);
    await tryFormat('Format 2: TDL Report', FORMAT_2);
    await tryFormat('Format 3: Export Data (alt)', FORMAT_3);
    await tryFormat('Format 4: TDL Collection Fetch', FORMAT_4);
}

main();
