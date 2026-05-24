async function getUser(token) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: process.env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

async function supabaseRest(path, options = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "请先登录" });

  const user = await getUser(token);
  if (!user?.id) return res.status(401).json({ error: "登录失效" });

  let r = await supabaseRest(`/user_balances?user_id=eq.${user.id}&select=*`);
  let rows = await r.json();

  if (!rows.length) {
    await supabaseRest(`/user_balances`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        user_id: user.id,
        balance_usd: 0.5,
      }),
    });

    rows = [{ balance_usd: 0.5 }];
  }

  res.status(200).json({
    balance: Number(rows[0].balance_usd),
  });
}
