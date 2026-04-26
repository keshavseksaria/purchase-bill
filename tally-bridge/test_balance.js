const fs = require('fs');

const xml = fs.readFileSync('last_payload.xml', 'utf8');

function autoBalanceVoucher(xml) {
    let sum = 0;
    // Sum amounts from ACCOUNTINGALLOCATIONS.LIST
    const invMatches = xml.matchAll(/<ACCOUNTINGALLOCATIONS\.LIST>[\s\S]*?<AMOUNT>(.*?)<\/AMOUNT>[\s\S]*?<\/ACCOUNTINGALLOCATIONS\.LIST>/g);
    for (const m of invMatches) {
        sum += parseFloat(m[1]);
    }
    
    // Sum amounts from LEDGERENTRIES.LIST where ISPARTYLEDGER is No
    const ledMatches = xml.matchAll(/<LEDGERENTRIES\.LIST>[\s\S]*?<ISPARTYLEDGER>No<\/ISPARTYLEDGER>[\s\S]*?<AMOUNT>(.*?)<\/AMOUNT>[\s\S]*?<\/LEDGERENTRIES\.LIST>/g);
    for (const m of ledMatches) {
        sum += parseFloat(m[1]);
    }
    
    const requiredPartyAmount = (-sum).toFixed(2);
    console.log('Required Party Amount:', requiredPartyAmount);
    
    // Replace it in the XML
    let balancedXml = xml;
    balancedXml = balancedXml.replace(/(<ISPARTYLEDGER>Yes<\/ISPARTYLEDGER>[\s\S]*?<AMOUNT>)(.*?)(<\/AMOUNT>)/, `$1${requiredPartyAmount}$3`);
    balancedXml = balancedXml.replace(/(<BILLALLOCATIONS\.LIST>[\s\S]*?<AMOUNT>)(.*?)(<\/AMOUNT>)/, `$1${requiredPartyAmount}$3`);
    
    return balancedXml;
}

const fixed = autoBalanceVoucher(xml);
console.log(fixed.includes('14868.00'));
fs.writeFileSync('test_balanced.xml', fixed);
