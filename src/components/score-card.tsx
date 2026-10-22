import type { Best50Score, SongScore } from "@/lib/types";
import {
  clearTypeCode,
  clearTypeLabel,
  chartConstantFromScore,
  difficultyCode,
  difficultyLabel,
  difficultyTone,
  formatNumber,
  formatRelativeDate,
  formatScore,
  shinyPureCount,
} from "@/lib/utils";

export function ScoreCard({ score, rank }: { score: Best50Score | SongScore; rank?: number }) {
  const title = score.title.zh || score.title.en || score.title.ja || score.songId;
  const playedAt = score.timePlayed > 0 ? formatRelativeDate(score.timePlayed) : "—";
  const chartConstant = "rating" in score ? chartConstantFromScore(score) : null;

  return (
    <article className="score-card" aria-label={`${rank ? `${rank} ` : ""}${title} ${difficultyCode(score.difficulty, score.difficultyAlias)}`}>
      <div className="score-card-main">
        <div className="score-art">
          <div className="score-potential" aria-label={chartConstant !== null ? `谱面定数 ${chartConstant.toFixed(1)}` : difficultyLabel(score.difficulty, score.difficultyAlias)}>
            {chartConstant !== null ? <strong>{chartConstant.toFixed(1)}</strong> : null}
            <DifficultyDiamond difficulty={score.difficulty} alias={score.difficultyAlias} />
          </div>
          {rank ? <span className="score-rank">{String(rank).padStart(2, "0")}</span> : null}
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
            {"rating" in score ? <strong className="score-rating">
              {formatNumber(score.rating, 3)} <small>PTT</small>
            </strong> : null}
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
        <ScoreCount label="PURE" value={score.perfectCount} tone="pure" bonus={"shinyPerfectCount" in score ? score.shinyPerfectCount : shinyPureCount(score)} />
        <ScoreCount label="FAR" value={score.nearCount} tone="far" />
        <ScoreCount label="LOST" value={score.missCount} tone="lost" />
      </div>
      {"bestClearType" in score ? <div className="song-score-meta">
        <span>最佳通关 <strong title={clearTypeLabel(score.bestClearType)}>{clearTypeCode(score.bestClearType)}</strong></span>
        <span>年内游玩 <strong>{formatScore(score.yearlyPlayCount)}</strong> 次</span>
      </div> : null}
    </article>
  );
}

function DifficultyDiamond({ difficulty, alias }: { difficulty: number; alias?: number }) {
  return (
    <span className={`difficulty-diamond difficulty-${difficultyTone(difficulty, alias)}`}>
      <span>{difficultyCode(difficulty, alias)}</span>
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

function ScoreCount({ label, value, tone, bonus }: { label: string; value: number; tone: string; bonus?: number | null }) {
  return (
    <div className={`score-count score-count-${tone}`}>
      <span>{label}</span>
      <strong>{formatScore(value)}{bonus != null ? <small className="score-count-bonus" title="大 PURE">(+{formatScore(bonus)})</small> : null}</strong>
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
