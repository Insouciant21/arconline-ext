import type { Best50Score } from "@/lib/types";
import {
  clearTypeCode,
  clearTypeLabel,
  chartConstantFromScore,
  difficultyCode,
  difficultyTone,
  formatNumber,
  formatRelativeDate,
  formatScore,
} from "@/lib/utils";

export function ScoreCard({ score, rank }: { score: Best50Score; rank: number }) {
  const title = score.title.zh || score.title.en || score.title.ja || score.songId;
  const playedAt = score.timePlayed > 0 ? formatRelativeDate(score.timePlayed) : "—";

  return (
    <article className="score-card" aria-label={`${rank} ${title}`}>
      <div className="score-card-main">
        <div className="score-potential">
          <span className="score-label">CHART CONSTANT</span>
          <strong>{chartConstantFromScore(score).toFixed(1)}</strong>
          <DifficultyDiamond difficulty={score.difficulty} />
        </div>

        <div className="score-art">
          <span className="score-rank">{String(rank).padStart(2, "0")}</span>
          {score.imageUrl ? (
            <img src={score.imageUrl} alt={`${title} 曲绘`} loading="lazy" decoding="async" />
          ) : (
            <span className="art-placeholder">NO ART</span>
          )}
          <div className="score-art-shade" />
        </div>

        <div className="score-card-body">
          <div className="score-title-row">
            <div className="score-title-copy">
              <span className="score-label">TRACK</span>
              <h3 title={title}>{title}</h3>
            </div>
            <strong className="score-rating">
              {formatNumber(score.rating, 3)} <small>PTT</small>
            </strong>
          </div>
          <p className="score-artist" title={score.artist}>{score.artist || "Unknown artist"}</p>

          <div className="score-result-row">
            <div className={`score-grade grade-${scoreGrade(score.score).toLowerCase().replace("+", "-plus")}`} aria-label={`等级 ${scoreGrade(score.score)}`}>
              {scoreGrade(score.score)}
            </div>
            <div className="score-number">
              <span className="score-label">SCORE</span>
              <strong>{formatScore(score.score)}</strong>
            </div>
            <ClearTypeText code={clearTypeCode(score.clearType)} label={clearTypeLabel(score.clearType)} />
          </div>

          <div className="score-detail-row">
            <span><b>DATE</b>{playedAt}</span>
            <span className="score-song-id" title={score.songId}>{score.songId}</span>
          </div>
        </div>
      </div>

      <div className="score-counts" aria-label="判定统计">
        <ScoreCount label="PURE" value={score.perfectCount} tone="pure" />
        <ScoreCount label="FAR" value={score.nearCount} tone="far" />
        <ScoreCount label="LOST" value={score.missCount} tone="lost" />
      </div>
    </article>
  );
}

function DifficultyDiamond({ difficulty }: { difficulty: number }) {
  return (
    <span className={`difficulty-diamond difficulty-${difficultyTone(difficulty)}`}>
      <span>{difficultyCode(difficulty)}</span>
    </span>
  );
}

function ClearTypeText({ code, label }: { code: string; label: string }) {
  const variant = /^(TL|TC|EC|HC|FR|PM)$/.test(code) ? code.toLowerCase() : "default";

  return (
    <span className={`clear-type clear-type-${variant}`} title={label} aria-label={label}>
      {code}
    </span>
  );
}

function ScoreCount({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={`score-count score-count-${tone}`}>
      <span>{label}</span>
      <strong>{formatScore(value)}</strong>
    </div>
  );
}

function scoreGrade(score: number) {
  if (score >= 10_000_000) return "PM";
  if (score >= 9_900_000) return "EX+";
  if (score >= 9_800_000) return "EX";
  if (score >= 9_500_000) return "AA";
  if (score >= 9_000_000) return "A";
  return "B";
}
