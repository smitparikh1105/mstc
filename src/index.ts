import dotenv from "dotenv";
import OpenAI from "openai";

// Load environment variables
dotenv.config();

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
const POLL_INTERVAL_MINUTES = parseFloat(process.env.POLL_INTERVAL_MINUTES || "0");

if (!GROQ_API_KEY || !DISCORD_WEBHOOK_URL || GROQ_API_KEY.includes("your_groq_api_key")) {
  console.error("❌ Configuration error: Please provide valid GROQ_API_KEY and DISCORD_WEBHOOK_URL in .env");
  process.exit(1);
}

// Groq client initialized using OpenAI SDK compatibility
const groq = new OpenAI({
  apiKey: GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

interface HNStory {
  id: number;
  title: string;
  url: string;
  score: number;
  by: string;
}

interface TopStorySummary {
  id: number;
  title: string;
  tldr: string;
  dev_take: string;
}

interface CategorizedStory {
  id: number;
  title: string;
  category: "AI/ML" | "WebDev/Software" | "Hardware" | "Business/Startups" | "Miscellaneous";
}

interface GroqResponsePayload {
  top_stories: TopStorySummary[];
  categorized_stories: CategorizedStory[];
  category_counts: Record<string, number>;
}

/**
 * Step 1: Fetch Top 10 Stories from Hacker News API
 */
async function fetchHNTopStories(): Promise<HNStory[]> {
  console.log("📡 Fetching top story IDs from Hacker News...");
  const topIdsRes = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json");
  if (!topIdsRes.ok) {
    throw new Error(`Failed to fetch top stories: ${topIdsRes.statusText}`);
  }

  const topIds = (await topIdsRes.json()) as number[];
  const targetIds = topIds.slice(0, 10);

  console.log(`📥 Fetching details for ${targetIds.length} stories...`);
  const storyPromises = targetIds.map(async (id) => {
    try {
      const itemRes = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
      if (!itemRes.ok) {
        console.warn(`⚠️ HTTP error ${itemRes.status} fetching story #${id}`);
        return null;
      }
      const data = await itemRes.json();
      if (!data || data.type !== "story") return null;

      return {
        id: data.id,
        title: data.title ?? "Untitled",
        url: data.url ?? `https://news.ycombinator.com/item?id=${data.id}`,
        score: data.score ?? 0,
        by: data.by ?? "unknown",
      } as HNStory;
    } catch (err) {
      console.warn(`⚠️ Warning: Failed to fetch story #${id}:`, err);
      return null;
    }
  });

  const results = await Promise.all(storyPromises);
  const stories = results.filter((s): s is HNStory => s !== null);
  console.log(`✅ Successfully fetched ${stories.length} stories.`);
  return stories;
}

/**
 * Step 2: Summarize and Categorize using Groq API (OpenAI SDK compatible)
 */
async function processStoriesWithGroq(stories: HNStory[]): Promise<GroqResponsePayload> {
  console.log("🧠 Processing stories with Groq AI (Llama 3.3)...");

  const systemPrompt = `You are an elite, witty tech curator and developer news editor.
You will receive a JSON list of top Hacker News stories.
Respond ONLY with a valid JSON object matching this schema:
{
  "top_stories": [
    {
      "id": number,
      "title": "string",
      "tldr": "Punchy 1-sentence TL;DR summary explaining what it is and why it matters",
      "dev_take": "A witty, sarcastic, or insightful humorous developer perspective"
    }
  ],
  "categorized_stories": [
    {
      "id": number,
      "title": "string",
      "category": "AI/ML" | "WebDev/Software" | "Hardware" | "Business/Startups" | "Miscellaneous"
    }
  ],
  "category_counts": {
    "AI/ML": number,
    "WebDev/Software": number,
    "Hardware": number,
    "Business/Startups": number,
    "Miscellaneous": number
  }
}

Rules:
1. Provide summaries in "top_stories" for the FIRST 3 stories only.
2. Categorize all 10 stories strictly into one of the 5 allowed categories.
3. Calculate accurate totals for "category_counts".`;

  let candidateModels: string[] = [];
  try {
    const listRes = await groq.models.list();
    const available = listRes.data.map((m) => m.id);
    console.log(`📋 Models available on your Groq account:`, available);
    const chatModels = available.filter(
      (m) => !m.toLowerCase().includes("whisper") && !m.toLowerCase().includes("embed")
    );
    if (chatModels.length > 0) {
      candidateModels = chatModels;
    }
  } catch (err) {
    console.warn("⚠️ Could not auto-list models from Groq:", err instanceof Error ? err.message : err);
  }

  if (candidateModels.length === 0) {
    candidateModels = [
      GROQ_MODEL,
      "llama-3.3-70b-versatile",
      "llama-3.1-8b-instant",
      "qwen-2.5-32b",
      "deepseek-r1-distill-llama-70b",
      "gemma2-9b-it",
    ];
  }

  candidateModels = Array.from(new Set(candidateModels));

  let lastError: unknown;
  for (const modelName of candidateModels) {
    try {
      console.log(`👉 Trying Groq model: ${modelName}...`);
      const completion = await groq.chat.completions.create({
        model: modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(stories, null, 2) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.5,
      });

      const content = completion.choices[0]?.message?.content;
      if (content) {
        console.log(`✨ Successfully generated summaries using ${modelName}!`);
        return JSON.parse(content) as GroqResponsePayload;
      }
    } catch (err) {
      lastError = err;
      console.warn(`⚠️ Model ${modelName} failed:`, err instanceof Error ? err.message : err);
    }
  }

  throw new Error(`All Groq candidate models failed. Last error: ${lastError}`);
}

/**
 * Step 3: Dynamic Chart Generation with QuickChart API
 */
function generateQuickChartUrl(counts: Record<string, number>): string {
  console.log("📊 Generating QuickChart doughnut chart URL...");

  const validCategories = ["AI/ML", "WebDev/Software", "Hardware", "Business/Startups", "Miscellaneous"];
  const labels: string[] = [];
  const data: number[] = [];

  const colorMap: Record<string, string> = {
    "AI/ML": "#818CF8",             // Electric Indigo
    "WebDev/Software": "#38BDF8",   // Sky Blue
    "Hardware": "#34D399",          // Mint Emerald
    "Business/Startups": "#FBBF24", // Amber
    "Miscellaneous": "#F472B6",     // Soft Rose
  };
  const colors: string[] = [];

  for (const cat of validCategories) {
    const count = counts[cat] ?? 0;
    if (count > 0) {
      labels.push(cat);
      data.push(count);
      colors.push(colorMap[cat] || "#A78BFA");
    }
  }

  const total = data.reduce((a, b) => a + b, 0) || 10;

  const chartConfig = {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderColor: "#2B2D31",
          borderWidth: 4,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      cutoutPercentage: 72,
      layout: {
        padding: 10,
      },
      plugins: {
        legend: {
          position: "right",
          align: "center",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            boxWidth: 8,
            padding: 16,
            fontColor: "#E2E8F0",
            fontSize: 13,
            fontStyle: "bold",
            fontFamily: "Inter, Segoe UI, sans-serif",
          },
        },
        doughnutlabel: {
          labels: [
            { text: `${total}`, font: { size: 36, weight: "bold", family: "Inter, sans-serif" }, color: "#FFFFFF" },
            { text: "STORIES", font: { size: 11, weight: "bold", family: "Inter, sans-serif" }, color: "#94A3B8" },
          ],
        },
        datalabels: {
          display: false,
        },
      },
    },
  };

  const encodedConfig = encodeURIComponent(JSON.stringify(chartConfig));
  return `https://quickchart.io/chart?c=${encodedConfig}&w=560&h=280&bkg=transparent`;
}

/**
 * Step 4: Construct and Post Discord Webhook Payload
 */
async function postToDiscord(stories: HNStory[], groqData: GroqResponsePayload, chartUrl: string): Promise<void> {
  console.log("🚀 Constructing Discord Webhook payload...");

  // Build Embed 1: Top 3 Story Highlights
  const top3Fields = groqData.top_stories.slice(0, 3).map((item, index) => {
    const originalStory = stories.find((s) => s.id === item.id) ?? stories[index];
    const scoreText = originalStory ? `⭐ **${originalStory.score}** pts by \`${originalStory.by}\`` : "";
    const linkText = originalStory ? `[${originalStory.title}](${originalStory.url})` : item.title;

    return {
      name: `#${index + 1} • ${linkText}`,
      value: `${scoreText}\n> 💡 **TL;DR:** ${item.tldr}\n> 💬 **Dev Take:** *"${item.dev_take}"*`,
      inline: false,
    };
  });

  const embed1 = {
    title: "🔥 Hacker News AI Digest",
    url: "https://news.ycombinator.com",
    description: "Top stories from Hacker News summarized with developer commentary.",
    color: 0xff6600, // Hacker News Orange
    fields: top3Fields,
    timestamp: new Date().toISOString(),
    footer: {
      text: `Hacker News • Summarized with Groq (${GROQ_MODEL})`,
    },
  };

  // Category metadata for rich Discord summary fields
  const catIcons: Record<string, string> = {
    "AI/ML": "🤖",
    "WebDev/Software": "💻",
    "Hardware": "⚡",
    "Business/Startups": "📈",
    "Miscellaneous": "🔮",
  };
  const catCounts = groqData.category_counts || {};
  const totalCount = Object.values(catCounts).reduce((a, b) => a + b, 0) || 10;

  const chartFields = Object.entries(catCounts)
    .filter(([_, count]) => count > 0)
    .map(([cat, count]) => {
      const pct = Math.round((count / totalCount) * 100);
      const icon = catIcons[cat] || "📌";
      return {
        name: `${icon} ${cat}`,
        value: `\`${count} ${count === 1 ? "story" : "stories"}\` • **${pct}%**`,
        inline: true,
      };
    });

  // Build Embed 2: Visual Topic Breakdown
  const embed2 = {
    title: "📊 Visual Topic Breakdown",
    description: `Want a visual topic breakdown of today's tech news? **[Click here to view interactive chart](${chartUrl})**`,
    color: 0x6366f1, // Electric Indigo
    fields: chartFields,
    image: {
      url: chartUrl,
    },
    footer: {
      text: "Rendered dynamically via QuickChart API • Transparent Dark Theme",
    },
  };

  const payload = {
    username: "HN Tech Digest",
    avatar_url: "https://news.ycombinator.com/favicon.ico",
    embeds: [embed1, embed2],
  };

  console.log("📨 Sending notification to Discord...");
  const response = await fetch(DISCORD_WEBHOOK_URL!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Discord Webhook failed [${response.status}]: ${errorText}`);
  }

  console.log("🎉 Successfully sent Hacker News Digest to Discord!");
}

/**
 * Main Orchestrator
 */
async function runDigest(): Promise<void> {
  const stories = await fetchHNTopStories();
  if (stories.length === 0) {
    console.warn("No stories retrieved. Exiting.");
    return;
  }

  const groqData = await processStoriesWithGroq(stories);
  const chartUrl = generateQuickChartUrl(groqData.category_counts);
  await postToDiscord(stories, groqData, chartUrl);
}

/**
 * Main Orchestrator with Loop Support
 */
async function main() {
  const isLoop = process.argv.includes("--loop") || process.argv.includes("-l");
  let interval = POLL_INTERVAL_MINUTES;

  if (isLoop && interval <= 0) {
    interval = 3;
  }

  if (interval > 0) {
    console.log(`🔄 Automated loop mode enabled! Running every ${interval} minute(s). Press Ctrl+C to stop.\n`);
    let count = 1;
    while (true) {
      console.log(`\n--- [Run #${count}] ${new Date().toLocaleString()} ---`);
      try {
        await runDigest();
      } catch (err) {
        console.error(`⚠️ Error during run #${count}:`, err);
      }

      console.log(`⏳ Sleeping for ${interval} minute(s)...`);
      await new Promise((resolve) => setTimeout(resolve, interval * 60 * 1000));
      count++;
    }
  } else {
    try {
      await runDigest();
    } catch (error) {
      console.error("❌ Fatal Error in digest execution:", error);
      process.exit(1);
    }
  }
}

main();

