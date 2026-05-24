export default async function handler(req, res) {
  // 只允许 POST 请求
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Only POST requests are allowed",
    });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        error: "消息不能为空",
      });
    }

    // 调用 OpenAI API
    const response = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: "gpt-5-mini",
          messages: [
            {
              role: "system",
              content:
                "你是 Anjo Chat，一个专业、友好、简洁的 AI 助手。",
            },
            {
              role: "user",
              content: message,
            },
          ],
          temperature: 0.7,
          max_tokens: 800,
        }),
      }
    );

    const data = await response.json();

    // OpenAI 返回错误
    if (!response.ok) {
      console.error(data);

      return res.status(500).json({
        error:
          data?.error?.message || "OpenAI API 调用失败",
      });
    }

    // 获取回复内容
    const reply =
      data?.choices?.[0]?.message?.content ||
      "没有获取到回复";

    return res.status(200).json({
      reply,
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: "服务器错误，请稍后再试",
    });
  }
}
