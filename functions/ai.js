const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

exports.claudeProxy = onRequest(
  {
    secrets: [ANTHROPIC_API_KEY],
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    // CORS headers
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    try {
      const { messages, system, max_tokens } = req.body;

      if (!messages || !Array.isArray(messages)) {
        res.status(400).json({ error: "Missing messages" });
        return;
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":         "application/json",
          "x-api-key":            ANTHROPIC_API_KEY.value(),
          "anthropic-version":    "2023-06-01",
          "anthropic-beta":       "pdfs-2024-09-25",
        },
        body: JSON.stringify({
          model:      "claude-sonnet-4-20250514",
          max_tokens: max_tokens || 2000,
          system:     system || "",
          messages,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Anthropic error:", data);
        res.status(response.status).json({ error: data?.error?.message || "API error" });
        return;
      }

      res.status(200).json(data);

    } catch (err) {
      console.error("claudeProxy error:", err);
      res.status(500).json({ error: err.message || "Internal error" });
    }
  }
);