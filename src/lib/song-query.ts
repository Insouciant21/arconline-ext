import { AppError } from "./errors";
import type { SongScoreQuery } from "./types";

export const SONG_SCORE_PAGE_SIZE = 10;
export const SONG_SEARCH_MAX_LENGTH = 100;
export const songScoreSorts = ["date", "score", "score_below_max", "title"] as const;

export function parseSongScoreQuery(params: URLSearchParams): SongScoreQuery {
  const term = (params.get("term") || "").trim();
  const difficulty = params.get("difficulty") ?? "2";
  const page = params.get("page") ?? "1";
  const sort = params.get("sort") ?? "title";
  if (!term || term.length > SONG_SEARCH_MAX_LENGTH || /[\u0000-\u001f\u007f]/.test(term)) {
    throw new AppError("请输入 1–100 个字符的曲名或歌曲 ID。", 400, "INVALID_SONG_QUERY");
  }
  if (!/^[0-4]$/.test(difficulty)) {
    throw new AppError("请选择有效的谱面难度。", 400, "INVALID_SONG_DIFFICULTY");
  }
  if (!/^[1-9]\d{0,3}$/.test(page)) {
    throw new AppError("查询页码无效。", 400, "INVALID_SONG_PAGE");
  }
  if (!songScoreSorts.some(value => value === sort)) {
    throw new AppError("请选择有效的排序方式。", 400, "INVALID_SONG_SORT");
  }
  return { term, difficulty: Number(difficulty), page: Number(page), sort: sort as SongScoreQuery["sort"] };
}

export function songScoreSearchParams(query: SongScoreQuery) {
  return new URLSearchParams({ term: query.term, difficulty: String(query.difficulty), page: String(query.page), sort: query.sort });
}
