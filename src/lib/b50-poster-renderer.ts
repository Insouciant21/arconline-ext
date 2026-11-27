import type { PhotonImage as PhotonImageType } from "@cf-wasm/photon/workerd";
import type { Resvg as ResvgType } from "@cf-wasm/resvg/workerd";
import type { Env } from "./environment";
import { publicAssetUrl, putAsset } from "./r2";
import type { Best50Score, B50Snapshot } from "./types";
import { computeSnapshotStats } from "./history-view";
import {
  chartConstantFromScore,
  clearTypeCode,
  difficultyCode,
  shinyPureCount,
} from "./utils";

type PhotonModule = typeof import("@cf-wasm/photon/workerd");
type ResvgModule = typeof import("@cf-wasm/resvg/workerd");

let wasmDepsPromise: Promise<{ photon: PhotonModule; resvg: ResvgModule }> | undefined;

async function loadWasmDeps(): Promise<{ photon: PhotonModule; resvg: ResvgModule }> {
  if (!wasmDepsPromise) {
    wasmDepsPromise = Promise.all([
      import("@cf-wasm/photon/workerd"),
      import("@cf-wasm/resvg/workerd"),
    ]).then(([photon, resvg]) => ({ photon, resvg }));
  }
  return wasmDepsPromise;
}

export const POSTER_WIDTH = 1920;
export const POSTER_HEIGHT = 2388;

const GRID_LEFT = 37;
const CARD_WIDTH = 358;
const CARD_HEIGHT = 184;
const COL_GAP = 14;
const ROW_GAP = 14;
const ART_OFFSET = 1;
const ART_SIZE = 151;
const B10_TOP = 270;
const B40_TOP = 690;

export type PosterTheme = "dark" | "light";

export interface PosterBackgroundEntry {
  id: string;
  theme: PosterTheme;
  file: string;
}

export interface PosterManifest {
  width: number;
  height: number;
  backgrounds: PosterBackgroundEntry[];
}

export interface PosterRenderOptions {
  /** Inject custom asset loader (defaults to env.ASSETS or R2 fallback). */
  loadAsset: (relPath: string) => Promise<Uint8Array | null>;
  /** Fetch media asset bytes (charts / character icon) from R2 ARCHIVE. */
  loadMedia: (key: string) => Promise<Uint8Array | null>;
  /** Optional deterministic background id override for testing or previews. */
  backgroundId?: string;
  /** Optional random number generator in [0, 1). */
  random?: () => number;
}

export interface RenderedPosterResult {
  jpeg: Uint8Array;
  width: number;
  height: number;
  backgroundId: string;
  theme: PosterTheme;
}

interface DecodedRgba {
  width: number;
  height: number;
  pixels: Uint8Array;
}

interface ThemePalette {
  inkStrong: string;
  muted: string;
  muted2: string;
  pttAccent: string;
  exactPtt: string;
  sectionB10: string;
  sectionB40: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  uidBg: string;
  uidBorder: string;
  uidText: string;
  tagline: string;
  gradeHigh: [string, string];
  gradeMid: [string, string];
  gradeLow: [string, string];
  clear: Record<string, string>;
  pure: string;
  far: string;
  lost: string;
}

const PALETTES: Record<PosterTheme, ThemePalette> = {
  dark: {
    inkStrong: "#ffffff",
    muted: "#a8aecb",
    muted2: "#7d83a2",
    pttAccent: "#c2b4ff",
    exactPtt: "#8ee5f8",
    sectionB10: "#d6cffc",
    sectionB40: "#a9b2d4",
    badgeBg: "rgba(20, 22, 42, 0.62)",
    badgeBorder: "rgba(156, 142, 255, 0.45)",
    badgeText: "#dfd9ff",
    uidBg: "rgba(255, 255, 255, 0.08)",
    uidBorder: "rgba(255, 255, 255, 0.18)",
    uidText: "#e5e8fa",
    tagline: "rgba(226, 230, 250, 0.80)",
    gradeHigh: ["#e0a2ff", "#67e1fa"],
    gradeMid: ["#de9df0", "#ef7dd6"],
    gradeLow: ["#bfa8cc", "#d8badf"],
    clear: {
      TL: "#ff7287",
      TC: "#a6e0f0",
      EC: "#b9cf81",
      HC: "#ff8091",
      FR: "#d7beff",
      PM: "#74eeff",
    },
    pure: "#c4b5ff",
    far: "#ffb969",
    lost: "#ff7988",
  },
  light: {
    inkStrong: "#1f1e28",
    muted: "#656473",
    muted2: "#91909e",
    pttAccent: "#6354b8",
    exactPtt: "#277d96",
    sectionB10: "#5446a6",
    sectionB40: "#5e6074",
    badgeBg: "rgba(246, 246, 252, 0.78)",
    badgeBorder: "rgba(99, 84, 184, 0.36)",
    badgeText: "#4f429c",
    uidBg: "rgba(99, 84, 184, 0.10)",
    uidBorder: "rgba(99, 84, 184, 0.24)",
    uidText: "#433886",
    tagline: "rgba(52, 51, 66, 0.72)",
    gradeHigh: ["#6b2a5c", "#337b99"],
    gradeMid: ["#63406e", "#8f3482"],
    gradeLow: ["#533f5a", "#7b5c86"],
    clear: {
      TL: "#8f223b",
      TC: "#704675",
      EC: "#3c6e77",
      HC: "#a82b4b",
      FR: "#9623a5",
      PM: "#119190",
    },
    pure: "#6354b8",
    far: "#d17a3f",
    lost: "#bf0d25",
  },
};

const SCORE_FORMAT = new Intl.NumberFormat("en-US");
const SYNC_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatSyncTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = Object.fromEntries(SYNC_FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

function formatPlayedDate(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(SYNC_FORMAT.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function charWidthRatio(ch: string): number {
  const code = ch.codePointAt(0) ?? 32;
  if (
    (code >= 0x3000 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xff00 && code <= 0xffef)
  ) {
    return 1.0;
  }
  if ("ilI1.,!|:;'`".includes(ch)) return 0.34;
  if ("mwMW@#%&QOG".includes(ch)) return 0.84;
  if (ch === " ") return 0.32;
  if (code >= 65 && code <= 90) return 0.68;
  return 0.56;
}

function estimateWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    width += charWidthRatio(ch) * fontSize;
  }
  return width;
}

function truncateText(text: string, maxWidth: number, fontSize: number): string {
  if (estimateWidth(text, fontSize) <= maxWidth) return text;
  const ellipsisWidth = fontSize * 0.85;
  let width = 0;
  let out = "";
  for (const ch of text) {
    const step = charWidthRatio(ch) * fontSize;
    if (width + step + ellipsisWidth > maxWidth) break;
    out += ch;
    width += step;
  }
  return `${out.trimEnd()}…`;
}

function wrapLines(text: string, maxWidth: number, fontSize: number, maxLines: number): string[] {
  const chars = Array.from(text);
  const lines: string[] = [];
  let current = "";
  let currentWidth = 0;
  let lastBreakIdx = -1;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const step = charWidthRatio(ch) * fontSize;
    if (ch === " " || ch === "-" || ch === "/" || (ch.codePointAt(0) ?? 0) >= 0x3000) {
      lastBreakIdx = current.length + (ch === " " ? 0 : 1);
    }
    if (currentWidth + step > maxWidth && current.length > 0) {
      if (lines.length === maxLines - 1) {
        const rest = `${current}${chars.slice(i).join("")}`;
        lines.push(truncateText(rest, maxWidth, fontSize));
        return lines;
      }
      if (lastBreakIdx > Math.floor(current.length * 0.45)) {
        const splitAt = lastBreakIdx;
        const head = current.slice(0, splitAt).trimEnd();
        const tail = `${current.slice(splitAt).trimStart()}${ch}`;
        lines.push(head);
        current = tail;
        currentWidth = estimateWidth(current, fontSize);
        lastBreakIdx = -1;
        continue;
      }
      lines.push(current.trimEnd());
      current = ch === " " ? "" : ch;
      currentWidth = ch === " " ? 0 : step;
      lastBreakIdx = -1;
      continue;
    }
    current += ch;
    currentWidth += step;
  }
  if (current.trim().length > 0) {
    lines.push(current.trimEnd());
  }
  return lines.length > 0 ? lines.slice(0, maxLines) : ["—"];
}

function scoreGradeInfo(score: number): { label: string; group: "high" | "mid" | "low" } {
  if (score >= 10_000_000) return { label: "PM", group: "high" };
  if (score >= 9_900_000) return { label: "EX+", group: "high" };
  if (score >= 9_800_000) return { label: "EX", group: "high" };
  if (score >= 9_500_000) return { label: "AA", group: "mid" };
  if (score >= 9_000_000) return { label: "A", group: "mid" };
  return { label: "B", group: "low" };
}

function potentialTier(rating: number): string {
  if (rating < 0) return "off";
  const count = [3.5, 7, 10, 11, 12, 12.5, 13].filter((min) => rating >= min).length;
  return String(count);
}

function decodeImageBytes(photon: PhotonModule, bytes: Uint8Array): DecodedRgba {
  const image: PhotonImageType = photon.PhotonImage.new_from_byteslice(bytes);
  try {
    return {
      width: image.get_width(),
      height: image.get_height(),
      pixels: new Uint8Array(image.get_raw_pixels()),
    };
  } finally {
    image.free();
  }
}

function decodeAndResizeCoverSquare(photon: PhotonModule, bytes: Uint8Array, size: number): DecodedRgba {
  const image: PhotonImageType = photon.PhotonImage.new_from_byteslice(bytes);
  try {
    const w = image.get_width();
    const h = image.get_height();
    if (w === size && h === size) {
      return { width: size, height: size, pixels: new Uint8Array(image.get_raw_pixels()) };
    }
    const resized = photon.resize(image, size, size, photon.SamplingFilter.CatmullRom);
    try {
      return {
        width: resized.get_width(),
        height: resized.get_height(),
        pixels: new Uint8Array(resized.get_raw_pixels()),
      };
    } finally {
      resized.free();
    }
  } finally {
    image.free();
  }
}

/**
 * In-place Porter-Duff straight-alpha source-over composite onto dst RGBA buffer.
 */
function blitRgba(
  dst: Uint8Array,
  dstW: number,
  dstH: number,
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dx: number,
  dy: number,
  clipW = srcW,
  clipH = srcH,
) {
  const maxW = Math.min(srcW, clipW);
  const maxH = Math.min(srcH, clipH);
  const startX = Math.max(0, dx);
  const startY = Math.max(0, dy);
  const endX = Math.min(dstW, dx + maxW);
  const endY = Math.min(dstH, dy + maxH);

  for (let y = startY; y < endY; y++) {
    const sy = y - dy;
    let dIdx = (y * dstW + startX) * 4;
    let sIdx = (sy * srcW + (startX - dx)) * 4;
    for (let x = startX; x < endX; x++) {
      const sa = src[sIdx + 3];
      if (sa === 255) {
        dst[dIdx] = src[sIdx];
        dst[dIdx + 1] = src[sIdx + 1];
        dst[dIdx + 2] = src[sIdx + 2];
        dst[dIdx + 3] = 255;
      } else if (sa > 0) {
        const inv = 255 - sa;
        dst[dIdx] = (src[sIdx] * sa + dst[dIdx] * inv + 127) / 255;
        dst[dIdx + 1] = (src[sIdx + 1] * sa + dst[dIdx + 1] * inv + 127) / 255;
        dst[dIdx + 2] = (src[sIdx + 2] * sa + dst[dIdx + 2] * inv + 127) / 255;
        dst[dIdx + 3] = 255;
      }
      dIdx += 4;
      sIdx += 4;
    }
  }
}

function blitDiamondClipped(
  dst: Uint8Array,
  dstW: number,
  dstH: number,
  src: Uint8Array,
  size: number,
  dx: number,
  dy: number,
) {
  const half = (size - 1) / 2;
  for (let sy = 0; sy < size; sy++) {
    const y = dy + sy;
    if (y < 0 || y >= dstH) continue;
    const ny = Math.abs(sy - half) / half;
    for (let sx = 0; sx < size; sx++) {
      const x = dx + sx;
      if (x < 0 || x >= dstW) continue;
      const dist = Math.abs(sx - half) / half + ny;
      if (dist > 1.0) continue;
      const sIdx = (sy * size + sx) * 4;
      const edgeAa = dist > 0.96 ? Math.max(0, (1.0 - dist) / 0.04) : 1.0;
      const sa = Math.round(src[sIdx + 3] * edgeAa);
      if (sa === 0) continue;
      const dIdx = (y * dstW + x) * 4;
      const inv = 255 - sa;
      dst[dIdx] = (src[sIdx] * sa + dst[dIdx] * inv + 127) / 255;
      dst[dIdx + 1] = (src[sIdx + 1] * sa + dst[dIdx + 1] * inv + 127) / 255;
      dst[dIdx + 2] = (src[sIdx + 2] * sa + dst[dIdx + 2] * inv + 127) / 255;
      dst[dIdx + 3] = 255;
    }
  }
}

function cardOrigin(index: number): { x: number; y: number; isB10: boolean } {
  const col = index % 5;
  const row = Math.floor(index / 5);
  const x = GRID_LEFT + col * (CARD_WIDTH + COL_GAP);
  if (row < 2) {
    return { x, y: B10_TOP + row * (CARD_HEIGHT + ROW_GAP), isB10: true };
  }
  return { x, y: B40_TOP + (row - 2) * (CARD_HEIGHT + ROW_GAP), isB10: false };
}

const HEADER_BAND_HEIGHT = 270;
const OVERFLOW_LABEL_TOP = 656;
const OVERFLOW_LABEL_HEIGHT = 34;

function buildHeaderBandSvg(
  snapshot: B50Snapshot,
  theme: PosterTheme,
): string {
  const p = PALETTES[theme];
  const stats = computeSnapshotStats(snapshot);
  const rest40Avg = stats.rest40Sum / 40;
  const syncedText = formatSyncTime(snapshot.fetchedAt);
  const userName = snapshot.user.name || "Arcaea Player";
  const userCode = snapshot.user.userCode ? `ID ${snapshot.user.userCode}` : "ID —";
  const pttParts = snapshot.potential >= 0 ? snapshot.potential.toFixed(3).split(".") : ["—", ""];
  const mainNum = pttParts[1] ? `${pttParts[0]}.` : pttParts[0];

  const fontNum = `font-family="Exo, Noto Sans CJK SC, sans-serif"`;
  const fontText = `font-family="Noto Sans CJK SC, L2, Open Sans, Exo, sans-serif"`;
  const nameStartX = 720;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${HEADER_BAND_HEIGHT}">
    <g>
      <rect x="442" y="38" width="182" height="28" fill="${p.badgeBg}" stroke="${p.badgeBorder}" stroke-width="1"/>
      <text x="533" y="57" text-anchor="middle" ${fontText} font-size="13.5" font-weight="600" letter-spacing="2" fill="${p.badgeText}">BEST 50 OVERVIEW</text>
      <text x="442" y="88" ${fontText} font-size="13.5" letter-spacing="0.6" fill="${p.tagline}">Two young girls explore a shattered world—filled with sound: a past to be uncovered</text>
      <text x="442" y="116" ${fontNum} font-size="14.5" letter-spacing="0.9" fill="${p.muted}">
        <tspan fill="${p.exactPtt}" font-weight="700">SYNCED</tspan> ${escapeXml(syncedText)}
      </text>
    </g>

    <g>
      <text x="1518" y="63" ${fontText} font-size="13" font-weight="600" letter-spacing="1.6" fill="${p.muted}">BEST 10 AVG</text>
      <text x="1518" y="103" ${fontNum} font-size="33" font-weight="700" fill="${p.pttAccent}">${stats.top10Avg.toFixed(4)}</text>

      <text x="1717" y="63" ${fontText} font-size="13" font-weight="600" letter-spacing="1.6" fill="${p.muted}">REST 40 AVG</text>
      <text x="1717" y="103" ${fontNum} font-size="33" font-weight="700" fill="${p.inkStrong}">${rest40Avg.toFixed(4)}</text>
    </g>

    <g>
      <text x="${nameStartX}" y="186" ${fontText} font-size="38" font-weight="700" fill="${p.inkStrong}">${escapeXml(truncateText(userName, 290, 38))}</text>
      <rect x="${nameStartX}" y="198" width="126" height="25" fill="${p.uidBg}" stroke="${p.uidBorder}" stroke-width="1"/>
      <text x="${nameStartX + 63}" y="216" text-anchor="middle" ${fontNum} font-size="14" letter-spacing="0.9" fill="${p.uidText}">${escapeXml(userCode)}</text>
      <text x="${nameStartX + 138}" y="216" ${fontText} font-size="14" letter-spacing="1.4" fill="${p.muted}">BEST 50 RECORD</text>

      <text x="1103" y="202" text-anchor="middle" ${fontNum} font-weight="700" fill="#ffffff" stroke="#1c102d" stroke-width="4.5" paint-order="stroke">
        <tspan font-size="34">${escapeXml(mainNum)}</tspan><tspan font-size="23">${escapeXml(pttParts[1] ?? "")}</tspan>
      </text>

      <line x1="1174" y1="164" x2="1174" y2="222" stroke="${p.uidBorder}" stroke-width="1"/>
      <text x="1192" y="180" ${fontText} font-size="13.5" font-weight="600" letter-spacing="1.6" fill="${p.muted}">EXACT PTT</text>
      <text x="1192" y="215" ${fontNum} font-size="31" font-weight="700" fill="${p.exactPtt}">${stats.weightedExact.toFixed(4)}</text>
    </g>

    <text x="54" y="258" ${fontNum} font-size="16" font-weight="700" letter-spacing="2" fill="${p.sectionB10}">BEST 10 · #01 – #10</text>
  </svg>`;
}

function buildOverflowLabelSvg(theme: PosterTheme): string {
  const p = PALETTES[theme];
  const fontNum = `font-family="Exo, Noto Sans CJK SC, sans-serif"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${OVERFLOW_LABEL_HEIGHT}">
    <text x="54" y="${677 - OVERFLOW_LABEL_TOP}" ${fontNum} font-size="16" font-weight="700" letter-spacing="2" fill="${p.sectionB40}">OVERFLOW 40 · #11 – #50</text>
  </svg>`;
}

function buildRowBandSvg(
  scores: Array<{ score: Best50Score; rank: number; x: number; y: number }>,
  bandTopY: number,
  bandHeight: number,
  theme: PosterTheme,
): string {
  const p = PALETTES[theme];
  const fontNum = `font-family="Exo, Noto Sans CJK SC, sans-serif"`;
  const fontText = `font-family="Noto Sans CJK SC, L2, Open Sans, Exo, sans-serif"`;

  const itemsSvg = scores.map(({ score, rank, x, y }) => {
    const ly = y - bandTopY;
    const isB10 = rank <= 10;
    const title = score.title?.zh || score.title?.en || score.title?.ja || score.songId;
    const artist = score.artist || "Unknown artist";
    const cc = chartConstantFromScore(score);
    const grade = scoreGradeInfo(score.score);
    const clearCode = clearTypeCode(score.clearType);
    const clearColor = p.clear[clearCode] ?? p.muted;
    const bonus = shinyPureCount(score);
    const playedAt = formatPlayedDate(score.timePlayed);

    const bodyX = x + 160;
    const bodyRight = x + CARD_WIDTH - 8;
    const bodyW = bodyRight - bodyX; // 190px

    const titleLines = wrapLines(title, bodyW, 18, 2);
    const hasTwoLines = titleLines.length > 1;
    const titleStartY = ly + (hasTwoLines ? 22 : 26);
    const metaY = ly + (hasTwoLines ? 66 : 54);
    const resultY = ly + (hasTwoLines ? 104 : 98);
    const detailY = ly + 142;
    const countsY = ly + 173;

    const pttText = `${score.rating.toFixed(3)} `;
    const artistMaxW = bodyW - 82;
    const artistText = truncateText(artist, artistMaxW, 12);
    const songIdText = truncateText(score.songId, 74, 10);
    const rankColor = isB10 ? "#e9e2ff" : "#ffffff";

    // PURE / FAR / LOST columns match card-shell proportions: 1.9fr | 1fr | 1fr across 358px
    const pureValue = SCORE_FORMAT.format(score.perfectCount);
    const pureBonus = bonus !== null ? `+${bonus}` : "";

    return `<g>
      <!-- Art overlay text: #rank & chart constant -->
      <text x="${x + 9}" y="${ly + 24}" ${fontNum} font-size="17" font-weight="700" letter-spacing="0.6" fill="${rankColor}" stroke="rgba(0,0,0,0.82)" stroke-width="3.5" paint-order="stroke">#${String(rank).padStart(2, "0")}</text>
      <text x="${x + 95}" y="${ly + 136}" text-anchor="middle" ${fontNum} font-size="15.5" font-weight="700" fill="#ffffff">${cc.toFixed(1)}</text>

      <!-- Track Title (1-2 lines) -->
      ${titleLines
        .map(
          (line, idx) =>
            `<text x="${bodyX}" y="${titleStartY + idx * 20}" ${fontText} font-size="18" font-weight="700" fill="${p.inkStrong}">${escapeXml(line)}</text>`,
        )
        .join("")}

      <!-- Artist + Single-song PTT -->
      <text x="${bodyX}" y="${metaY}" ${fontText} font-size="12" fill="${p.muted}">${escapeXml(artistText)}</text>
      <text x="${bodyRight}" y="${metaY}" text-anchor="end" ${fontNum} font-size="15.5" font-weight="700" fill="${p.pttAccent}">${escapeXml(pttText)}<tspan font-size="9" fill="${p.muted2}" font-weight="600">PTT</tspan></text>

      <!-- Result row: borderless gradient Grade + Score + ClearType -->
      <text x="${bodyX}" y="${resultY}" ${fontNum} font-size="18.5" font-weight="700" letter-spacing="0.2" fill="url(#grade-${grade.group})">${escapeXml(grade.label)}</text>
      <text x="${bodyX + 41}" y="${resultY}" ${fontNum} font-size="20" font-weight="700" letter-spacing="0.1" fill="${p.inkStrong}">${SCORE_FORMAT.format(score.score)}</text>
      <text x="${bodyRight}" y="${resultY}" text-anchor="end" ${fontNum} font-size="14" font-weight="700" letter-spacing="0.6" fill="${clearColor}">${escapeXml(clearCode)}</text>

      <!-- Detail row: DATE + songId -->
      <text x="${bodyX}" y="${detailY}" ${fontNum} font-size="11" letter-spacing="0.3" fill="${p.muted}"><tspan font-size="9.5" fill="${p.muted2}" font-weight="600" letter-spacing="0.8">DATE </tspan>${escapeXml(playedAt)}</text>
      <text x="${bodyRight}" y="${detailY}" text-anchor="end" ${fontText} font-size="10" fill="${p.muted2}">${escapeXml(songIdText)}</text>

      <!-- Bottom counts bar -->
      <text x="${x + 87}" y="${countsY}" text-anchor="middle" ${fontNum} font-size="13" font-weight="700" fill="${p.pure}">
        <tspan font-size="10" font-weight="400" fill="${p.muted2}" letter-spacing="0.3">PURE </tspan>${pureValue}${pureBonus ? `<tspan font-size="10" font-weight="600"> ${pureBonus}</tspan>` : ""}
      </text>
      <text x="${x + 220}" y="${countsY}" text-anchor="middle" ${fontNum} font-size="13" font-weight="700" fill="${p.far}">
        <tspan font-size="10" font-weight="400" fill="${p.muted2}" letter-spacing="0.3">FAR </tspan>${SCORE_FORMAT.format(score.nearCount)}
      </text>
      <text x="${x + 312}" y="${countsY}" text-anchor="middle" ${fontNum} font-size="13" font-weight="700" fill="${p.lost}">
        <tspan font-size="10" font-weight="400" fill="${p.muted2}" letter-spacing="0.3">LOST </tspan>${SCORE_FORMAT.format(score.missCount)}
      </text>
    </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${bandHeight}">
    <defs>
      <linearGradient id="grade-high" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${p.gradeHigh[0]}"/>
        <stop offset="100%" stop-color="${p.gradeHigh[1]}"/>
      </linearGradient>
      <linearGradient id="grade-mid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${p.gradeMid[0]}"/>
        <stop offset="100%" stop-color="${p.gradeMid[1]}"/>
      </linearGradient>
      <linearGradient id="grade-low" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${p.gradeLow[0]}"/>
        <stop offset="100%" stop-color="${p.gradeLow[1]}"/>
      </linearGradient>
    </defs>
    ${itemsSvg.join("")}
  </svg>`;
}

/**
 * Assemble a 5x10 custom B50 JPEG using pre-baked static UI glass components,
 * one randomly selected official APK background (adaptive light/dark theme),
 * streaming square chart covers from R2, and pure-WASM SVG text overlays.
 */
export async function renderB50Poster(
  snapshot: B50Snapshot,
  options: PosterRenderOptions,
): Promise<RenderedPosterResult> {
  const { photon, resvg: resvgMod } = await loadWasmDeps();
  const manifestBytes = await options.loadAsset("manifest.json");
  if (!manifestBytes) throw new Error("Missing b50-assets/manifest.json");
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as PosterManifest;

  const chosen =
    (options.backgroundId
      ? manifest.backgrounds.find((bg) => bg.id === options.backgroundId)
      : undefined) ??
    manifest.backgrounds[Math.floor((options.random ?? Math.random)() * manifest.backgrounds.length)];

  if (!chosen) throw new Error("No background entry found in b50-assets/manifest.json");
  const theme = chosen.theme;

  // 1. Load & decode selected background onto master canvas buffer (1920x2388x4)
  const bgBytes = await options.loadAsset(chosen.file);
  if (!bgBytes) throw new Error(`Missing background asset: ${chosen.file}`);
  const bg = decodeImageBytes(photon, bgBytes);
  const canvasPixels = bg.pixels;

  // 2. Load fonts for Resvg text overlays (~1.06 MB total)
  const fontPaths = [
    "fonts/result-text.woff2",
    "fonts/result-text-semibold.woff2",
    "fonts/result-cjk.woff2",
    "fonts/result-number.woff2",
  ];
  const fontBuffers = (
    await Promise.all(fontPaths.map((fp) => options.loadAsset(fp)))
  ).filter((b): b is Uint8Array => Boolean(b));

  // 3. Composite header components & release immediately
  const pttTier = potentialTier(snapshot.potential);
  const headerAssetList = [
    `components/title-${theme}.png`,
    `components/header-bar-${theme}.png`,
    `components/stat-pill-${theme}-accent.png`,
    `components/stat-pill-${theme}.png`,
    `components/avatar-frame.png`,
    `components/ptt-${pttTier}.png`,
  ];
  const [titleImg, headerBarImg, statAccentImg, statNormalImg, avatarFrameImg, pttBadgeImg] =
    await Promise.all(
      headerAssetList.map(async (rel) => {
        const b = await options.loadAsset(rel);
        if (!b) throw new Error(`Missing component asset: ${rel}`);
        return decodeImageBytes(photon, b);
      }),
    );

  blitRgba(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, titleImg.pixels, titleImg.width, titleImg.height, 34, 14);
  blitRgba(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, statAccentImg.pixels, statAccentImg.width, statAccentImg.height, 1500, 42);
  blitRgba(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, statNormalImg.pixels, statNormalImg.width, statNormalImg.height, 1699, 42);
  blitRgba(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, headerBarImg.pixels, headerBarImg.width, headerBarImg.height, 37, 138);

  // Player avatar (diamond clipped inside avatar-frame at x=604, y=146)
  if (snapshot.user.avatarImageKey) {
    try {
      const avatarBytes = await options.loadMedia(snapshot.user.avatarImageKey);
      if (avatarBytes) {
        const avatarSq = decodeAndResizeCoverSquare(photon, avatarBytes, 78);
        blitDiamondClipped(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, avatarSq.pixels, 78, 611, 153);
      }
    } catch {
      // Non-fatal fallback if avatar asset is missing or invalid
    }
  }
  blitRgba(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, avatarFrameImg.pixels, avatarFrameImg.width, avatarFrameImg.height, 604, 146);
  blitRgba(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, pttBadgeImg.pixels, pttBadgeImg.width, pttBadgeImg.height, 1052, 141);

  // 4. Composite Header and Overflow label SVG bands cleanly (<= 2 MB each)
  const bandSpecs: Array<{ svg: string; top: number }> = [
    { svg: buildHeaderBandSvg(snapshot, theme), top: 0 },
    { svg: buildOverflowLabelSvg(theme), top: OVERFLOW_LABEL_TOP },
  ];
  for (const band of bandSpecs) {
    const resvg: ResvgType = await resvgMod.Resvg.async(band.svg, {
      font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Noto Sans CJK SC" },
    });
    try {
      const rendered = resvg.render();
      try {
        blitRgba(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, rendered.pixels, rendered.width, rendered.height, 0, band.top);
      } finally {
        rendered.free();
      }
    } finally {
      resvg.free();
    }
  }

  // 5. Load shared card shell components & difficulty diamonds
  const [cardB10Img, cardB40Img, artOverlayImg] = await Promise.all(
    [`components/card-b10-${theme}.png`, `components/card-b40-${theme}.png`, "components/art-overlay.png"].map(
      async (rel) => {
        const b = await options.loadAsset(rel);
        if (!b) throw new Error(`Missing component asset: ${rel}`);
        return decodeImageBytes(photon, b);
      },
    ),
  );

  const best50 = snapshot.best50.slice(0, 50);

  // Load only the difficulty diamonds actually used in this B50, in parallel.
  const usedDiffCodes = [...new Set(best50.map((s) => difficultyCode(s.difficulty, s.difficultyAlias)))];
  const diffMap = new Map<string, DecodedRgba>();
  await Promise.all(
    usedDiffCodes.map(async (code) => {
      const b = await options.loadAsset(`components/diff-${code.toLowerCase()}.png`);
      if (b) diffMap.set(code, decodeImageBytes(photon, b));
    }),
  );

  // Track duplicate song bg keys so we only retain resized 151x151 buffers when reused
  const bgCount = new Map<string, number>();
  for (const s of best50) {
    if (s.imageKey) bgCount.set(s.imageKey, (bgCount.get(s.imageKey) ?? 0) + 1);
  }
  const reusableCovers = new Map<string, DecodedRgba>();

  // 6. Stream cards in 2-row bands: prefetch each row's 5 covers concurrently from R2,
  //    paste shells/artwork/diamonds, and rasterize text 2 rows per Resvg call (~50% fewer font parses).
  for (let bandRow = 0; bandRow < 10; bandRow += 2) {
    const bandItems: Array<{ score: Best50Score; rank: number; x: number; y: number }> = [];
    for (let row = bandRow; row < Math.min(bandRow + 2, 10); row++) {
      const rowSlice = best50.slice(row * 5, row * 5 + 5);
      if (rowSlice.length === 0) break;

      const missingKeys = [
        ...new Set(
          rowSlice
            .map((s) => s.imageKey)
            .filter((k): k is string => typeof k === "string" && k.length > 0 && !reusableCovers.has(k)),
        ),
      ];
      const fetchedRowCovers = new Map<string, Uint8Array | null>(
        await Promise.all(
          missingKeys.map(async (key): Promise<[string, Uint8Array | null]> => {
            try {
              return [key, await options.loadMedia(key)];
            } catch {
              return [key, null];
            }
          }),
        ),
      );

      for (let col = 0; col < rowSlice.length; col++) {
        const idx = row * 5 + col;
        const score = rowSlice[col];
        const rank = idx + 1;
        const pos = cardOrigin(idx);
        const shell = pos.isB10 ? cardB10Img : cardB40Img;

        blitRgba(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, shell.pixels, shell.width, shell.height, pos.x, pos.y);

        if (score.imageKey) {
          let cover = reusableCovers.get(score.imageKey);
          if (!cover) {
            const chartBytes = fetchedRowCovers.get(score.imageKey);
            if (chartBytes) {
              try {
                cover = decodeAndResizeCoverSquare(photon, chartBytes, ART_SIZE);
                if ((bgCount.get(score.imageKey) ?? 0) > 1) {
                  reusableCovers.set(score.imageKey, cover);
                }
              } catch {
                cover = undefined;
              }
            }
          }
          if (cover) {
            blitRgba(
              canvasPixels,
              POSTER_WIDTH,
              POSTER_HEIGHT,
              cover.pixels,
              cover.width,
              cover.height,
              pos.x + ART_OFFSET,
              pos.y + ART_OFFSET,
            );
          }
        }

        blitRgba(
          canvasPixels,
          POSTER_WIDTH,
          POSTER_HEIGHT,
          artOverlayImg.pixels,
          artOverlayImg.width,
          artOverlayImg.height,
          pos.x + ART_OFFSET,
          pos.y + ART_OFFSET,
          ART_SIZE,
          ART_SIZE,
        );

        const diffCode = difficultyCode(score.difficulty, score.difficultyAlias);
        const diffImg = diffMap.get(diffCode);
        if (diffImg) {
          // Inside 78x33 pill at artOverlay (right:5px, bottom:5px)
          blitRgba(
            canvasPixels,
            POSTER_WIDTH,
            POSTER_HEIGHT,
            diffImg.pixels,
            diffImg.width,
            diffImg.height,
            pos.x + 120,
            pos.y + 119,
          );
        }

        bandItems.push({ score, rank, x: pos.x, y: pos.y });
      }
    }

    if (bandItems.length === 0) break;
    const bandTop = bandItems[0].y;
    const bandBottom = bandItems[bandItems.length - 1].y + CARD_HEIGHT;
    const bandHeight = bandBottom - bandTop;
    const bandSvg = buildRowBandSvg(bandItems, bandTop, bandHeight, theme);
    const resvg: ResvgType = await resvgMod.Resvg.async(bandSvg, {
      font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: "Noto Sans CJK SC" },
    });
    try {
      const rendered = resvg.render();
      try {
        blitRgba(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT, rendered.pixels, rendered.width, rendered.height, 0, bandTop);
      } finally {
        rendered.free();
      }
    } finally {
      resvg.free();
    }
  }

  // 7. Encode final JPEG (~1.1 - 1.8 MB) and release canvas PhotonImage immediately
  const finalPhoton: PhotonImageType = new photon.PhotonImage(canvasPixels, POSTER_WIDTH, POSTER_HEIGHT);
  let jpeg: Uint8Array;
  try {
    jpeg = finalPhoton.get_bytes_jpeg(91);
  } finally {
    finalPhoton.free();
  }

  return {
    jpeg: new Uint8Array(jpeg),
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    backgroundId: chosen.id,
    theme,
  };
}

/**
 * Create an asset loader backed strictly by the Cloudflare Workers ASSETS binding.
 */
export function createWorkerAssetLoader(env: Env): (relPath: string) => Promise<Uint8Array | null> {
  return async (relPath: string) => {
    const clean = relPath.replace(/^\/+/, "");
    if (!clean || clean.includes("..") || clean.includes("\\") || /[\0\r\n]/.test(clean) || !env.ASSETS) {
      return null;
    }
    const res = await env.ASSETS.fetch(new Request(`https://assets.local/b50-assets/${clean}`));
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
    return null;
  };
}

/**
 * Render the custom 5x10 B50 poster in the background and store it into R2 ARCHIVE.
 */
export async function renderAndStoreCustomB50(
  env: Env,
  snapshot: B50Snapshot,
  options: {
    backgroundId?: string;
    random?: () => number;
  } = {},
): Promise<{ snapshot: B50Snapshot; rendered: RenderedPosterResult }> {
  const rendered = await renderB50Poster(snapshot, {
    loadAsset: createWorkerAssetLoader(env),
    loadMedia: async (key: string) => {
      const obj = await env.ARCHIVE.get(key);
      return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
    },
    backgroundId: options.backgroundId,
    random: options.random,
  });

  const tag = crypto.randomUUID().slice(0, 6);
  const key = `custom/${snapshot.id}-${rendered.backgroundId}-${tag}.jpg`;
  const jpegBuffer: ArrayBuffer =
    rendered.jpeg.byteOffset === 0 && rendered.jpeg.byteLength === rendered.jpeg.buffer.byteLength
      ? (rendered.jpeg.buffer as ArrayBuffer)
      : rendered.jpeg.slice().buffer;
  await putAsset(env, key, jpegBuffer, "image/jpeg", {
    kind: "custom-b50",
    snapshotId: snapshot.id,
    theme: rendered.theme,
    backgroundId: rendered.backgroundId,
  });

  snapshot.customImageKey = key;
  snapshot.customImageUrl = publicAssetUrl(env, key);
  snapshot.customImageTheme = rendered.theme;
  snapshot.customBackgroundId = rendered.backgroundId;
  return { snapshot, rendered };
}
