import background from "@/assets/score-result/background.webp";
import banner from "@/assets/score-result/banner.webp";
import gradeD from "@/assets/score-result/grade-d.webp";
import gradeC from "@/assets/score-result/grade-c.webp";
import gradeB from "@/assets/score-result/grade-b.webp";
import gradeA from "@/assets/score-result/grade-a.webp";
import gradeAA from "@/assets/score-result/grade-aa.webp";
import gradeEX from "@/assets/score-result/grade-ex.webp";
import gradeEXPlus from "@/assets/score-result/grade-explus.webp";
import clearFail from "@/assets/score-result/clear-fail.webp";
import clearNormal from "@/assets/score-result/clear-normal.webp";
import clearFull from "@/assets/score-result/clear-full.webp";
import clearPure from "@/assets/score-result/clear-pure.webp";
import countPure from "@/assets/score-result/count-pure.webp";
import countFar from "@/assets/score-result/count-far.webp";
import countLost from "@/assets/score-result/count-lost.webp";
import scorePanel from "@/assets/score-result/score-panel.webp";
import userPanel from "@/assets/score-result/user-panel.webp";
import avatarFrame from "@/assets/score-result/avatar-frame.webp";
import topBar from "@/assets/score-result/top-bar.webp";
import bottomBar from "@/assets/score-result/bottom-bar.webp";
import footerStrip from "@/assets/score-result/footer-strip.webp";
import difficultyPst from "@/assets/score-result/difficulty-pst.webp";
import difficultyPrs from "@/assets/score-result/difficulty-prs.webp";
import difficultyFtr from "@/assets/score-result/difficulty-ftr.webp";
import difficultyEtr from "@/assets/score-result/difficulty-etr.webp";
import difficultyByd from "@/assets/score-result/difficulty-byd.webp";
import difficultyIns from "@/assets/score-result/difficulty-ins.webp";
import textFont from "@/assets/score-result/result-text.woff2?url";
import textSemiboldFont from "@/assets/score-result/result-text-semibold.woff2?url";
import scoreFont from "@/assets/score-result/result-score.woff2?url";
import cjkFont from "@/assets/score-result/result-cjk.woff2?url";
import numberFont from "@/assets/score-result/result-number.woff2?url";
import numberMediumFont from "@/assets/score-result/result-number-medium.woff2?url";
import type { ImageMetadata } from "astro";
import type { ScoreExportProfile, SongScore } from "./types";
import { clearTypeLabel, difficultyCode, difficultyLabel } from "./utils";
import { scoreResultData } from "./score-result";
import bannerPalettes from "./score-result-banners.json";

const grades = { d: gradeD, c: gradeC, b: gradeB, a: gradeA, aa: gradeAA, ex: gradeEX, explus: gradeEXPlus };
const clears = { fail: clearFail, normal: clearNormal, full: clearFull, pure: clearPure };
const difficulties = { PST: difficultyPst, PRS: difficultyPrs, FTR: difficultyFtr, ETR: difficultyEtr, BYD: difficultyByd, INS: difficultyIns };
// Vite emits URLs for every available partner; only the selected pair is fetched.
const partners = import.meta.glob<ImageMetadata>("../assets/score-result/characters/*.webp", { eager: true, import: "default" });
const potentialBadges = import.meta.glob<ImageMetadata>("../assets/score-result/potential-*.webp", { eager: true, import: "default" });
// Native nameplate text/shadow colors for the banners included in the APK.
const nameplateColors: Record<string, { color: string; shadow: string }> = bannerPalettes;
const textFamily = '"Arcaea Result Text", "Arcaea Result CJK", sans-serif';
const semiboldFamily = '"Arcaea Result Text Semibold", "Arcaea Result CJK", sans-serif';
const scoreFamily = '"Arcaea Result Score", "Arcaea Result Text", sans-serif';
const numberFamily = '"Arcaea Result Number", "Arcaea Result CJK", sans-serif';
const mediumNumberFamily = '"Arcaea Result Number Medium", "Arcaea Result CJK", sans-serif';
const images = new Map<string, Promise<HTMLImageElement>>();
// The reference is the game's wide viewport. Its 1280px design area remains
// centered inside a 1562x720 scene, rather than stretching the result columns.
const scene = { width: 1562, height: 720, contentLeft: 141 };
let fonts: Promise<void> | undefined;
let profileRequest: Promise<ScoreExportProfile> | undefined;

function potentialBadge(rating: number) {
  const index = rating < 0 ? "off" : [3.5, 7, 10, 11, 12, 12.5, 13].filter(minimum => rating >= minimum).length;
  return potentialBadges[`../assets/score-result/potential-${index}.webp`];
}

function loadProfile() {
  // Share concurrent exports, but refresh on the next export so partner changes
  // are reflected without requiring another B50 snapshot or a page reload.
  if (!profileRequest) {
    profileRequest = (async () => {
      const response = await fetch("/api/score-export/profile", { cache: "no-store", signal: AbortSignal.timeout(45_000) });
      const payload = await response.json() as Partial<ScoreExportProfile> & { error?: string };
      if (!response.ok) throw new Error(payload.error || "用户信息加载失败，请重试导出。");
      if (!payload.user?.name || !partners[`../assets/score-result/characters/${payload.characterAssetId}.webp`]) {
        throw new Error("当前搭档的结算素材不完整，请更新后重试。");
      }
      return payload as ScoreExportProfile;
    })().finally(() => { profileRequest = undefined; });
  }
  return profileRequest;
}

async function loadPartner() {
  const profile = await loadProfile();
  const prefix = `../assets/score-result/characters/${profile.characterAssetId}`;
  const icon = partners[`${prefix}-icon.webp`];
  if (!icon) throw new Error("当前搭档的头像素材未收录，请更新后重试。");
  const [illustration, avatar, badge, nameplate] = await Promise.all([
    loadImage(partners[`${prefix}.webp`].src),
    profile.user.avatarImageUrl
      ? loadImage(profile.user.avatarImageUrl, true).catch(() => loadImage(icon.src))
      : loadImage(icon.src),
    loadImage(potentialBadge(profile.user.rating).src),
    profile.bannerImageUrl ? loadImage(profile.bannerImageUrl) : Promise.resolve(null),
  ]);
  return { profile, illustration, avatar, badge, nameplate };
}

function deadline<T>(operation: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), 20_000);
    operation.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

function loadFonts() {
  if (!fonts) {
    fonts = deadline(Promise.all([
      ["Arcaea Result Text", textFont], ["Arcaea Result Text Semibold", textSemiboldFont],
      ["Arcaea Result Score", scoreFont], ["Arcaea Result CJK", cjkFont],
      ["Arcaea Result Number", numberFont], ["Arcaea Result Number Medium", numberMediumFont],
    ].map(async ([name, url]) => {
      const face = await new FontFace(name, `url("${url}")`).load();
      document.fonts.add(face);
    })).then(() => undefined), "字体加载超时，请重试导出。").catch(error => {
      fonts = undefined;
      throw error;
    });
  }
  return fonts;
}

function loadImage(src: string, artwork = false) {
  const url = new URL(src, window.location.href);
  // Artwork uses the existing authenticated media route. Never taint the canvas
  // or send a signed/private URL to an external image-rendering service.
  if (url.origin !== window.location.origin) return Promise.reject(new Error("请使用本站曲绘地址后再导出。"));
  const cached = !artwork && images.get(url.href);
  if (cached) return cached;
  const operation = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const message = artwork ? "曲绘加载失败，请确认登录状态后重试导出。" : "结算素材加载失败，请重试导出。";
    const timer = window.setTimeout(() => { clean(); image.src = ""; reject(new Error(message)); }, 20_000);
    function clean() { window.clearTimeout(timer); image.onload = null; image.onerror = null; }
    image.onload = () => { clean(); resolve(image); };
    image.onerror = () => { clean(); reject(new Error(message)); };
    image.decoding = "async";
    image.src = url.href;
  });
  if (!artwork) {
    images.set(url.href, operation);
    operation.catch(() => images.delete(url.href));
  }
  return operation;
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, options: {
  align?: CanvasTextAlign; baseline?: CanvasTextBaseline; width?: number; family?: string; minSize?: number;
  outline?: string; outlineWidth?: number; shadow?: { color: string; x: number; y: number; blur?: number };
} = {}) {
  ctx.save();
  const family = options.family || textFamily;
  ctx.font = `${size}px ${family}`;
  // Keep long and multilingual names inside the title band without stretching glyphs.
  while (options.width && ctx.measureText(value).width > options.width && size > (options.minSize ?? 16)) ctx.font = `${--size}px ${family}`;
  if (options.width && ctx.measureText(value).width > options.width) {
    const characters = Array.from(value);
    while (characters.length && ctx.measureText(characters.join("") + "…").width > options.width) characters.pop();
    value = characters.join("") + "…";
  }
  ctx.fillStyle = color;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "middle";
  if (options.outline) {
    ctx.strokeStyle = options.outline;
    ctx.lineWidth = options.outlineWidth ?? 1;
    ctx.lineJoin = "round";
    ctx.strokeText(value, x, y);
  }
  if (options.shadow) {
    // Canvas shadows use device pixels, while the game's layout uses logical
    // pixels. Keep their apparent weight consistent with the 2x export scale.
    const transform = ctx.getTransform();
    const scaleX = Math.hypot(transform.a, transform.b), scaleY = Math.hypot(transform.c, transform.d);
    ctx.shadowColor = options.shadow.color;
    ctx.shadowOffsetX = options.shadow.x * scaleX;
    ctx.shadowOffsetY = options.shadow.y * scaleY;
    ctx.shadowBlur = (options.shadow.blur ?? 0) * (scaleX + scaleY) / 2;
  }
  ctx.fillText(value, x, y);
  ctx.restore();
}

function contain(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

function drawPartner(ctx: CanvasRenderingContext2D, image: HTMLImageElement) {
  // The game crops a large illustration below the viewport. Locate the upper
  // opaque area so differently posed partners keep their head in the right column.
  const sample = document.createElement("canvas");
  sample.width = 64; sample.height = 64;
  const sampleCtx = sample.getContext("2d");
  if (!sampleCtx) throw new Error("浏览器无法处理搭档立绘，请重试。");
  sampleCtx.drawImage(image, 0, 0, 64, 64);
  const rgba = sampleCtx.getImageData(0, 0, 64, 64).data;
  let first = 0;
  for (; first < 64; first++) {
    let count = 0;
    for (let x = 0; x < 64; x++) if (rgba[(first * 64 + x) * 4 + 3] > 192) count++;
    if (count >= 4) break;
  }
  let weight = 0, weightedX = 0;
  for (let y = first; y < Math.min(first + 8, 64); y++) {
    for (let x = 0; x < 64; x++) {
      const alpha = rgba[(y * 64 + x) * 4 + 3];
      if (alpha > 192) { weight += alpha; weightedX += (x + .5) * alpha; }
    }
  }
  const anchor = weight ? weightedX / weight / 64 : .5;
  const scale = 1200 / Math.max(image.naturalWidth, image.naturalHeight);
  const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
  ctx.drawImage(image, scene.width / 2 + 320 - anchor * width, 12, width, height);
}

function resultPanel(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法生成结算面板，请重试。");
  ctx.drawImage(image, 0, 0);
  // HIGH SCORE is baked into the bitmap. Copy a blank part of the same native
  // band into its place. Replace alpha on a separate canvas, so the translucent
  // texture is composited over the result background only once.
  ctx.save();
  ctx.beginPath(); ctx.rect(49, 167, 164, 34); ctx.clip();
  ctx.globalCompositeOperation = "copy";
  ctx.drawImage(image, 49, 161, 164, 8, 49, 167, 164, 34);
  ctx.restore();
  return canvas;
}

export async function renderScoreResult(score: SongScore) {
  const result = scoreResultData(score);
  const code = difficultyCode(score.difficulty, score.difficultyAlias) as keyof typeof difficulties;
  const [bg, header, grade, clear, pure, far, lost, artwork, panel, difficulty, userBack, frame, top, bottom, footer, partner] = await Promise.all([
    loadImage(background.src), loadImage(banner.src), loadImage(grades[result.grade].src), loadImage(clears[result.clear].src),
    loadImage(countPure.src), loadImage(countFar.src), loadImage(countLost.src),
    score.imageUrl ? loadImage(score.imageUrl, true) : Promise.resolve(null),
    loadImage(scorePanel.src), loadImage((difficulties[code] || difficultyFtr).src),
    loadImage(userPanel.src), loadImage(avatarFrame.src), loadImage(topBar.src), loadImage(bottomBar.src),
    loadImage(footerStrip.src), loadPartner(),
    loadFonts(),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = scene.width * 2; canvas.height = scene.height * 2;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法生成图片，请换用支持 Canvas 的浏览器。");
  ctx.scale(2, 2);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bg, 0, 0, scene.width, scene.width * .75);
  ctx.drawImage(header, 0, 48, scene.width, 685);
  ctx.drawImage(footer, 0, 656, scene.width, 50);
  ctx.save();
  ctx.translate(scene.contentLeft, 0);

  const titleShadow = { color: "rgba(20, 14, 29, .6)", x: 1.2, y: 1.2, blur: .4 };
  text(ctx, result.title, 640, 103.5, 48, "#fff", { align: "center", width: 1100, minSize: 24, shadow: titleShadow });
  text(ctx, score.artist || "Unknown artist", 640, 147.6, 28, "#fff", { align: "center", width: 1060, shadow: titleShadow });
  ctx.drawImage(difficulty, 4.7, 191, 260.7, 73.3);
  text(ctx, result.level ?? code, 54, 228, result.level ? 34 : 20, "#fff", { align: "center", family: mediumNumberFamily, outline: code === "BYD" ? "#b5122e" : "#654c78", outlineWidth: 2 });
  text(ctx, difficultyLabel(score.difficulty, score.difficultyAlias).toUpperCase(), 96, 216, 20, "#5f5865", { width: 170, family: semiboldFamily, outline: "rgba(255,255,255,.65)", outlineWidth: .6 });

  if (artwork) {
    const scale = Math.max(375 / artwork.naturalWidth, 375 / artwork.naturalHeight);
    const width = artwork.naturalWidth * scale, height = artwork.naturalHeight * scale;
    ctx.save();
    ctx.shadowColor = "rgba(35, 22, 51, .25)";
    ctx.shadowBlur = 10; ctx.shadowOffsetX = 4; ctx.shadowOffsetY = 4;
    ctx.fillStyle = "#231b31";
    ctx.fillRect(31.3, 268.1, 375, 375);
    ctx.restore();
    ctx.save();
    ctx.beginPath(); ctx.rect(31.3, 268.1, 375, 375); ctx.clip();
    ctx.drawImage(artwork, 31.3 + (375 - width) / 2, 268.1 + (375 - height) / 2, width, height);
    ctx.fillStyle = "rgba(28, 18, 46, .08)";
    ctx.fillRect(31.3, 268.1, 375, 375);
    ctx.restore();
  } else {
    text(ctx, "NO ART", 218.8, 455.6, 30, "#83708e", { align: "center" });
  }

  contain(ctx, clear, 362.5, 199.5, 555, 51);
  ctx.restore();
  // Partners cover the title/clear banner as on the game screen. The score and
  // judgements remain above the illustration, keeping exported values legible.
  drawPartner(ctx, partner.illustration);
  ctx.save();
  ctx.translate(scene.contentLeft, 0);
  ctx.drawImage(resultPanel(panel), 437.86, 251.13, panel.naturalWidth * 2 / 3, panel.naturalHeight * 2 / 3);
  text(ctx, result.scoreText, 640, 313, 57, "#fff", { align: "center", family: scoreFamily, outline: "rgba(255,255,255,.9)", outlineWidth: .45, shadow: { color: "rgba(22,17,30,.5)", x: 1.2, y: 1.2, blur: .3 } });
  text(ctx, "定数", 469, 376, 16, "#ded7e4");
  text(ctx, result.constant?.toFixed(1) ?? "—", 567, 376, 27, "#fff", { align: "right", family: scoreFamily });
  text(ctx, "单曲 PTT", 615, 376, 16, "#ded7e4");
  text(ctx, result.rating?.toFixed(3) ?? "—", 858, 376, 27, "#fff", { align: "right", family: scoreFamily });
  contain(ctx, grade, 560, 402.5, 160, 78);

  [
    { image: pure, label: "PURE", value: String(score.perfectCount) },
    { image: far, label: "FAR", value: String(score.nearCount) },
    { image: lost, label: "LOST", value: String(score.missCount) },
  ].forEach(({ image, label, value }, index) => {
    const y = 519 + index * 37;
    ctx.drawImage(image, 540, y, 166, 30);
    const outline = ["rgba(126,116,162,.9)", "rgba(166,114,89,.9)", "rgba(149,120,133,.9)"][index];
    const shadow = { color: "rgba(62,44,74,.3)", x: .4, y: .5, blur: .3 };
    text(ctx, label, 629, y + 15, 19, "#fff", { align: "right", outline, outlineWidth: 1.1, shadow });
    text(ctx, value, 680, y + 15, 20, "#fff", { align: "center", width: 75, family: semiboldFamily, outline, outlineWidth: 1.1, shadow });
    if (index === 0) text(ctx, `(+${score.shinyPerfectCount})`, 730, y + 15, 18, "#d8cbe3", { family: semiboldFamily, outline: "rgba(90,73,103,.5)", outlineWidth: .8 });
  });
  if (score.clearType === 4 || score.clearType === 5) {
    text(ctx, clearTypeLabel(score.clearType).toUpperCase(), 640, 641, 15, "#76637f", { align: "center" });
  }
  ctx.drawImage(bottom, 528.3, 654, 223.3, 66.7);
  text(ctx, "ArcOnline", 640, 671, 17, "#463c55", { align: "center", width: 143, family: semiboldFamily });
  text(ctx, "Extension", 640, 689, 17, "#463c55", { align: "center", width: 143, family: semiboldFamily });
  ctx.restore();
  text(ctx, result.dateText, 28, 686, 16, "#675574");

  ctx.drawImage(top, 0, 0, scene.width, 69);
  const center = scene.width / 2;
  if (partner.nameplate) {
    // The native 564x74 plate is displayed at 2/3 scale behind the avatar.
    // End it underneath the icon instead of exposing its square right edge.
    ctx.save();
    ctx.beginPath(); ctx.rect(center - 310, 0, 310, 69); ctx.clip();
    ctx.drawImage(partner.nameplate, center - 310, 0, 376, 74 * 2 / 3);
    ctx.restore();
  } else {
    ctx.save();
    ctx.globalAlpha = .3;
    ctx.drawImage(userBack, center - 310, -23, 330, 90);
    ctx.restore();
  }
  text(ctx, "结果", scene.contentLeft + 18, 28, 24, "#302c35");
  const palette = partner.nameplate ? nameplateColors[partner.profile.user.bannerId ?? ""] : undefined;
  const nameColor = palette?.color ?? (partner.nameplate ? "#fff" : "#28242b");
  text(ctx, partner.profile.user.name!, center - 58, 28, 28, nameColor, { align: "right", width: 250, family: scoreFamily,
    outline: nameColor, outlineWidth: .9, shadow: palette ? { color: palette.shadow, x: .7, y: .7 } : undefined });
  ctx.drawImage(frame, center - 50, -20, 100, 100);
  contain(ctx, partner.avatar, center - 43, -13, 86, 86);
  // Current potential belongs on the avatar's native tier badge. The separate
  // diamond to its right represents a change, which the score API does not give.
  // UserCell sizes the rating widget to 85px before its 2/3 top-bar scale,
  // independently of the 119px source texture. Its decimal digits are smaller.
  const badgeSize = 85 * 2 / 3, badgeCenter = center + 37.3;
  ctx.drawImage(partner.badge, badgeCenter - badgeSize / 2, 28.5, badgeSize, badgeSize);
  const potential = partner.profile.user.rating >= 0 ? partner.profile.user.rating.toFixed(3).split(".") : null;
  if (potential) {
    const large = `${potential[0]}.`, small = potential[1];
    const largeSize = 34 * 2 / 3, smallSize = 24 * 2 / 3;
    ctx.font = `${largeSize}px ${numberFamily}`;
    const largeWidth = ctx.measureText(large).width;
    ctx.font = `${smallSize}px ${numberFamily}`;
    const start = badgeCenter - (largeWidth + ctx.measureText(small).width) / 2;
    const options = { baseline: "alphabetic" as const, family: numberFamily, outline: "#51485c", outlineWidth: 3 };
    text(ctx, large, start, 60, largeSize, "#fff", options);
    text(ctx, small, start + largeWidth, 60, smallSize, "#fff", options);
  } else {
    text(ctx, "—", badgeCenter, 53, 20, "#fff", { align: "center", family: numberFamily, outline: "#51485c", outlineWidth: 3 });
  }

  const blob = await deadline(new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG 生成失败，请重试。")), "image/png");
  }), "PNG 生成超时，请重试。");
  return { blob, filename: result.filename };
}

export async function downloadScoreResult(score: SongScore) {
  const { blob, filename } = await renderScoreResult(score);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link);
  try { link.click(); } finally {
    link.remove();
    // Give browsers time to consume the download before releasing its memory.
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
