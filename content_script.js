/**
 * note.com 検索結果スクレイパー
 *
 * 戦略:
 *  1. note.com内部API（/api/v3/searches）から直接JSONデータを取得
 *  2. APIが失敗した場合、適応型DOMスクレイピングにフォールバック
 */

(() => {
  "use strict";

  // --- 状態管理 ---
  let scrapingState = {
    status: "idle", // idle | scraping | completed | error
    current: 0,
    targetCount: 0,
    articles: [],
    message: "",
  };

  // --- ユーティリティ関数 ---

  function extractNumber(text) {
    if (!text) return 0;
    const cleaned = String(text).replace(/[,、\s]/g, "");
    const match = cleaned.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extractCreatorFromUrl(url) {
    const match = String(url).match(/note\.com\/([^/]+)\//);
    return match ? match[1] : "";
  }

  // --- ページ種別判定 ---

  /**
   * 現在のページがハッシュタグページかキーワード検索ページかを判定
   * @returns {"hashtag" | "search"}
   */
  function getPageType() {
    return window.location.pathname.startsWith("/hashtag/") ? "hashtag" : "search";
  }

  /**
   * ハッシュタグページからハッシュタグ名を抽出
   * @returns {string} デコード済みハッシュタグ名（例: "個人開発"）
   */
  function getHashtagName() {
    const match = window.location.pathname.match(/^\/hashtag\/(.+?)(?:\/|$)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (e) {
      return match[1];
    }
  }

  // --- 戦略1: note.com 内部API経由でデータ取得 ---

  function getSearchParams() {
    const url = new URL(window.location.href);
    return {
      q: url.searchParams.get("q") || "",
      context: url.searchParams.get("context") || "note",
      mode: url.searchParams.get("mode") || "search",
      sort: url.searchParams.get("sort") || "",
    };
  }

  /**
   * note.com内部APIからデータを取得（ページネーション対応）
   */
  async function fetchFromAPI(targetCount) {
    const params = getSearchParams();
    if (!params.q) {
      console.warn("[NoteExporter] 検索クエリが見つかりません");
      return null;
    }

    const articles = [];
    const PAGE_SIZE = 20;
    let start = 0;

    console.log(`[NoteExporter] API戦略: q="${params.q}", context="${params.context}", 目標=${targetCount}件`);

    while (articles.length < targetCount) {
      const apiUrl = `https://note.com/api/v3/searches?q=${encodeURIComponent(params.q)}&context=${params.context}&size=${PAGE_SIZE}&start=${start}${params.sort ? "&sort=" + params.sort : ""}`;

      console.log(`[NoteExporter] API取得中: ${apiUrl}`);

      try {
        const response = await fetch(apiUrl, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          console.warn(`[NoteExporter] API応答エラー: ${response.status}`);
          return null;
        }

        // まずテキストで取得してログ出力
        const rawText = await response.text();
        console.log(`[NoteExporter] API生レスポンス (先頭500文字): ${rawText.substring(0, 500)}`);

        let data;
        try {
          data = JSON.parse(rawText);
        } catch (jsonErr) {
          console.warn(`[NoteExporter] JSONパースエラー: ${jsonErr.message}`);
          return null;
        }

        // レスポンス構造をログ出力
        console.log("[NoteExporter] トップレベルキー:", Object.keys(data || {}));
        if (data?.data && typeof data.data === "object") {
          console.log("[NoteExporter] data.data キー:", Object.keys(data.data));
        }

        const parsedArticles = extractNotesFromApiResponse(data);

        if (!Array.isArray(parsedArticles) || parsedArticles.length === 0) {
          console.log(`[NoteExporter] API: これ以上の結果なし (start=${start})`);
          break;
        }

        for (let i = 0; i < parsedArticles.length; i++) {
          if (articles.length >= targetCount) break;
          articles.push(parsedArticles[i]);
        }

        scrapingState.current = articles.length;
        console.log(`[NoteExporter] API: ${articles.length}/${targetCount}件取得`);

        start += PAGE_SIZE;
        await sleep(500);
      } catch (err) {
        console.warn(`[NoteExporter] APIエラー: ${err.message}`, err);
        return null;
      }
    }

    return articles.length > 0 ? articles : null;
  }

  /**
   * ハッシュタグページ用: note.com内部APIからデータを取得（ページネーション対応）
   */
  async function fetchFromHashtagAPI(targetCount) {
    const hashtag = getHashtagName();
    if (!hashtag) {
      console.warn("[NoteExporter] ハッシュタグ名が見つかりません");
      return null;
    }

    // URLからソートパラメータを検出（デフォルトは人気順）
    const url = new URL(window.location.href);
    const sort = url.searchParams.get("sort") || "popular";

    const articles = [];
    let page = 1;

    console.log(`[NoteExporter] ハッシュタグAPI戦略: hashtag="${hashtag}", sort="${sort}", 目標=${targetCount}件`);

    while (articles.length < targetCount) {
      const apiUrl = `https://note.com/api/v3/hashtags/${encodeURIComponent(hashtag)}/notes?page=${page}&sort=${sort}`;

      console.log(`[NoteExporter] ハッシュタグAPI取得中: ${apiUrl}`);

      try {
        const response = await fetch(apiUrl, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) {
          console.warn(`[NoteExporter] ハッシュタグAPI応答エラー: ${response.status}`);
          return null;
        }

        const rawText = await response.text();
        console.log(`[NoteExporter] ハッシュタグAPI生レスポンス (先頭500文字): ${rawText.substring(0, 500)}`);

        let data;
        try {
          data = JSON.parse(rawText);
        } catch (jsonErr) {
          console.warn(`[NoteExporter] JSONパースエラー: ${jsonErr.message}`);
          return null;
        }

        console.log("[NoteExporter] トップレベルキー:", Object.keys(data || {}));
        if (data?.data && typeof data.data === "object") {
          console.log("[NoteExporter] data.data キー:", Object.keys(data.data));
        }

        const noteObjects = data?.data?.notes;
        if (!Array.isArray(noteObjects) || noteObjects.length === 0) {
          console.log(`[NoteExporter] ハッシュタグAPI: これ以上の結果なし (page=${page})`);
          break;
        }

        for (const noteObj of noteObjects) {
          if (articles.length >= targetCount) break;
          try {
            const article = extractArticleFromNote(noteObj);
            if (article && article.title) {
              articles.push(article);
            }
          } catch (noteErr) {
            console.warn(`[NoteExporter] パースエラー:`, noteErr.message);
          }
        }

        scrapingState.current = articles.length;
        console.log(`[NoteExporter] ハッシュタグAPI: ${articles.length}/${targetCount}件取得`);

        // 最終ページ判定
        if (data?.data?.is_last_page) {
          console.log("[NoteExporter] ハッシュタグAPI: 最終ページに到達");
          break;
        }

        page++;
        await sleep(500);
      } catch (err) {
        console.warn(`[NoteExporter] ハッシュタグAPIエラー: ${err.message}`, err);
        return null;
      }
    }

    return articles.length > 0 ? articles : null;
  }

  /**
   * APIレスポンスから記事データの配列を抽出して返す
   * 必ずArrayを返す（エラー時は空配列）
   */
  function extractNotesFromApiResponse(data) {
    try {
      const noteObjects = findNotesArray(data);

      if (!Array.isArray(noteObjects) || noteObjects.length === 0) {
        return [];
      }

      // 最初の2件の生データをログ出力
      for (let i = 0; i < Math.min(2, noteObjects.length); i++) {
        console.log(`[NoteExporter] ${i + 1}件目の全キー:`, Object.keys(noteObjects[i] || {}));
        console.log(`[NoteExporter] ${i + 1}件目の生データ:`, JSON.stringify(noteObjects[i], null, 2).substring(0, 2000));
      }

      const articles = [];
      for (let i = 0; i < noteObjects.length; i++) {
        try {
          const article = extractArticleFromNote(noteObjects[i]);
          if (article && article.title) {
            articles.push(article);
          }
        } catch (noteErr) {
          console.warn(`[NoteExporter] ${i}件目のパースエラー:`, noteErr.message);
        }
      }

      return articles;
    } catch (err) {
      console.warn("[NoteExporter] extractNotesFromApiResponse エラー:", err.message);
      return [];
    }
  }

  /**
   * APIレスポンスからnotes配列を探す
   * 必ずArrayを返す
   */
  function findNotesArray(data) {
    if (!data || typeof data !== "object") return [];

    // 明示的な候補を順に確認
    const paths = [
      () => data?.data?.notes?.contents,
      () => data?.data?.notes?.items,
      () => data?.data?.notes,
      () => data?.data?.contents,
      () => data?.data?.search_results,
      () => data?.data?.items,
      () => data?.notes,
      () => data?.contents,
      () => data?.items,
    ];

    for (const pathFn of paths) {
      try {
        const val = pathFn();
        if (Array.isArray(val) && val.length > 0) {
          console.log(`[NoteExporter] 記事配列を発見: ${val.length}件`);
          return val;
        }
      } catch (e) { /* ignore */ }
    }

    // data.data が配列の場合
    if (Array.isArray(data?.data) && data.data.length > 0) {
      console.log(`[NoteExporter] data.data が配列: ${data.data.length}件`);
      return data.data;
    }

    // data.data のプロパティを探索して配列を見つける
    if (data?.data && typeof data.data === "object" && !Array.isArray(data.data)) {
      for (const [key, value] of Object.entries(data.data)) {
        if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
          console.log(`[NoteExporter] data.data.${key} で配列を発見: ${value.length}件`);
          return value;
        }
      }
    }

    // トップレベルのプロパティを探索
    for (const [key, value] of Object.entries(data)) {
      if (key === "data") continue;
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object" && value[0] !== null) {
        console.log(`[NoteExporter] data.${key} で配列を発見: ${value.length}件`);
        return value;
      }
    }

    console.warn("[NoteExporter] 配列が見つかりません。data構造:", JSON.stringify(data, null, 2).substring(0, 1000));
    return [];
  }

  /**
   * 1つのnoteオブジェクトから記事データを抽出
   */
  function extractArticleFromNote(note) {
    if (!note || typeof note !== "object") return null;

    // noteオブジェクト内にさらにネストされた記事データがある場合を考慮
    const inner = (note.note && typeof note.note === "object") ? note.note : note;

    // タイトル
    const title = safeStr(inner.name) || safeStr(note.name)
      || safeStr(inner.title) || safeStr(note.title)
      || safeStr(inner.headline) || safeStr(note.headline)
      || "";

    // スキ数
    const likeCount = safeNum(inner, [
      "like_count", "likeCount", "likes_count", "likesCount",
      "sp_count", "spCount", "suki_count", "sukiCount",
    ]) || safeNum(note, [
      "like_count", "likeCount", "likes_count", "likesCount",
      "sp_count", "spCount", "suki_count", "sukiCount",
    ]);

    // 価格
    let price = safeNum(inner, ["price", "amount", "body_price", "bodyPrice"])
      || safeNum(note, ["price", "amount", "body_price", "bodyPrice"]);
    if (price === "無料") price = 0;

    // URL
    const noteUrl = buildNoteUrl(note, inner);

    // クリエイター名
    const creator = findCreatorName(note, inner);

    return {
      title,
      likeCount: Number(likeCount) || 0,
      price: Number(price) || 0,
      url: noteUrl,
      creator,
    };
  }

  /**
   * 安全に文字列を取得
   */
  function safeStr(val) {
    if (val === undefined || val === null) return "";
    if (typeof val === "string") return val;
    return String(val);
  }

  /**
   * オブジェクトから数値フィールドを安全に取得
   */
  function safeNum(obj, keys) {
    if (!obj || typeof obj !== "object") return 0;
    for (const key of keys) {
      const val = obj[key];
      if (val !== undefined && val !== null) {
        const num = Number(val);
        if (!isNaN(num)) return num;
      }
    }
    return 0;
  }

  /**
   * 記事URLを構築
   */
  function buildNoteUrl(note, inner) {
    // 直接URLフィールド
    for (const obj of [inner, note]) {
      for (const key of ["note_url", "noteUrl", "url"]) {
        const val = obj?.[key];
        if (typeof val === "string" && val.startsWith("http")) return val;
      }
    }

    // keyとurlnameから構築
    const key = inner.key || note.key || inner.slug || note.slug || "";
    const user = inner.user || note.user || {};
    const urlname = (typeof user === "object" ? user.urlname : "") || inner.urlname || note.urlname || "";

    if (key && urlname) {
      return `https://note.com/${urlname}/n/${key}`;
    }

    // hrefフィールド
    const href = inner.href || note.href || "";
    if (href) return href.startsWith("http") ? href : `https://note.com${href}`;

    return "";
  }

  /**
   * クリエイター名を探す
   */
  function findCreatorName(note, inner) {
    for (const obj of [inner, note]) {
      const user = obj?.user;
      if (user && typeof user === "object") {
        const name = user.nickname || user.name || user.urlname || user.display_name;
        if (name) return String(name);
      }
    }

    // 文字列フィールド
    for (const obj of [inner, note]) {
      for (const key of ["creator_name", "creatorName", "author_name", "authorName"]) {
        if (obj?.[key]) return String(obj[key]);
      }
    }

    return "";
  }

  // --- 戦略2: 適応型DOMスクレイピング ---

  function diagnoseDom() {
    console.log("[NoteExporter] === DOM診断開始 ===");
    const articleLinks = document.querySelectorAll('a[href*="/n/"]');
    console.log(`[NoteExporter] /n/ を含むリンク数: ${articleLinks.length}`);

    if (articleLinks.length > 0) {
      const sample = articleLinks[0];
      console.log("[NoteExporter] サンプルリンク:", {
        href: sample.getAttribute("href"),
        text: sample.textContent.trim().substring(0, 50),
      });

      let el = sample;
      for (let i = 0; i < 8; i++) {
        el = el.parentElement;
        if (!el || el === document.body) break;
        console.log(`[NoteExporter]   ${i}階層上: <${el.tagName.toLowerCase()}> class="${(el.className || "").substring(0, 120)}"`);
      }
    }
    console.log("[NoteExporter] === DOM診断終了 ===");
  }

  function collectArticlesFromDom() {
    const articles = [];
    const seen = new Set();
    const allLinks = document.querySelectorAll('a[href*="/n/"]');

    for (const link of allLinks) {
      const href = link.getAttribute("href") || "";
      if (!href.match(/\/[^/]+\/n\/[a-zA-Z0-9]+$/)) continue;

      const fullUrl = href.startsWith("http") ? href : `https://note.com${href}`;
      if (seen.has(fullUrl)) continue;

      const container = findArticleContainer(link);
      if (!container) continue;

      const title = extractTitle(link, container);
      if (!title || title.length < 2) continue;

      const likeCount = extractLikeCount(container);
      const price = extractPrice(container);
      const creator = extractCreator(container, fullUrl);

      seen.add(fullUrl);
      articles.push({ title, likeCount, price, url: fullUrl, creator });
    }

    return articles;
  }

  function findArticleContainer(linkEl) {
    let el = linkEl.parentElement;
    for (let i = 0; i < 10; i++) {
      if (!el || el === document.body) return linkEl.parentElement;
      const innerLinks = el.querySelectorAll('a[href*="/n/"]');
      const hasMultiple = innerLinks.length > 1 &&
        Array.from(innerLinks).some(a => {
          const h = a.getAttribute("href") || "";
          return h !== (linkEl.getAttribute("href") || "") && h.match(/\/[^/]+\/n\/[a-zA-Z0-9]+$/);
        });
      if (hasMultiple) return linkEl.parentElement;
      el = el.parentElement;
    }
    return linkEl.parentElement;
  }

  function extractTitle(link, container) {
    const heading = link.querySelector("h1, h2, h3, h4");
    if (heading) return heading.textContent.trim();
    const ariaLabel = link.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    const titleAttr = link.getAttribute("title");
    if (titleAttr) return titleAttr.trim();
    if (container) {
      const containerHeading = container.querySelector("h1, h2, h3, h4");
      if (containerHeading) return containerHeading.textContent.trim();
    }
    const text = link.textContent.trim();
    if (text) {
      const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length > 0) return lines[0].substring(0, 200);
    }
    return "";
  }

  function extractLikeCount(container) {
    if (!container) return 0;
    const svgs = container.querySelectorAll("svg");
    for (const svg of svgs) {
      const parent = svg.parentElement;
      if (!parent) continue;
      const num = extractNumber(parent.textContent);
      if (num > 0) return num;
      const nextEl = parent.nextElementSibling || svg.nextElementSibling;
      if (nextEl) {
        const nextNum = extractNumber(nextEl.textContent);
        if (nextNum > 0) return nextNum;
      }
    }
    for (const sel of ['[class*="like"]', '[class*="Like"]', '[class*="heart"]', '[class*="Heart"]']) {
      try {
        const el = container.querySelector(sel);
        if (el) { const num = extractNumber(el.textContent); if (num > 0) return num; }
      } catch (e) { /* ignore */ }
    }
    return 0;
  }

  function extractPrice(container) {
    if (!container) return 0;
    for (const sel of ['[class*="price"]', '[class*="Price"]', '[class*="amount"]']) {
      try {
        const el = container.querySelector(sel);
        if (el) {
          const text = el.textContent.trim();
          if (text.includes("無料")) return 0;
          const num = extractNumber(text);
          if (num > 0) return num;
        }
      } catch (e) { /* ignore */ }
    }
    const yenMatch = container.textContent.match(/[¥￥]\s*([0-9,]+)/);
    if (yenMatch) return extractNumber(yenMatch[1]);
    return 0;
  }

  function extractCreator(container, url) {
    if (!container) return extractCreatorFromUrl(url);
    for (const sel of ['[class*="creator"]', '[class*="Creator"]', '[class*="author"]', '[class*="Author"]', '[class*="userName"]']) {
      try {
        const el = container.querySelector(sel);
        if (el) { const text = el.textContent.trim(); if (text.length > 0 && text.length < 100) return text; }
      } catch (e) { /* ignore */ }
    }
    return extractCreatorFromUrl(url);
  }

  // --- 高評価数の取得（個別記事ページから） ---

  /**
   * 記事詳細APIまたはHTMLページから高評価数を取得
   */
  async function fetchLikeRating(articleUrl) {
    if (!articleUrl) return 0;

    try {
      // URLからnoteのkeyを抽出 (例: /username/n/nXXXXXX)
      const urlMatch = articleUrl.match(/\/n\/([a-zA-Z0-9]+)/);
      if (!urlMatch) return 0;
      const noteKey = urlMatch[1];

      // ※ like_count はスキ数であり、高評価数とは別の指標
      // 高評価数専用のフィールド候補（like_countは含めない）
      const ratingFieldCandidates = [
        "rating_count", "ratingCount",
        "recommend_count", "recommendCount",
        "evaluation_count", "evaluationCount",
        "high_rating_count", "highRatingCount",
        "buyer_like_count", "buyerLikeCount",
        "purchase_like_count", "purchaseLikeCount",
      ];

      // 方法1: 記事詳細APIを試行
      let apiNetworkError = false;
      try {
        const apiUrl = `https://note.com/api/v3/notes/${noteKey}`;
        const apiRes = await fetch(apiUrl, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (apiRes.ok) {
          const apiData = await apiRes.json();
          const noteData = apiData?.data || apiData;
          const inner = noteData?.note || noteData;

          // 高評価専用フィールドを検索（like_countは除外）
          for (const obj of [inner, noteData]) {
            const rating = safeNum(obj, ratingFieldCandidates);
            if (rating > 0) {
              console.log(`[NoteExporter] API高評価数: ${rating} (${noteKey})`);
              return rating;
            }
          }

          // APIレスポンスの全キーをログ出力（初回のみ、デバッグ用）
          if (!fetchLikeRating._logged) {
            fetchLikeRating._logged = true;
            console.log(`[NoteExporter] 記事API全キー:`, Object.keys(noteData || {}));
            if (noteData?.note) {
              console.log(`[NoteExporter] 記事API note内キー:`, Object.keys(noteData.note));
            }
            console.log(`[NoteExporter] 記事API生データ(先頭2000):`, JSON.stringify(noteData, null, 2).substring(0, 2000));
            console.log(`[NoteExporter] ※ 高評価数はAPIに含まれない可能性あり。HTMLフォールバックに進みます`);
          }
        }
      } catch (apiErr) {
        apiNetworkError = true;
        if (!fetchLikeRating._networkErrorLogged) {
          fetchLikeRating._networkErrorLogged = true;
          console.warn(`[NoteExporter] 記事API失敗 (以降同様のエラーは省略): ${apiErr.message}`);
        }
      }

      // 方法2: HTMLページから抽出（APIがネットワークエラーの場合はスキップ）
      if (!apiNetworkError) {
        try {
          const pageRes = await fetch(articleUrl, {
            credentials: "include",
          });
          if (pageRes.ok) {
            const html = await pageRes.text();

            // パターン1: "XX人が高評価" テキストを検索
            const ratingMatch = html.match(/(\d+)\s*人が高評価/);
            if (ratingMatch) {
              const count = parseInt(ratingMatch[1], 10);
              console.log(`[NoteExporter] HTML高評価数: ${count} (${noteKey})`);
              return count;
            }

            // パターン2: __NEXT_DATA__ 内のJSONから高評価数を探す
            const nextDataMatch = html.match(/<script\s+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
            if (nextDataMatch) {
              try {
                const nextData = JSON.parse(nextDataMatch[1]);
                // __NEXT_DATA__内を再帰的に探索
                const rating = findRatingInObject(nextData, ratingFieldCandidates);
                if (rating > 0) {
                  console.log(`[NoteExporter] __NEXT_DATA__高評価数: ${rating} (${noteKey})`);
                  return rating;
                }
              } catch (e) { /* JSONパースエラーは無視 */ }
            }

            // パターン3: __NUXT__ データから探す（旧バージョン対応）
            const nuxtMatch = html.match(/__NUXT__[^=]*=\s*(\{[\s\S]*?\});?\s*<\/script>/);
            if (nuxtMatch) {
              try {
                const ratingInNuxt = nuxtMatch[1].match(/"(?:rating_count|ratingCount|recommend_count|high_rating_count|buyer_like_count)"\s*:\s*(\d+)/);
                if (ratingInNuxt) {
                  const count = parseInt(ratingInNuxt[1], 10);
                  console.log(`[NoteExporter] Nuxt高評価数: ${count} (${noteKey})`);
                  return count;
                }
              } catch (e) { /* ignore */ }
            }

            // パターン4: HTML内のJSON-LD等に「高評価」関連データがないか（テキストマッチ）
            const htmlRatingMatch = html.match(/"(?:rating_count|ratingCount|recommend_count|high_rating_count|buyer_like_count)"\s*:\s*(\d+)/);
            if (htmlRatingMatch) {
              const count = parseInt(htmlRatingMatch[1], 10);
              console.log(`[NoteExporter] HTML-JSON高評価数: ${count} (${noteKey})`);
              return count;
            }
          }
        } catch (htmlErr) {
          if (!fetchLikeRating._htmlErrorLogged) {
            fetchLikeRating._htmlErrorLogged = true;
            console.warn(`[NoteExporter] HTML取得失敗 (以降同様のエラーは省略): ${htmlErr.message}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[NoteExporter] 高評価数取得エラー: ${err.message}`);
    }

    return 0;
  }

  /**
   * オブジェクトを浅く探索して高評価数フィールドを見つける（最大2階層）
   */
  function findRatingInObject(obj, fieldCandidates, depth) {
    if (depth === undefined) depth = 0;
    if (!obj || typeof obj !== "object" || depth > 3) return 0;

    // 直接フィールドをチェック
    for (const key of fieldCandidates) {
      if (obj[key] !== undefined && obj[key] !== null) {
        const num = Number(obj[key]);
        if (!isNaN(num) && num > 0) return num;
      }
    }

    // 子オブジェクトを探索
    for (const val of Object.values(obj)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const found = findRatingInObject(val, fieldCandidates, depth + 1);
        if (found > 0) return found;
      }
    }

    return 0;
  }

  /**
   * 全記事の高評価数を一括取得（進捗表示付き）
   */
  async function fetchAllLikeRatings(articles) {
    console.log(`[NoteExporter] 高評価数の取得を開始: ${articles.length}件`);
    const results = [];

    for (let i = 0; i < articles.length; i++) {
      const article = articles[i];
      const rating = await fetchLikeRating(article.url);
      results.push({ ...article, likeRating: rating });

      scrapingState.current = i + 1;
      scrapingState.message = `高評価数を取得中... ${i + 1} / ${articles.length} 件`;
      console.log(`[NoteExporter] 高評価数 ${i + 1}/${articles.length}: ${article.title.substring(0, 30)}... → ${rating}`);

      // レート制限対策
      if (i < articles.length - 1) {
        await sleep(300);
      }
    }

    return results;
  }

  // --- 自動スクロール ---

  async function autoScrollAndCollect(targetCount) {
    let lastArticleCount = 0;
    let noNewArticleRetries = 0;
    const MAX_RETRIES = 15;

    while (scrapingState.status === "scraping") {
      const articles = collectArticlesFromDom();
      scrapingState.articles = articles;
      scrapingState.current = articles.length;

      if (articles.length >= targetCount) {
        scrapingState.articles = articles.slice(0, targetCount);
        scrapingState.current = targetCount;
        return;
      }

      if (articles.length === lastArticleCount) {
        noNewArticleRetries++;
        if (noNewArticleRetries >= MAX_RETRIES) {
          console.log(`[NoteExporter] ${articles.length}件で読み込み停止（目標: ${targetCount}件）`);
          return;
        }
      } else {
        noNewArticleRetries = 0;
      }
      lastArticleCount = articles.length;

      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
      await sleep(2000);
    }
  }

  // --- CSV生成とダウンロード ---

  function downloadCSV(articles) {
    const headers = ["タイトル", "スキ数", "高評価数", "単価", "記事URL", "クリエイター名"];
    const rows = articles.map((a) => [
      escapeCsvField(a.title),
      String(a.likeCount),
      String(a.likeRating || 0),
      String(a.price),
      escapeCsvField(a.url),
      escapeCsvField(a.creator),
    ]);

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `note_search_results_${formatDate()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function escapeCsvField(value) {
    if (!value) return '""';
    const str = String(value);
    if (str.includes('"') || str.includes(",") || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return `"${str}"`;
  }

  function formatDate() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    return `${y}${m}${d}_${h}${min}`;
  }

  // --- メッセージリスナー ---

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "startScraping") {
      if (scrapingState.status === "scraping") {
        sendResponse({ status: "already_running" });
        return true;
      }

      scrapingState = {
        status: "scraping",
        current: 0,
        targetCount: message.count,
        articles: [],
        message: "",
      };

      sendResponse({ status: "started" });

      (async () => {
        try {
          diagnoseDom();

          const pageType = getPageType();
          console.log(`[NoteExporter] ページ種別: ${pageType}`);

          let articles;

          if (pageType === "hashtag") {
            // ハッシュタグページ: APIはソート・like_countが不正確なため、
            // ページに表示されているデータをDOMから直接取得する
            console.log("[NoteExporter] ハッシュタグページ: DOMスクレイピングで取得...");
            await autoScrollAndCollect(message.count);
            articles = scrapingState.articles;
          } else {
            // 検索ページ: API → DOMフォールバック
            console.log("[NoteExporter] 戦略1: API経由で取得を試行...");
            articles = await fetchFromAPI(message.count);

            if (!Array.isArray(articles) || articles.length === 0) {
              console.log("[NoteExporter] 戦略2: DOMスクレイピングにフォールバック...");
              await autoScrollAndCollect(message.count);
              articles = scrapingState.articles;
            } else {
              scrapingState.articles = articles;
              scrapingState.current = articles.length;
            }
          }

          if (Array.isArray(articles) && articles.length > 0) {
            // 高評価数を各記事ページから取得
            scrapingState.message = "高評価数を取得中...";
            console.log("[NoteExporter] 高評価数の取得を開始...");
            articles = await fetchAllLikeRatings(articles);

            downloadCSV(articles);
            scrapingState.status = "completed";
            scrapingState.current = articles.length;
            scrapingState.message = `${articles.length}件のデータをCSVに出力しました。`;
          } else {
            scrapingState.status = "error";
            scrapingState.message =
              "記事データを取得できませんでした。DevToolsのConsoleログを確認してください。";
          }
        } catch (err) {
          scrapingState.status = "error";
          scrapingState.message = `エラー: ${err.message}`;
          console.error("[NoteExporter] Error:", err);
        }
      })();

      return true;
    }

    if (message.action === "getProgress") {
      sendResponse({
        status: scrapingState.status,
        current: scrapingState.current,
        total: scrapingState.targetCount,
        message: scrapingState.message,
      });
      return true;
    }

    return false;
  });

  // --- テスト用エクスポート（テスト時のみ使用） ---
  if (typeof globalThis.__NOTE_EXPORTER_TEST__ !== "undefined") {
    globalThis.__NOTE_EXPORTER_FUNCS__ = {
      extractNumber,
      extractCreatorFromUrl,
      extractNotesFromApiResponse,
      findNotesArray,
      extractArticleFromNote,
      safeStr,
      safeNum,
      buildNoteUrl,
      findCreatorName,
      escapeCsvField,
      downloadCSV,
      fetchLikeRating,
      fetchAllLikeRatings,
      findRatingInObject,
      getPageType,
      getHashtagName,
    };
  }

  console.log("[NoteExporter] Content script loaded on:", window.location.href);
})();
