"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { AppNavigation } from "@/components/app-navigation";
import { ScoreCard } from "@/components/score-card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { parseSongScoreQuery, songScoreSearchParams, songScoreSorts, SONG_SCORE_PAGE_SIZE, SONG_SEARCH_MAX_LENGTH } from "@/lib/song-query";
import type { SongScoreQuery, SongScoresPayload } from "@/lib/types";
import { difficultyCode } from "@/lib/utils";

const difficulties = [
  { value: "0", label: "PST · Past" },
  { value: "1", label: "PRS · Present" },
  { value: "2", label: "FTR · Future" },
  { value: "4", label: "ETR · Eternal" },
  { value: "3", label: "BYD / INS" },
];
const sortLabels = { title: "曲名", date: "成绩时间", score: "分数", score_below_max: "距理论值" };
const sorts = songScoreSorts.map(value => ({ value, label: sortLabels[value] }));

export function SongSearchShell() {
  const [term, setTerm] = React.useState("");
  const [difficulty, setDifficulty] = React.useState(2);
  const [sort, setSort] = React.useState<SongScoreQuery["sort"]>("title");
  const [query, setQuery] = React.useState<SongScoreQuery | null>(null);
  const [data, setData] = React.useState<SongScoresPayload | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    function restoreQuery() {
      const params = new URLSearchParams(window.location.search);
      setTerm(params.get("term") || "");
      const rawDifficulty = params.get("difficulty") || "2";
      const rawSort = params.get("sort") || "title";
      setDifficulty(/^[0-4]$/.test(rawDifficulty) ? Number(rawDifficulty) : 2);
      setSort(songScoreSorts.find(value => value === rawSort) || "title");
      setData(null);
      setError(null);
      try {
        setQuery(params.has("term") ? parseSongScoreQuery(params) : null);
      } catch (caught) {
        setQuery(null);
        setError(caught instanceof Error ? caught.message : "查询参数无效。");
      }
    }
    restoreQuery();
    window.addEventListener("popstate", restoreQuery);
    return () => window.removeEventListener("popstate", restoreQuery);
  }, []);

  React.useEffect(() => {
    if (!query) { setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError(null);
    async function load(activeQuery: SongScoreQuery) {
      try {
        const response = await fetch(`/api/scores?${songScoreSearchParams(activeQuery)}`, { signal: controller.signal, cache: "no-store" });
        if (response.status === 401) {
          window.location.assign(`/login?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
          return;
        }
        const payload = await response.json() as SongScoresPayload & { error?: string };
        if (!response.ok) throw new Error(payload.error || "查询失败，请稍后重试。");
        if (!controller.signal.aborted) setData(payload);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "查询失败，请稍后重试。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load(query);
    return () => controller.abort();
  }, [query]);

  function search(nextQuery: SongScoreQuery) {
    window.history.pushState(null, "", `/scores?${songScoreSearchParams(nextQuery)}`);
    setQuery(nextQuery);
  }

  function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const nextQuery = parseSongScoreQuery(songScoreSearchParams({ term, difficulty, sort, page: 1 }));
      setTerm(nextQuery.term);
      search(nextQuery);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "查询参数无效。");
    }
  }

  const totalPages = Math.max(1, Math.ceil((data?.count || 0) / SONG_SCORE_PAGE_SIZE));
  return (
    <main className="app-shell song-search-shell">
      <AppNavigation current="scores" />
      <div className="app-content">
        <section className="logs-intro song-search-intro" aria-labelledby="song-search-title">
          <div>
            <p className="section-kicker"><Search size={13} /> SCORE SEARCH</p>
            <h1 id="song-search-title">单曲查询 <span>/ PERSONAL BEST</span></h1>
            <p className="song-search-description">查询当前 Arcaea 账号的歌曲最佳成绩。</p>
          </div>
        </section>

        <section className="section-block song-search-panel" aria-label="查询条件">
          <form className="song-search-form" onSubmit={submit}>
            <label className="song-search-field song-search-term">
              <span>曲名或歌曲 ID</span>
              <input name="term" type="search" placeholder="例如 Aegleseeker" value={term} onChange={event => setTerm(event.target.value)} maxLength={SONG_SEARCH_MAX_LENGTH} required autoComplete="off" />
            </label>
            <div className="song-search-field">
              <label htmlFor="song-difficulty">谱面难度</label>
              <Select id="song-difficulty" name="difficulty" value={String(difficulty)} onValueChange={value => setDifficulty(Number(value))} options={difficulties} />
            </div>
            <div className="song-search-field">
              <label htmlFor="song-sort">排序方式</label>
              <Select id="song-sort" name="sort" value={sort} onValueChange={value => setSort(value as SongScoreQuery["sort"])} options={sorts} />
            </div>
            <Button type="submit" className="song-search-submit" disabled={loading}>
              {loading ? <Loader2 size={15} className="spin" /> : <Search size={15} />}
              {loading ? "查询中…" : "查询成绩"}
            </Button>
          </form>
          <p className="song-search-hint">支持曲名关键词搜索，需有效的 Arcaea Online 订阅。</p>
        </section>

        <section className="song-search-results" aria-label="查询结果" aria-busy={loading}>
          <div className="song-search-status" role="status">
            {loading ? <><Loader2 size={16} className="spin" />正在查询官网成绩…</> : data && query ? <><strong>{data.count}</strong> 条成绩 <span>· {query.term} / {query.difficulty === 3 ? "BYD / INS" : difficultyCode(query.difficulty)}</span></> : null}
          </div>
          {error ? <div className="song-search-error" role="alert"><strong>查询未完成</strong><p>{error}</p><Button variant="secondary" size="sm" onClick={() => query && setQuery({ ...query })} disabled={!query}>重试查询</Button></div> : null}
          {!loading && !error && data && query ? data.scores.length ? (
            <>
              <div className="score-grid song-search-grid">
                {data.scores.map(score => <ScoreCard key={`${score.songId}:${score.difficulty}`} score={score} />)}
              </div>
              {totalPages > 1 ? <nav className="song-search-pagination" aria-label="成绩分页">
                <Button variant="secondary" size="sm" disabled={query.page <= 1} onClick={() => search({ ...query, page: query.page - 1 })}><ChevronLeft size={14} />上一页</Button>
                <span>第 <strong>{query.page}</strong> / {totalPages} 页</span>
                <Button variant="secondary" size="sm" disabled={query.page >= totalPages} onClick={() => search({ ...query, page: query.page + 1 })}>下一页<ChevronRight size={14} /></Button>
              </nav> : null}
            </>
          ) : <div className="song-search-empty"><Search size={28} /><h2>未找到成绩</h2><p>{data.count ? "此页没有成绩，请返回第一页。" : "请尝试其他曲名或难度，并确认已在联网状态下游玩该谱面。"}</p>{query.page > 1 ? <Button variant="secondary" onClick={() => search({ ...query, page: 1 })}>返回第一页</Button> : null}</div> : null}
          {!query && !error ? <div className="song-search-empty"><Search size={28} /><h2>查找一首歌</h2><p>输入曲名并选择难度，查看分数、判定和最佳通关状态。</p></div> : null}
        </section>

        <footer className="footer"><span>ArcOnline Extension</span></footer>
      </div>
    </main>
  );
}
