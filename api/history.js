// api/history.js
// Lấy lịch sử tỷ giá 7 ngày từ Supabase

const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600'); // cache 1 giờ

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    // Lấy 1 snapshot đại diện mỗi ngày trong 7 ngày qua
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const { data, error } = await supabase
      .from('rate_snapshots')
      .select('date_key, payload, created_at')
      .gte('created_at', sevenDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Group by date_key, lấy bản mới nhất mỗi ngày
    const byDate = {};
    for (const row of (data || [])) {
      if (!byDate[row.date_key]) {
        byDate[row.date_key] = JSON.parse(row.payload);
      }
    }

    // Tạo mảng 7 ngày (điền mock nếu chưa có data ngày đó)
    const result = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });

      if (byDate[key]) {
        result.push({ date: label, dateKey: key, rates: byDate[key].ratesVND });
      } else {
        result.push({ date: label, dateKey: key, rates: null }); // chưa có data
      }
    }

    return res.json({ history: result });

  } catch (err) {
    console.error('history.js error:', err);
    return res.status(500).json({ error: err.message });
  }
};
