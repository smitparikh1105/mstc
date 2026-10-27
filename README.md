# 📰 Hacker News AI Digest & Visualizer Bot

A lightweight bot that fetches top stories from Hacker News, summarizes them with developer-focused commentary using Groq Cloud API (Qwen / Llama 3), dynamically charts topic distribution with QuickChart API, and posts rich embeds to a Discord channel via Webhook.

---

## 🛠️ Stack
- **Hacker News Firebase API**: Fetches top 10 stories in real-time.
- **Groq Cloud API** (OpenAI SDK compatibility): Fast summaries, categorization, and developer takes.
- **QuickChart API**: Generates dynamic, transparent dark-mode doughnut charts.
- **Discord Webhook**: Sends dual rich embeds with clickable links, domain metrics, and embedded charts.

---

## ⚙️ Setup & Configuration

1. **Clone / Navigate to directory**:
   ```bash
   cd c:\Users\SMIT\OneDrive\Desktop\mstc
   ```

2. **Set up `.env`**:
   Ensure `.env` contains your actual API credentials:
   ```env
   GROQ_API_KEY=gsk_your_groq_api_key_here
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
   GROQ_MODEL=qwen/qwen3.8-27b
   ```
   - Get a free Groq key: [Groq Console](https://console.groq.com)
   - Create a Discord Webhook: **Channel Settings > Integrations > Webhooks > New Webhook**

---

## 🚀 Running the Bot

### 1. Run Once
- **Python**:
  ```powershell
  python main.py
  ```
- **TypeScript**:
  ```powershell
  npm start
  ```

---

### 2. Run Automatically Every 3 Minutes (Loop Mode)

You can run it in a continuous loop directly from your terminal:

- **Python**:
  ```powershell
  python main.py --loop
  ```
- **TypeScript**:
  ```powershell
  npm start -- --loop
  ```

Or configure `POLL_INTERVAL_MINUTES=3` in `.env` and run `python main.py`.

---

### 3. Run in Background on Windows (PowerShell)

To start the bot silently in the background:
```powershell
Start-Process python -ArgumentList "main.py --loop" -WindowStyle Hidden
```
To stop a background process:
```powershell
Stop-Process -Name python
```
