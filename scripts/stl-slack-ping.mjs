import puppeteer from "puppeteer";

const TOKEN = process.env.SLACK_BOT_TOKEN;
const CHANNELS = (process.env.CHANNELS || "").split(",").map((s) => s.trim()).filter(Boolean);
const PAGES_URL = process.env.PAGES_URL;

if (!TOKEN) throw new Error("SLACK_BOT_TOKEN is not set");
if (!CHANNELS.length) throw new Error("CHANNELS is empty");
if (!PAGES_URL) throw new Error("PAGES_URL is not set");

const et = (opts) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", ...opts }).format(new Date());
const dayLabel = et({ weekday: "short", month: "short", day: "numeric" });
const timeLabel = et({ hour: "numeric", hour12: true });
const title = `Speed to Lead - ${dayLabel}`;
const comment = `:stopwatch: Speed to Lead · ${dayLabel} ${timeLabel} ET`;

async function screenshot() {
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1200, deviceScaleFactor: 2 });
    await page.goto(PAGES_URL, { waitUntil: "networkidle2", timeout: 120000 });
    if (await page.$("#stl-embed-error")) {
      const msg = await page.$eval("#stl-embed-error", (el) => el.textContent);
      throw new Error(`Dashboard reported a load error: ${msg}`);
    }
    await page.waitForSelector("#stl-embed-ready", { timeout: 120000 });
    await new Promise((r) => setTimeout(r, 1500));
    const el = await page.$("#stl-embed-root");
    if (!el) throw new Error("#stl-embed-root not found - is r24+ deployed to Pages?");
    return Buffer.from(await el.screenshot({ type: "png" }));
  } finally {
    await browser.close();
  }
}

async function slack(method, body, form = false) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: form
      ? { Authorization: `Bearer ${TOKEN}` }
      : { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: form ? body : JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method} failed: ${json.error}`);
  return json;
}

async function postToChannel(buf, channel) {
  const up = await slack(
    "files.getUploadURLExternal",
    new URLSearchParams({ filename: "speed-to-lead.png", length: String(buf.length) }),
    true
  );
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "image/png" }), "speed-to-lead.png");
  const post = await fetch(up.upload_url, { method: "POST", body: fd });
  if (!post.ok) throw new Error(`byte upload failed for ${channel}: HTTP ${post.status}`);
  await slack("files.completeUploadExternal", {
    files: [{ id: up.file_id, title }],
    channel_id: channel,
    initial_comment: comment,
  });
  console.log(`posted -> ${channel}`);
}

const png = await screenshot();
console.log(`screenshot: ${png.length} bytes`);
for (const ch of CHANNELS) await postToChannel(png, ch);
console.log(`done: ${CHANNELS.length} channel(s)`);
