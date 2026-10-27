import os
import sys
import time
import json
import urllib.parse
from datetime import datetime, timezone
import requests
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
DISCORD_WEBHOOK_URL = os.getenv("DISCORD_WEBHOOK_URL")
GROQ_MODEL = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
POLL_INTERVAL_MINUTES = float(os.getenv("POLL_INTERVAL_MINUTES", "0"))

if not GROQ_API_KEY or not DISCORD_WEBHOOK_URL or "your_groq_api_key" in GROQ_API_KEY:
    raise SystemExit("❌ Configuration error: Please provide valid GROQ_API_KEY and DISCORD_WEBHOOK_URL in .env")

# Groq client via OpenAI compatibility
client = OpenAI(
    api_key=GROQ_API_KEY,
    base_url="https://api.groq.com/openai/v1"
)

# Step 1: Fetch Top 10 Stories from Hacker News
def fetch_top_stories():
    print("📡 Fetching top stories from Hacker News...")
    top_ids_url = "https://hacker-news.firebaseio.com/v0/topstories.json"
    res = requests.get(top_ids_url, timeout=10)
    res.raise_for_status()
    top_ids = res.json()[:10]

    stories = []
    for item_id in top_ids:
        try:
            item_url = f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json"
            item_res = requests.get(item_url, timeout=5)
            if item_res.status_code == 200 and item_res.json():
                data = item_res.json()
                if data.get("type") == "story":
                    stories.append({
                        "id": data.get("id"),
                        "title": data.get("title", "Untitled"),
                        "url": data.get("url", f"https://news.ycombinator.com/item?id={data.get('id')}"),
                        "score": data.get("score", 0),
                        "by": data.get("by", "anonymous")
                    })
        except Exception as e:
            print(f"⚠️ Warning: Could not fetch story #{item_id}: {e}")

    print(f"✅ Fetched {len(stories)} stories.")
    return stories

# Step 2: Groq AI Summarization & Categorization
def summarize_and_categorize(stories):
    print("🧠 Processing stories via Groq...")
    system_prompt = """You are an elite, witty tech curator and developer news editor.
Analyze the top 10 Hacker News stories and return a strict JSON object:
{
  "top_stories": [
    {
      "id": 12345,
      "title": "Story Title",
      "tldr": "Punchy 1-sentence TL;DR summary",
      "dev_take": "Witty or humorous developer perspective"
    }
  ],
  "categorized_stories": [
    {
      "id": 12345,
      "title": "Story Title",
      "category": "AI/ML" | "WebDev/Software" | "Hardware" | "Business/Startups" | "Miscellaneous"
    }
  ],
  "category_counts": {
    "AI/ML": 4,
    "WebDev/Software": 3,
    "Hardware": 1,
    "Business/Startups": 1,
    "Miscellaneous": 1
  }
}
Rules:
- Provide TL;DR and dev_take for the FIRST 3 stories only.
- Categorize all 10 stories strictly into the 5 categories.
"""
    # Automatically discover active models from the Groq account
    models_to_try = []
    try:
        available_models = [m.id for m in client.models.list().data]
        print(f"📋 Models available on your Groq account: {available_models}")
        # Filter out audio/whisper models
        chat_models = [m for m in available_models if "whisper" not in m.lower() and "embed" not in m.lower()]
        if chat_models:
            # Put GROQ_MODEL first if it is in chat_models, then prefer llama-3 / deepseek / qwen / gemma
            models_to_try.extend(chat_models)
    except Exception as err:
        print(f"⚠️ Could not auto-list models from Groq: {err}")

    # Fallback to standard Groq names if listing was empty
    if not models_to_try:
        models_to_try = [
            GROQ_MODEL,
            "llama-3.3-70b-versatile",
            "llama-3.1-8b-instant",
            "qwen-2.5-32b",
            "deepseek-r1-distill-llama-70b",
            "gemma2-9b-it",
        ]

    # Deduplicate while preserving order
    models_to_try = list(dict.fromkeys(models_to_try))

    last_error = None
    for model_name in models_to_try:
        try:
            print(f"👉 Trying Groq model: {model_name}...")
            completion = client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": json.dumps(stories, indent=2)}
                ],
                response_format={"type": "json_object"},
                temperature=0.5
            )
            print(f"✨ Successfully generated summaries using {model_name}!")
            return json.loads(completion.choices[0].message.content)
        except Exception as e:
            last_error = e
            print(f"⚠️ Model {model_name} failed: {e}")

    raise RuntimeError(f"All Groq models failed. Last error: {last_error}")

# Step 3: Dynamic Chart Generation with QuickChart API
def generate_quickchart_url(category_counts):
    print("📊 Generating dynamic QuickChart doughnut chart...")
    categories = ["AI/ML", "WebDev/Software", "Hardware", "Business/Startups", "Miscellaneous"]
    labels = []
    data = []

    # Map categories to curated modern developer colors
    color_map = {
        "AI/ML": "#818CF8",             # Electric Indigo
        "WebDev/Software": "#38BDF8",   # Sky Blue
        "Hardware": "#34D399",          # Mint Emerald
        "Business/Startups": "#FBBF24", # Amber
        "Miscellaneous": "#F472B6"      # Soft Rose
    }
    colors = []

    for cat in categories:
        count = category_counts.get(cat, 0)
        if count > 0:
            labels.append(cat)
            data.append(count)
            colors.append(color_map.get(cat, "#A78BFA"))

    total = sum(data) if data else 10

    chart_config = {
        "type": "doughnut",
        "data": {
            "labels": labels,
            "datasets": [{
                "data": data,
                "backgroundColor": colors,
                "borderColor": "#2B2D31",
                "borderWidth": 4,
                "hoverOffset": 4
            }]
        },
        "options": {
            "cutoutPercentage": 72,
            "layout": {
                "padding": 10
            },
            "plugins": {
                "legend": {
                    "position": "right",
                    "align": "center",
                    "labels": {
                        "usePointStyle": True,
                        "pointStyle": "circle",
                        "boxWidth": 8,
                        "padding": 16,
                        "fontColor": "#E2E8F0",
                        "fontSize": 13,
                        "fontStyle": "bold",
                        "fontFamily": "Inter, Segoe UI, sans-serif"
                    }
                },
                "doughnutlabel": {
                    "labels": [
                        {"text": str(total), "font": {"size": 36, "weight": "bold", "family": "Inter, sans-serif"}, "color": "#FFFFFF"},
                        {"text": "STORIES", "font": {"size": 11, "weight": "bold", "family": "Inter, sans-serif"}, "color": "#94A3B8"}
                    ]
                },
                "datalabels": {
                    "display": False
                }
            }
        }
    }

    encoded = urllib.parse.quote(json.dumps(chart_config))
    # Using transparent background so the chart floats seamlessly on Discord dark mode
    return f"https://quickchart.io/chart?c={encoded}&w=560&h=280&bkg=transparent"

# Step 4: Discord Webhook Post
def send_to_discord(stories, ai_data, chart_url):
    print("🚀 Posting rich embeds to Discord...")
    story_map = {s["id"]: s for s in stories}

    top_fields = []
    for idx, item in enumerate(ai_data.get("top_stories", [])[:3]):
        orig = story_map.get(item.get("id"))
        score_text = f"⭐ **{orig['score']}** pts by `{orig['by']}`" if orig else ""
        link = f"[{orig['title']}]({orig['url']})" if orig else item.get("title")

        top_fields.append({
            "name": f"#{idx + 1} • {link}",
            "value": f"{score_text}\n> 💡 **TL;DR:** {item.get('tldr')}\n> 💬 **Dev Take:** *\"{item.get('dev_take')}\"*",
            "inline": False
        })

    embed_digest = {
        "title": "🔥 Hacker News AI Digest",
        "url": "https://news.ycombinator.com",
        "description": "Top stories from Hacker News summarized with developer commentary.",
        "color": 0xFF6600,
        "fields": top_fields,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "footer": {"text": f"Hacker News • Summarized with Groq ({GROQ_MODEL})"}
    }

    # Category metadata for rich Discord summary fields
    cat_icons = {
        "AI/ML": "🤖",
        "WebDev/Software": "💻",
        "Hardware": "⚡",
        "Business/Startups": "📈",
        "Miscellaneous": "🔮"
    }
    cat_counts = ai_data.get("category_counts", {})
    total_count = sum(cat_counts.values()) or 10

    chart_fields = []
    for cat, count in cat_counts.items():
        if count > 0:
            pct = round((count / total_count) * 100)
            icon = cat_icons.get(cat, "📌")
            chart_fields.append({
                "name": f"{icon} {cat}",
                "value": f"`{count} {'story' if count == 1 else 'stories'}` • **{pct}%**",
                "inline": True
            })

    embed_chart = {
        "title": "📊 Visual Topic Breakdown",
        "description": f"Want a visual topic breakdown of today's tech news? **[Click here to view interactive chart]({chart_url})**",
        "color": 0x6366F1,  # Electric Indigo
        "fields": chart_fields,
        "image": {"url": chart_url},
        "footer": {"text": "Rendered dynamically via QuickChart API • Transparent Dark Theme"}
    }

    payload = {
        "username": "HN Tech Digest",
        "avatar_url": "https://news.ycombinator.com/favicon.ico",
        "embeds": [embed_digest, embed_chart]
    }

    res = requests.post(DISCORD_WEBHOOK_URL, json=payload, timeout=10)
    res.raise_for_status()
    print("🎉 Successfully posted Hacker News Digest to Discord!")

def run_digest():
    stories = fetch_top_stories()
    if not stories:
        print("No stories to process.")
        return
    ai_data = summarize_and_categorize(stories)
    chart_url = generate_quickchart_url(ai_data.get("category_counts", {}))
    send_to_discord(stories, ai_data, chart_url)

def main():
    # Check if loop mode is enabled via argument or .env
    loop_arg = "--loop" in sys.argv or "-l" in sys.argv
    interval = POLL_INTERVAL_MINUTES

    # Default to 3 minutes if --loop was passed without POLL_INTERVAL_MINUTES set
    if loop_arg and interval <= 0:
        interval = 3.0

    if interval > 0:
        print(f"🔄 Automated loop mode enabled! Running every {interval} minute(s). Press Ctrl+C to stop.\n")
        run_count = 1
        while True:
            print(f"\n--- [Run #{run_count}] {datetime.now().strftime('%Y-%m-%d %H:%M:%S')} ---")
            try:
                run_digest()
            except Exception as e:
                print(f"⚠️ Error during run #{run_count}: {e}")

            print(f"⏳ Sleeping for {interval} minute(s)...")
            try:
                time.sleep(interval * 60)
            except KeyboardInterrupt:
                print("\n🛑 Scheduler stopped by user.")
                break
            run_count += 1
    else:
        try:
            run_digest()
        except Exception as e:
            print(f"❌ Fatal error: {e}")
            sys.exit(1)

if __name__ == "__main__":
    main()

