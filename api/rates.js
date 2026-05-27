// api/rates.js
// Backend serverless function chạy trên Vercel
// Gọi ExchangeRate-API thật → cache vào Supabase → trả về cho frontend

const { createClient } = require('@supabase/supabase-js');

// ─── Các đồng tiền cần lấy ───────────────────────────────────────────────────
const CURRENCIES = ['USD', 'EUR', 'JPY', 'KRW', 'CNY', 'GBP', 'AUD', 'SGD', 'THB', 'HKD'];

// ─── Tỷ lệ spread giả lập cho từng ngân hàng (vì API miễn phí ko có data ngân hàng VN)
const BANKS = [
  { id: 'Vietcombank', color: '#009943', spread: 0.005 },
  { id: 'BIDV',        color: '#00529B', spread: 0.006 },
  { id: 'Techcombank', color: '#E31E24', spread: 0.007 },
  { id: 'MB Bank',     color: '#00549A', spread: 0.006 },
  { id: 'ACB',         color: '#0066B2', spread: 0.007 },
  { id: 'VPBank',      color: '#006C35', spread: 0.008 },
  { id: 'Agribank',    color: '#C41E3A', spread: 0.006 },
];

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate'); // cache 5 phút

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // 1. Kiểm tra cache trong Supabase (dữ liệu < 5 phút thì dùng luôn)
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: cached } = await supabase
      .from('rate_snapshots')
      .select('*')
      .gte('created_at', fiveMinAgo)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (cached) {
      return res.json({ source: 'cache', ...JSON.parse(cached.payload) });
    }

    // 2. Gọi API thật lấy tỷ giá VND
    const apiKey = process.env.EXCHANGERATE_API_KEY;
    const apiRes = await fetch(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/VND`);
    const apiData = await apiRes.json();

    if (apiData.result !== 'success') {
      throw new Error('ExchangeRate API error: ' + apiData['error-type']);
    }

    // 3. Chuyển đổi: API trả về VND là gốc → ta cần X/VND
    // Ví dụ: rates.USD = 0.0000394 (1 VND = 0.0000394 USD)
    // → 1 USD = 1/0.0000394 VND
    const rawRates = apiData.conversion_rates;
    const ratesVND = {};
    for (const cur of CURRENCIES) {
      if (rawRates[cur]) {
        ratesVND[cur] = Math.round(1 / rawRates[cur]);
      }
    }

    // 4. Tạo dữ liệu ngân hàng từ tỷ giá thật + spread
    const bankRows = [];
    for (const bank of BANKS) {
      for (const cur of CURRENCIES.filter(c => c !== 'SGD' && c !== 'THB' && c !== 'HKD')) {
        const ref = ratesVND[cur];
        if (!ref) continue;
        // Thêm biến động nhỏ ngẫu nhiên mỗi ngân hàng (±0.05%)
        const variation = 1 + (Math.random() - 0.5) * 0.001;
        const refVar = Math.round(ref * variation);
        const buy  = Math.round(refVar * (1 - bank.spread / 2));
        const sell = Math.round(refVar * (1 + bank.spread / 2));
        const change = Math.round((Math.random() - 0.48) * ref * 0.002);
        bankRows.push({
          bank: bank.id,
          bankColor: bank.color,
          cur,
          buy,
          sell,
          ref: refVar,
          change,
        });
      }
    }

    const payload = {
      ratesVND,
      bankRows,
      updatedAt: new Date().toISOString(),
      source: 'live',
    };

    // 5. Lưu snapshot vào Supabase
    await supabase.from('rate_snapshots').insert({
      payload: JSON.stringify(payload),
      date_key: new Date().toISOString().slice(0, 10),
    });

    return res.json(payload);

  } catch (err) {
    console.error('rates.js error:', err);
    // Fallback: trả về mock data nếu lỗi
    return res.status(500).json({ error: err.message });
  }
};
