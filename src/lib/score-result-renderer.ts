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
import textFont from "@/assets/score-result/result-text.woff2?url";
import scoreFont from "@/assets/score-result/result-score.woff2?url";
import cjkFont from "@/assets/score-result/result-cjk.woff2?url";
import type { SongScore } from "./types";
import { clearTypeLabel, difficultyCode, difficultyLabel } from "./utils";
import { scoreResultData } from "./score-result";

const grades = { d: gradeD, c: gradeC, b: gradeB, a: gradeA, aa: gradeAA, ex: gradeEX, explus: gradeEXPlus };
const clears = { fail: clearFail, normal: clearNormal, full: clearFull, pure: clearPure };
const textFamily = '"Arcaea Result Text", "Arcaea Result CJK", sans-serif';
const scoreFamily = '"Arcaea Result Score", "Arcaea Result Text", sans-serif';
const images = new Map<string, Promise<HTMLImageElement>>();
let fonts: Promise<void> | undefined;

function deadline<T>(operation: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), 20_000);
    operation.then(resolve, reject).finally(() => window.clearTimeout(timer));
  });
}

function loadFonts() {
  if (!fonts) {
    fonts = deadline(Promise.all([
      ["Arcaea Result Text", textFont], ["Arcaea Result Score", scoreFont], ["Arcaea Result CJK", cjkFont],
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

function polygon(ctx: CanvasRenderingContext2D, points: number[][], fill: string | CanvasGradient, stroke?: string) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 2; ctx.stroke(); }
}

function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, color: string, options: { align?: CanvasTextAlign; width?: number; family?: string } = {}) {
  const family = options.family || textFamily;
  ctx.font = `${size}px ${family}`;
  // Keep long and multilingual names inside the title band without stretching glyphs.
  while (options.width && ctx.measureText(value).width > options.width && size > 20) ctx.font = `${--size}px ${family}`;
  if (options.width && ctx.measureText(value).width > options.width) {
    const characters = Array.from(value);
    while (characters.length && ctx.measureText(characters.join("") + "…").width > options.width) characters.pop();
    value = characters.join("") + "…";
  }
  ctx.fillStyle = color;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

function contain(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

function drawDifficulty(ctx: CanvasRenderingContext2D, score: SongScore) {
  const color = score.difficulty === 3 && score.difficultyAlias === 1 ? "#5250b7"
    : ["#4698bb", "#668c64", "#854776", "#b12953", "#78648e"][score.difficulty] || "#854776";
  const tint = ctx.createLinearGradient(54, 0, 478, 0);
  tint.addColorStop(0, "#ffffff"); tint.addColorStop(1, "#c6c0d1");
  polygon(ctx, [[54, 178], [468, 178], [478, 232], [54, 232]], tint, "#fff");
  ctx.save();
  ctx.beginPath(); ctx.rect(145, 180, 320, 50); ctx.clip();
  ctx.strokeStyle = "#ffffff9c"; ctx.lineWidth = 1;
  for (let x = 100; x < 500; x += 12) { ctx.beginPath(); ctx.moveTo(x, 180); ctx.lineTo(x + 50, 230); ctx.stroke(); }
  ctx.restore();
  polygon(ctx, [[54, 205], [104, 161], [154, 205], [104, 249]], "#6a566b");
  polygon(ctx, [[64, 205], [104, 168], [144, 205], [104, 242]], color);
  text(ctx, difficultyCode(score.difficulty, score.difficultyAlias), 104, 207, 23, "#fff", { align: "center" });
  text(ctx, difficultyLabel(score.difficulty, score.difficultyAlias).toUpperCase(), 177, 207, 27, "#55435d", { width: 275 });
}

export async function renderScoreResult(score: SongScore) {
  const result = scoreResultData(score);
  const [bg, header, grade, clear, pure, far, lost, artwork] = await Promise.all([
    loadImage(background.src), loadImage(banner.src), loadImage(grades[result.grade].src), loadImage(clears[result.clear].src),
    loadImage(countPure.src), loadImage(countFar.src), loadImage(countLost.src),
    score.imageUrl ? loadImage(score.imageUrl, true) : Promise.resolve(null),
    loadFonts(),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = 2560; canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器无法生成图片，请换用支持 Canvas 的浏览器。");
  ctx.scale(2, 2);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bg, 0, 0, 1280, 720);
  ctx.drawImage(header, 0, 16, 1280, 670);

  text(ctx, result.title, 640, 67, 46, "#fff", { align: "center", width: 1150 });
  text(ctx, score.artist || "Unknown artist", 640, 112, 25, "#fff", { align: "center", width: 1120 });
  drawDifficulty(ctx, score);

  ctx.save();
  ctx.shadowColor = "#2c1f463d"; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#ded8e8"; ctx.fillRect(54, 247, 424, 424);
  ctx.restore();
  if (artwork) {
    const scale = Math.max(424 / artwork.naturalWidth, 424 / artwork.naturalHeight);
    const width = artwork.naturalWidth * scale, height = artwork.naturalHeight * scale;
    ctx.save();
    ctx.beginPath(); ctx.rect(54, 247, 424, 424); ctx.clip();
    ctx.drawImage(artwork, 54 + (424 - width) / 2, 247 + (424 - height) / 2, width, height);
    ctx.restore();
  } else {
    text(ctx, "NO ART", 266, 459, 30, "#83708e", { align: "center" });
  }
  ctx.strokeStyle = "#ffffffc7"; ctx.lineWidth = 1; ctx.strokeRect(54.5, 247.5, 423, 423);

  contain(ctx, clear, 536, 188, 678, 70);
  const panel = ctx.createLinearGradient(540, 270, 1214, 400);
  panel.addColorStop(0, "#4f3a61"); panel.addColorStop(1, "#736083");
  polygon(ctx, [[540, 272], [1167, 272], [1214, 336], [1167, 400], [540, 400]], panel, "#fff");
  text(ctx, result.scoreText, 855, 320, 70, "#fff", { align: "center", family: scoreFamily });
  ctx.strokeStyle = "#dbd2e6a6"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(541, 354); ctx.lineTo(1199, 354); ctx.stroke();
  text(ctx, "定数", 604, 376, 19, "#e4daed");
  text(ctx, result.constant?.toFixed(1) ?? "—", 756, 376, 30, "#fff", { align: "right", family: scoreFamily });
  ctx.beginPath(); ctx.moveTo(799, 363); ctx.lineTo(799, 390); ctx.stroke();
  text(ctx, "单曲 PTT", 840, 376, 19, "#e4daed");
  text(ctx, result.rating?.toFixed(3) ?? "—", 1124, 376, 30, "#fff", { align: "right", family: scoreFamily });
  contain(ctx, grade, 775, 419, 184, 76);

  [
    { image: pure, label: "PURE", value: `${score.perfectCount.toLocaleString("en-US")} (+${score.shinyPerfectCount.toLocaleString("en-US")})` },
    { image: far, label: "FAR", value: score.nearCount.toLocaleString("en-US") },
    { image: lost, label: "LOST", value: score.missCount.toLocaleString("en-US") },
  ].forEach(({ image, label, value }, index) => {
    const y = 513 + index * 49;
    ctx.drawImage(image, 659, y, 420, 42);
    text(ctx, label, 691, y + 22, 19, "#5f416b");
    text(ctx, value, 1055, y + 22, 25, "#513d62", { align: "right", width: 275 });
  });
  if (score.clearType === 4 || score.clearType === 5) {
    text(ctx, clearTypeLabel(score.clearType).toUpperCase(), 870, 671, 15, "#76637f", { align: "center" });
  }
  ctx.fillStyle = "#ebe5f1f5"; ctx.fillRect(0, 686, 1280, 34);
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, 686); ctx.lineTo(1280, 686); ctx.stroke();
  text(ctx, result.dateText, 54, 703, 15, "#675574");
  text(ctx, "ArcOnline Extension", 1224, 703, 15, "#675574", { align: "right" });

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
