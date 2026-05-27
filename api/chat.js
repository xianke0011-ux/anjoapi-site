async function getUser(token) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/auth/v1/user`,
    {
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!res.ok) return null;

  return res.json();
}

async function supabaseRest(path, options = {}) {
  return fetch(
    `${process.env.SUPABASE_URL}/rest/v1${path}`,
    {
      ...options,
      headers: {
        apikey:
          process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    }
  );
}

export default async function handler(req, res) {
  try {
    // 获取 token
    const token =
      req.headers.authorization?.replace(
        "Bearer ",
        ""
      );

    if (!token) {
      return res.status(401).json({
        error: "请先登录",
      });
    }

    // 获取用户
    const user = await getUser(token);

    if (!user?.id) {
      return res.status(401).json({
        error: "登录已失效",
      });
    }

    // 获取余额
    let balanceRes = await supabaseRest(
      `/user_balances?user_id=eq.${user.id}&select=*`
    );

    let balanceRows =
      await balanceRes.json();

    // 新用户赠送余额
    if (!balanceRows.length) {
      await supabaseRest(`/user_balances`, {
        method: "POST",
        body: JSON.stringify({
          user_id: user.id,
          balance_usd: 0.5,
        }),
      });

      balanceRows = [
        {
          balance_usd: 0.5,
        },
      ];
    }

    const balance = Number(
      balanceRows[0].balance_usd
    );

    // 检查余额
    if (balance <= 0) {
      return res.status(400).json({
        error: "余额不足，请充值",
      });
    }

    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        error: "请输入内容",
      });
    }

    // 调 OpenAI
    const openaiRes = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",

          temperature: 0.2,

          messages: [
            {
              role: "system",
              content: `
你是 Anjo Chat 专业中法翻译助手。

你的任务：

1. 用户输入中文时，完整翻译成正式、自然、专业的法语。

2. 不允许总结、解释、评论、分析。

3. 不允许输出“如果需要请告诉我”等额外内容。

4. 不允许保留中文（人名、公司名除外）。

5. 保持原始编号、段落、小标题、逻辑结构。

6. 涉及摩洛哥：
- 居住证
- 工签
- 劳动合同
- 无犯罪证明
- 法律文件

时必须使用专业行政法语表达。

7. 不确定事项统一翻译为：
à confirmer

8. 输出内容只能是法语。

9. 保留原文格式。
              `,
            },
            {
              role: "user",
              content: message,
            },
          ],
        }),
      }
    );

    const openaiData =
      await openaiRes.json();

    // OpenAI错误
    if (openaiData.error) {
      return res.status(500).json({
        error:
          openaiData.error.message ||
          "OpenAI 调用失败",
      });
    }

    const reply =
      openaiData.choices?.[0]?.message
        ?.content ||
      "暂无回复";

    // 扣费
    const cost = 0.01;

    const newBalance = Math.max(
      balance - cost,
      0
    );

    // 更新余额
    await supabaseRest(
      `/user_balances?user_id=eq.${user.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          balance_usd: newBalance,
          updated_at:
            new Date().toISOString(),
        }),
      }
    );

    // 写聊天日志
    await supabaseRest(`/chat_logs`, {
      method: "POST",
      body: JSON.stringify({
        user_id: user.id,
        message,
        reply,
        cost_usd: cost,
      }),
    });

    // 写交易记录
    await supabaseRest(`/transactions`, {
      method: "POST",
      body: JSON.stringify({
        user_id: user.id,
        type: "chat",
        amount_usd: -cost,
        note: "AI聊天扣费",
      }),
    });

    return res.status(200).json({
      reply,
      balance: newBalance,
    });
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      error:
        err.message ||
        "服务器错误",
    });
  }
}
