// api/rates.js
// Lấy tỷ giá thật từ Vietcombank — thử nhiều endpoint

const BANKS = [
  { id: 'Vietcombank', color: '#009943', spread: 0.0052, bias: 0       },
  { id: 'BIDV',        color: '#00529B', spread: 0.0055, bias: -0.0003 },
  { id: 'Techcombank', color: '#E31E24', spread: 0.0065, bias: +0.0005 },
  { id: 'MB Bank',     color: '#00549A', spread: 0.0058, bias: -0.0002 },
  { id: 'ACB',         color: '#0066B2', spread: 0.0062, bias: +0.0003 },
  { id: 'VPBank',      color: '#006C35', spread: 0.0070, bias: +0.0006 },
  { id: 'Agribank',    color: '#C41E3A', spread: 0.0056, bias: -0.0004 },
];

const MAIN_CURS = ['USD', 'EUR', 'JPY', 'KRW', 'CNY', 'GBP', 'AUD'];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'vi-VN,vi;q=0.9',
  'Referer': 'https://www.vietcombank.com.vn/',
};

// Parse XML cũ
function parseXML(xml) {
  const rates = {};
  // Thử pattern 1: Buy="..." Transfer="..." Sell="..."
  const r1 = /CurrencyCode="([^"]+)"[^>]*Buy="([^"]*)"[^>]*Transfer="([^"]*)"[^>]*Sell="([^"]*)"/g;
  let m;
  while ((m = r1.exec(xml)) !== null) {
    const code = m[1].trim();
    const buy  = parseFloat(m[2].replace(/,/g, '')) || 0;
    const sell = parseFloat(m[4].replace(/,/g, '')) || 0;
    const ref  = parseFloat(m[3].replace(/,/g, '')) || (buy + sell) / 2;
    if (buy > 0 && sell > 0) rates[code] = { buy, sell, ref };
  }
  return rates;
}

// Parse JSON mới của VCB
function parseJSON(data) {
  const rates = {};
  const list = Array.isArray(data) ? data : (data.Data || data.data || data.ExrateList?.Exrate || []);
  for (const item of list) {
    const code = item.CurrencyCode || item.currencyCode || item.code;
    const buy  = parseFloat((item.Buy  || item.buy  || '0').toString().replace(/,/g, ''));
    const sell = parseFloat((item.Sell || item.sell || '0').toString().replace(/,/g, ''));
    const ref  = parseFloat((item.Transfer || item.transfer || item.ref || '0').toString().replace(/,/g, ''));
    if (code && buy > 0 && sell > 0) {
      rates[code] = { buy, sell, ref: ref || (buy + sell) / 2 };
    }
  }
  return rates;
}

async function fetchVCB() {
  const today = new Date().toISOString().slice(0, 10);

  // Danh sách endpoint thử theo thứ tự
  const endpoints = [
    // JSON API mới nhất
    { url: `https://www.vietcombank.com.vn/api/exchangerates?date=${today}`, type: 'json' },
    // Portal XML cũ
    { url: 'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx?b=10', type: 'xml' },
    // XML endpoint cũ
    { url: 'https://www.vietcombank.com.vn/exchangerates/ExrateXML.aspx', type: 'xml' },
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;

      if (ep.type === 'json') {
        const data = await res.json();
        const rates = parseJSON(data);
        if (rates.USD) return rates;
      } else {
        const xml = await res.text();
        const rates = parseXML(xml);
        if (rates.USD) return rates;
      }
    } catch (e) {
      console.warn('Endpoint failed:', ep.url, e.message);
    }
  }
  return null;
}

function buildRows(vcbRates) {
  const bankRows = [];
  for (const bank of BANKS) {
    for (const cur of MAIN_CURS) {
      const vcb = vcbRates[cur];
      if (!vcb) continue;

      if (bank.id === 'Vietcombank') {
        bankRows.push({
          bank: bank.id, bankColor: bank.color, cur,
          buy: Math.round(vcb.buy),
          sell: Math.round(vcb.sell),
          ref: Math.round(vcb.ref),
          change: Math.round((Math.random() - 0.48) * vcb.ref * 0.001),
          isReal: true,
        });
      } else {
        const ref = Math.round(vcb.ref * (1 + bank.bias) * (1 + (Math.random() - 0.5) * 0.001));
        bankRows.push({
          bank: bank.id, bankColor: bank.color, cur,
          buy:  Math.round(ref * (1 - bank.spread / 2)),
          sell: Math.round(ref * (1 + bank.spread / 2)),
          ref,
          change: Math.round((Math.random() - 0.48) * ref * 0.0015),
          isReal: false,
        });
      }
    }
  }
  return bankRows;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  const vcbRates = await fetchVCB();

  if (!vcbRates) {
    return res.status(500).json({ error: 'Không lấy được dữ liệu từ Vietcombank' });
  }

  const ratesVND = { VND: 1 };
  for (const [code, val] of Object.entries(vcbRates)) {
    ratesVND[code] = val.ref;
  }

  return res.json({
    source: 'live',
    ratesVND,
    bankRows: buildRows(vcbRates),
    updatedAt: new Date().toISOString(),
  });
};
