import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");

const workersDir = path.resolve(import.meta.dirname, "..");
const outDir = path.join(workersDir, "public", "b50-assets");
const scoreAssetsDir = path.join(workersDir, "src", "assets", "score-result");

const apkExtractedRoot = process.argv.includes("--apk-dir")
  ? process.argv[process.argv.indexOf("--apk-dir") + 1]
  : "/tmp/b50-preview-cache/apk-bg";

if (!fs.existsSync(apkExtractedRoot)) {
  throw new Error(`APK extracted directory not found: ${apkExtractedRoot}`);
}

fs.mkdirSync(path.join(outDir, "backgrounds"), { recursive: true });
fs.mkdirSync(path.join(outDir, "components"), { recursive: true });
fs.mkdirSync(path.join(outDir, "fonts"), { recursive: true });

// 1. Copy score-result woff2 fonts cleanly into public/b50-assets/fonts/
for (const fontName of [
  "result-text.woff2",
  "result-text-semibold.woff2",
  "result-cjk.woff2",
  "result-number.woff2",
]) {
  fs.copyFileSync(path.join(scoreAssetsDir, fontName), path.join(outDir, "fonts", fontName));
}

// 2. Define the 17 backgrounds (excluding 9, 19, 20) and classify dark vs light theme
const BACKGROUNDS = [
  { id: "bg-01", rel: "assets/startup/1080/cg.jpg", theme: "dark", topVeil: 0.44, bodyVeil: 0.30 },
  { id: "bg-02", rel: "assets/startup/1080/cg2.jpg", theme: "light", topVeil: 0.24, bodyVeil: 0.16 },
  { id: "bg-03", rel: "assets/startup/1080/cg2s.jpg", theme: "light", topVeil: 0.48, bodyVeil: 0.22 },
  { id: "bg-04", rel: "assets/startup/1080/cg2s_select.jpg", theme: "light", topVeil: 0.22, bodyVeil: 0.16 },
  { id: "bg-05", rel: "assets/startup/1080/bg_core.jpg", theme: "light", topVeil: 0.24, bodyVeil: 0.14 },
  { id: "bg-06", rel: "assets/startup/1080/bg_finale.jpg", theme: "dark", topVeil: 0.34, bodyVeil: 0.24 },
  { id: "bg-07", rel: "assets/startup/1080/bg_konzetsu.jpg", theme: "light", topVeil: 0.56, bodyVeil: 0.20 },
  { id: "bg-08", rel: "assets/startup/1080/bg_yugamu.jpg", theme: "light", topVeil: 0.20, bodyVeil: 0.14 },
  { id: "bg-10", rel: "assets/img/1080/bg_dark_lephon.jpg", theme: "dark", topVeil: 0.22, bodyVeil: 0.18 },
  { id: "bg-11", rel: "assets/img/1080/bg_lephon.jpg", theme: "light", topVeil: 0.24, bodyVeil: 0.14 },
  { id: "bg-12", rel: "assets/img/1080/bg_konzetsu.jpg", theme: "dark", topVeil: 0.22, bodyVeil: 0.24 },
  { id: "bg-13", rel: "assets/img/1080/bg_select_dark.jpg", theme: "dark", topVeil: 0.24, bodyVeil: 0.24 },
  { id: "bg-14", rel: "assets/img/1080/bg_select_light.jpg", theme: "light", topVeil: 0.22, bodyVeil: 0.14 },
  { id: "bg-15", rel: "assets/img/bg_byd_dark.jpg", theme: "dark", topVeil: 0.22, bodyVeil: 0.18 },
  { id: "bg-16", rel: "assets/img/world/1080/world.jpg", theme: "dark", topVeil: 0.50, bodyVeil: 0.32 },
  { id: "bg-17", rel: "assets/img/world/1080/world2.jpg", theme: "dark", topVeil: 0.46, bodyVeil: 0.32 },
  { id: "bg-18", rel: "assets/img/course/1080/bg_1.jpeg", theme: "dark", topVeil: 0.62, bodyVeil: 0.22 },
];

// 3. Process backgrounds, logos (halo-free!), potential badges, and avatar frame with Python PIL
const pyScript = `
import json, os
from PIL import Image, ImageDraw, ImageFilter

apk_root = ${JSON.stringify(apkExtractedRoot)}
out_dir = ${JSON.stringify(outDir)}
score_assets = ${JSON.stringify(scoreAssetsDir)}
backgrounds = ${JSON.stringify(BACKGROUNDS)}

W, H = 1920, 2388

def cover_resize(im, tw, th):
    sw, sh = im.size
    scale = max(tw / sw, th / sh)
    nw, nh = int(round(sw * scale)), int(round(sh * scale))
    resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - tw) // 2
    top = int((nh - th) * 0.22)  # slightly bias top sky so subjects/architecture show nicely
    top = max(0, min(nh - th, top))
    return resized.crop((left, top, left + tw, top + th))

def make_veil(theme, top_alpha, body_alpha):
    # Fast column/row 1px strip stretched horizontally
    strip = Image.new("RGBA", (1, H))
    px = strip.load()
    base = (10, 12, 24) if theme == "dark" else (246, 247, 253)
    for y in range(H):
        t = y / H
        if t < 0.18:
            # smooth interpolate top_alpha -> body_alpha
            k = t / 0.18
            a = top_alpha * (1 - k) + body_alpha * k
        else:
            a = body_alpha + (0.10 if theme == "dark" else 0.04) * ((t - 0.18) / 0.82)
        px[0, y] = (base[0], base[1], base[2], max(0, min(255, int(round(a * 255)))))
    return strip.resize((W, H), Image.Resampling.BILINEAR)

# Prepare frame overlay & section divider lines once per theme
def make_frame_lines(theme):
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    if theme == "dark":
        border_col = (255, 255, 255, 38)
        diamond_b10 = (176, 158, 255, 240)
        line_b10 = (168, 148, 255, 115)
        diamond_b40 = (178, 186, 218, 150)
        line_b40 = (255, 255, 255, 56)
    else:
        border_col = (64, 62, 92, 52)
        diamond_b10 = (99, 84, 184, 235)
        line_b10 = (99, 84, 184, 110)
        diamond_b40 = (116, 118, 146, 165)
        line_b40 = (70, 68, 96, 62)

    # Outer border
    d.rectangle([16, 14, W - 17, H - 15], outline=border_col, width=1)
    # Left border diamond ticks
    for cy, col in [(248, diamond_b10), (H - 52, diamond_b40)]:
        d.polygon([(16, cy - 6), (22, cy), (16, cy + 6), (10, cy)], fill=col)

    # BEST 10 line (text goes at x=54..250, line from x=262..W-38 at y=253)
    d.polygon([(41, 248), (46, 253), (41, 258), (36, 253)], fill=diamond_b10)
    d.line([(262, 253), (W - 38, 253)], fill=line_b10, width=1)

    # OVERFLOW 40 line (text at x=54..298, line from x=310..W-38 at y=672)
    d.polygon([(41, 667), (46, 672), (41, 677), (36, 672)], fill=diamond_b40)
    d.line([(310, 672), (W - 38, 672)], fill=line_b40, width=1)
    return ov

frame_dark = make_frame_lines("dark")
frame_light = make_frame_lines("light")

manifest = []
for bg in backgrounds:
    src = os.path.join(apk_root, bg["rel"])
    im = Image.open(src).convert("RGBA")
    sized = cover_resize(im, W, H)
    veil = make_veil(bg["theme"], bg["topVeil"], bg["bodyVeil"])
    composed = Image.alpha_composite(sized, veil)
    composed = Image.alpha_composite(composed, frame_dark if bg["theme"] == "dark" else frame_light).convert("RGB")
    out_file = f"{bg['id']}.webp"
    composed.save(os.path.join(out_dir, "backgrounds", out_file), format="WEBP", quality=84, method=4)
    manifest.append({"id": bg["id"], "theme": bg["theme"], "file": f"backgrounds/{out_file}"})
    print("Baked bg:", out_file, bg["theme"], os.path.getsize(os.path.join(out_dir, "backgrounds", out_file)))

with open(os.path.join(out_dir, "manifest.json"), "w") as f:
    json.dump({"width": W, "height": H, "backgrounds": manifest}, f, indent=2)

# 4. Build clean halo-free title logos (ARCAEA + girl silhouette + divider line; crisp tagline drawn by SVG!)
title_src = Image.open(os.path.join(apk_root, "assets/startup/1080/title.png")).convert("RGBA")
tw, th = title_src.size
tp = title_src.load()
for y in range(th):
    for x in range(tw):
        r, g, b, a = tp[x, y]
        if a == 0:
            continue
        # Remove the subtitle & its white glow box completely (keep girl silhouette legs on x >= 1068)
        if x < 1068 and y >= 270:
            tp[x, y] = (0, 0, 0, 0)
            continue
        # Remove the horizontal bright white glow stripe (high luminance soft white aura over letters)
        lum = 0.299 * r + 0.587 * g + 0.114 * b
        if lum > 145:
            # Smoothly suppress light glow pixels while keeping anti-aliased dark glyph/silhouette edges
            factor = max(0.0, min(1.0, (165 - lum) / 40.0))
            tp[x, y] = (r, g, b, int(a * factor))
        elif a < 210 and lum > 110:
            factor = max(0.0, min(1.0, (a - 90) / 120.0))
            tp[x, y] = (r, g, b, int(a * factor))

# Crop tight height around ARCAEA + girl silhouette (top 14..382)
title_crop = title_src.crop((240, 20, 1280, 385))
cw, ch = title_crop.size
target_lw = 390
target_lh = int(round(ch * target_lw / cw))
title_light = title_crop.resize((target_lw, target_lh), Image.Resampling.LANCZOS)
title_light.save(os.path.join(out_dir, "components", "title-light.png"))

r, g, b, a = title_light.split()
title_white = Image.merge("RGBA", (
    Image.new("L", title_light.size, 255),
    Image.new("L", title_light.size, 255),
    Image.new("L", title_light.size, 255),
    a,
))
title_white.save(os.path.join(out_dir, "components", "title-dark.png"))
print("Saved clean title-light.png & title-dark.png:", target_lw, "x", target_lh)

# 5. Pre-scale potential badges (102x102) & avatar-frame (92x92)
for idx in ["off", "0", "1", "2", "3", "4", "5", "6", "7"]:
    p = Image.open(os.path.join(score_assets, f"potential-{idx}.webp")).convert("RGBA")
    p.resize((102, 102), Image.Resampling.LANCZOS).save(os.path.join(out_dir, "components", f"ptt-{idx}.png"))
af = Image.open(os.path.join(score_assets, "avatar-frame.webp")).convert("RGBA")
af.resize((92, 92), Image.Resampling.LANCZOS).save(os.path.join(out_dir, "components", "avatar-frame.png"))
print("Pre-scaled potential badges and avatar-frame")
`;

execFileSync("python3", ["-c", pyScript], { stdio: "inherit" });

// 6. Use Playwright Chromium to bake crisp Frosted Glass UI components & pre-rendered difficulty diamonds
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 600 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8" /><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: transparent; }

    .card {
      position: relative;
      width: 358px;
      height: 184px;
      overflow: hidden;
    }
    .card-dark-b10 {
      border: 1px solid rgba(164, 146, 255, 0.44);
      background: linear-gradient(155deg, rgba(28, 29, 54, 0.78), rgba(16, 17, 34, 0.74));
      box-shadow: inset 0 1px 0 rgba(210, 198, 255, 0.22), inset 0 -1px 0 rgba(120, 140, 220, 0.12);
    }
    .card-dark-b40 {
      border: 1px solid rgba(255, 255, 255, 0.17);
      background: linear-gradient(155deg, rgba(22, 24, 42, 0.74), rgba(13, 15, 29, 0.72));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
    }
    .card-light-b10 {
      border: 1px solid rgba(99, 84, 184, 0.45);
      background: linear-gradient(155deg, rgba(255, 255, 255, 0.86), rgba(242, 243, 250, 0.80));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92), inset 0 -1px 0 rgba(99, 84, 184, 0.10);
    }
    .card-light-b40 {
      border: 1px solid rgba(96, 98, 128, 0.28);
      background: linear-gradient(155deg, rgba(252, 252, 255, 0.83), rgba(242, 243, 249, 0.78));
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.88);
    }
    .card .divider-detail {
      position: absolute;
      left: 162px;
      right: 10px;
      top: 124px;
      height: 1px;
    }
    .card-dark-b10 .divider-detail, .card-dark-b40 .divider-detail { background: rgba(255, 255, 255, 0.10); }
    .card-light-b10 .divider-detail, .card-light-b40 .divider-detail { background: rgba(52, 51, 62, 0.12); }

    .counts {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: 32px;
      display: grid;
      grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr) minmax(0, 1fr);
    }
    .card-dark-b10 .counts, .card-dark-b40 .counts {
      border-top: 1px solid rgba(255, 255, 255, 0.11);
      background: rgba(8, 10, 20, 0.56);
    }
    .card-light-b10 .counts, .card-light-b40 .counts {
      border-top: 1px solid rgba(52, 51, 62, 0.11);
      background: rgba(235, 237, 246, 0.74);
    }
    .counts > div + div { border-left: 1px solid rgba(255, 255, 255, 0.09); }
    .card-light-b10 .counts > div + div,
    .card-light-b40 .counts > div + div { border-left: 1px solid rgba(52, 51, 62, 0.10); }

    /* Artwork overlay: 152x152 shade + constant glass pill housing + right border */
    .art-overlay {
      position: relative;
      width: 152px;
      height: 152px;
      background: linear-gradient(180deg, rgba(10, 11, 20, 0.42) 0%, rgba(10, 11, 20, 0.0) 36%, rgba(10, 11, 20, 0.0) 64%, rgba(10, 11, 20, 0.52) 100%);
      border-right: 1px solid rgba(255, 255, 255, 0.14);
    }
    .art-pill {
      position: absolute;
      right: 5px;
      bottom: 5px;
      width: 78px;
      height: 33px;
      border: 1px solid rgba(255, 255, 255, 0.28);
      background: rgba(14, 15, 28, 0.78);
    }

    /* Header nameplate bar */
    .header-bar {
      position: relative;
      width: 1846px;
      height: 108px;
    }
    .header-bar-dark {
      background: linear-gradient(90deg, rgba(16, 18, 34, 0.12) 0%, rgba(24, 26, 52, 0.80) 18%, rgba(24, 26, 52, 0.80) 82%, rgba(16, 18, 34, 0.12) 100%);
      border-top: 1px solid rgba(255, 255, 255, 0.25);
      border-bottom: 1px solid rgba(255, 255, 255, 0.18);
    }
    .header-bar-light {
      background: linear-gradient(90deg, rgba(255, 255, 255, 0.18) 0%, rgba(248, 249, 254, 0.86) 18%, rgba(248, 249, 254, 0.86) 82%, rgba(255, 255, 255, 0.18) 100%);
      border-top: 1px solid rgba(99, 84, 184, 0.36);
      border-bottom: 1px solid rgba(99, 84, 184, 0.26);
    }
    .header-bar::before, .header-bar::after {
      content: "";
      position: absolute;
      top: 50%;
      width: 11px; height: 11px;
      transform: translateY(-50%) rotate(45deg);
    }
    .header-bar-dark::before, .header-bar-dark::after {
      border: 1px solid rgba(255, 255, 255, 0.58);
      background: #17182b;
    }
    .header-bar-light::before, .header-bar-light::after {
      border: 1px solid rgba(99, 84, 184, 0.58);
      background: #f5f5fb;
    }
    .header-bar::before { left: 22px; }
    .header-bar::after { right: 22px; }

    /* Stat pills */
    .stat-pill { width: 184px; height: 74px; }
    .stat-pill-dark-accent { border: 1px solid rgba(154, 132, 255, 0.45); background: rgba(24, 22, 48, 0.74); box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
    .stat-pill-dark { border: 1px solid rgba(255, 255, 255, 0.16); background: rgba(16, 18, 34, 0.68); box-shadow: inset 0 1px 0 rgba(255,255,255,0.10); }
    .stat-pill-light-accent { border: 1px solid rgba(99, 84, 184, 0.42); background: rgba(246, 245, 255, 0.84); box-shadow: inset 0 1px 0 rgba(255,255,255,0.9); }
    .stat-pill-light { border: 1px solid rgba(96, 98, 128, 0.26); background: rgba(250, 250, 254, 0.80); box-shadow: inset 0 1px 0 rgba(255,255,255,0.9); }

    /* Difficulty diamonds (24x24) */
    .diff-diamond {
      width: 24px;
      height: 24px;
      display: grid;
      place-items: center;
      clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
      font-family: sans-serif;
      font-size: 7.5px;
      font-weight: 800;
      letter-spacing: 0.02em;
    }
    .diff-pst { color: #191d2b; background: #5cbad3; }
    .diff-prs { color: #191d2b; background: #b5c76f; }
    .diff-ftr { color: #ffffff; background: #814370; }
    .diff-byd { color: #ffffff; background: #bf0d25; }
    .diff-etr { color: #ffffff; background: #8a7aa5; }
    .diff-ins { color: #ffffff; background: #4543c0; }
  </style></head><body>
    <div id="card-b10-dark" class="card card-dark-b10"><div class="divider-detail"></div><div class="counts"><div></div><div></div><div></div></div></div>
    <div id="card-b40-dark" class="card card-dark-b40"><div class="divider-detail"></div><div class="counts"><div></div><div></div><div></div></div></div>
    <div id="card-b10-light" class="card card-light-b10"><div class="divider-detail"></div><div class="counts"><div></div><div></div><div></div></div></div>
    <div id="card-b40-light" class="card card-light-b40"><div class="divider-detail"></div><div class="counts"><div></div><div></div><div></div></div></div>
    <div id="art-overlay" class="art-overlay"><div class="art-pill"></div></div>
    <div id="header-bar-dark" class="header-bar header-bar-dark"></div>
    <div id="header-bar-light" class="header-bar header-bar-light"></div>
    <div id="stat-pill-dark-accent" class="stat-pill stat-pill-dark-accent"></div>
    <div id="stat-pill-dark" class="stat-pill stat-pill-dark"></div>
    <div id="stat-pill-light-accent" class="stat-pill stat-pill-light-accent"></div>
    <div id="stat-pill-light" class="stat-pill stat-pill-light"></div>
    <div style="display:flex;gap:4px">
      <div id="diff-pst" class="diff-diamond diff-pst">PST</div>
      <div id="diff-prs" class="diff-diamond diff-prs">PRS</div>
      <div id="diff-ftr" class="diff-diamond diff-ftr">FTR</div>
      <div id="diff-byd" class="diff-diamond diff-byd">BYD</div>
      <div id="diff-etr" class="diff-diamond diff-etr">ETR</div>
      <div id="diff-ins" class="diff-diamond diff-ins">INS</div>
    </div>
  </body></html>`);

  const ids = [
    "card-b10-dark",
    "card-b40-dark",
    "card-b10-light",
    "card-b40-light",
    "art-overlay",
    "header-bar-dark",
    "header-bar-light",
    "stat-pill-dark-accent",
    "stat-pill-dark",
    "stat-pill-light-accent",
    "stat-pill-light",
    "diff-pst",
    "diff-prs",
    "diff-ftr",
    "diff-byd",
    "diff-etr",
    "diff-ins",
  ];
  for (const id of ids) {
    await page.locator(`#${id}`).screenshot({
      path: path.join(outDir, "components", `${id}.png`),
      omitBackground: true,
    });
  }
  console.log("Baked all frosted glass UI components into", path.join(outDir, "components"));
} finally {
  await browser.close();
}
