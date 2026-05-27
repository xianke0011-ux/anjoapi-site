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
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        error: "请先登录",
      });
    }

    const user = await getUser(token);

    if (!user?.id) {
      return res.status(401).json({
        error: "登录已失效",
      });
    }

    // 查询余额
    let balanceRes = await supabaseRest(
      `/user_balances?user_id=eq.${user.id}&select=*`
    );

    let balanceRows = await balanceRes.json();

    // 新用户送0.5美元
    if (!balanceRows.length) {
      await supabaseRest(`/user_balances`, {
        method: "POST",
        body: JSON.stringify({
          user_id: user.id,
          balance_usd: 0.5,
        }),
      });

      balanceRows = [{ balance_usd: 0.5 }];
    }

    const balance = Number(balanceRows[0].balance_usd);

    // 余额不足
    if (balance <= 0) {
      return res.status(400).json({
        error: "余额不足，请充值",
      });
    }

    const { message } = req.body;

    // 调 OpenAI
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: "你是 Anjo Chat 智能助手",
            },
            {
              role: "user",
              content: message,
            },
          ],
        }),
      }
    );

    const openaiData = await openaiRes.json();

const reply =
  openaiData.choices?.[0]?.message?.content ||
  JSON.stringify(openaiData);

    // 每次聊天扣0.01美元
    const newBalance = Math.max(balance - 0.01, 0);

    await supabaseRest(
      `/user_balances?user_id=eq.${user.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          balance_usd: newBalance,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    // 写聊天记录
    await supabaseRest(`/chat_logs`, {
      method: "POST",
      body: JSON.stringify({
        user_id: user.id,
        message,
        reply,
        cost_usd: 0.01,
      }),
    });

    // 写交易记录
    await supabaseRest(`/transactions`, {
      method: "POST",
      body: JSON.stringify({
        user_id: user.id,
        type: "chat",
        amount_usd: -0.01,
        note: "AI聊天扣费",
      }),
    });

    return res.status(200).json({
      reply,
      balance: newBalance,
    });
  } catch (err) {
    return res.status(500).json({
      error: err.message,
    });
  }
}
