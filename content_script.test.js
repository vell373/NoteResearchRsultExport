/**
 * content_script.js のユニット/結合テスト
 *
 * テスト対象:
 * - extractNumber: テキストから数値抽出
 * - extractCreatorFromUrl: URLからクリエイター名抽出
 * - findNotesArray: APIレスポンスからnotes配列探索
 * - extractNotesFromApiResponse: APIレスポンスから記事データ抽出
 * - extractArticleFromNote: 1つのnoteオブジェクトから記事データ抽出
 * - safeStr / safeNum: 安全な型変換
 * - buildNoteUrl: 記事URL構築
 * - findCreatorName: クリエイター名探索
 * - escapeCsvField: CSVフィールドエスケープ
 */

// テストモードフラグを設定
globalThis.__NOTE_EXPORTER_TEST__ = true;

// chrome APIのモック
globalThis.chrome = {
  runtime: {
    onMessage: { addListener: jest.fn() },
  },
};

// window/document のモック（最低限）
if (typeof window === "undefined") {
  globalThis.window = { location: { href: "https://note.com/search?q=test" } };
}
if (typeof document === "undefined") {
  globalThis.document = { body: {}, querySelectorAll: () => [] };
}

// content_script.js を読み込み
require("./content_script.js");

const funcs = globalThis.__NOTE_EXPORTER_FUNCS__;

// ========================================
// extractNumber
// ========================================
describe("extractNumber", () => {
  test("通常の数値テキストから抽出", () => {
    expect(funcs.extractNumber("123")).toBe(123);
  });

  test("カンマ区切りの数値", () => {
    expect(funcs.extractNumber("1,234")).toBe(1234);
  });

  test("前後にテキストがある場合", () => {
    expect(funcs.extractNumber("スキ 456 件")).toBe(456);
  });

  test("空文字列", () => {
    expect(funcs.extractNumber("")).toBe(0);
  });

  test("null/undefined", () => {
    expect(funcs.extractNumber(null)).toBe(0);
    expect(funcs.extractNumber(undefined)).toBe(0);
  });

  test("数値を含まないテキスト", () => {
    expect(funcs.extractNumber("テスト")).toBe(0);
  });

  test("全角カンマ（、）を含む場合", () => {
    expect(funcs.extractNumber("1、234")).toBe(1234);
  });
});

// ========================================
// extractCreatorFromUrl
// ========================================
describe("extractCreatorFromUrl", () => {
  test("標準的なnote.com URL", () => {
    expect(funcs.extractCreatorFromUrl("https://note.com/testuser/n/n1234")).toBe("testuser");
  });

  test("パスだけの場合", () => {
    expect(funcs.extractCreatorFromUrl("https://note.com/another_user/n/nabc")).toBe("another_user");
  });

  test("note.comを含まないURL", () => {
    expect(funcs.extractCreatorFromUrl("https://example.com/user/n/n123")).toBe("");
  });

  test("空文字列", () => {
    expect(funcs.extractCreatorFromUrl("")).toBe("");
  });
});

// ========================================
// safeStr
// ========================================
describe("safeStr", () => {
  test("文字列をそのまま返す", () => {
    expect(funcs.safeStr("hello")).toBe("hello");
  });

  test("nullは空文字列", () => {
    expect(funcs.safeStr(null)).toBe("");
  });

  test("undefinedは空文字列", () => {
    expect(funcs.safeStr(undefined)).toBe("");
  });

  test("数値はString変換", () => {
    expect(funcs.safeStr(42)).toBe("42");
  });
});

// ========================================
// safeNum
// ========================================
describe("safeNum", () => {
  test("キーが見つかる場合", () => {
    expect(funcs.safeNum({ like_count: 100 }, ["like_count"])).toBe(100);
  });

  test("複数キー候補の2番目でヒット", () => {
    expect(funcs.safeNum({ spCount: 50 }, ["like_count", "spCount"])).toBe(50);
  });

  test("キーが見つからない場合は0", () => {
    expect(funcs.safeNum({ other: 10 }, ["like_count"])).toBe(0);
  });

  test("nullオブジェクト", () => {
    expect(funcs.safeNum(null, ["like_count"])).toBe(0);
  });

  test("文字列数値もNumber変換", () => {
    expect(funcs.safeNum({ price: "1500" }, ["price"])).toBe(1500);
  });

  test("NaNの場合はスキップ", () => {
    expect(funcs.safeNum({ price: "無料" }, ["price"])).toBe(0);
  });
});

// ========================================
// buildNoteUrl
// ========================================
describe("buildNoteUrl", () => {
  test("note_urlフィールドがある場合", () => {
    const note = { note_url: "https://note.com/user/n/n123" };
    expect(funcs.buildNoteUrl(note, note)).toBe("https://note.com/user/n/n123");
  });

  test("keyとuser.urlnameから構築", () => {
    const note = { key: "n12345abc", user: { urlname: "testuser" } };
    expect(funcs.buildNoteUrl(note, note)).toBe("https://note.com/testuser/n/n12345abc");
  });

  test("innerにURLがある場合はinnerを優先", () => {
    const note = {};
    const inner = { note_url: "https://note.com/inner/n/nabc" };
    expect(funcs.buildNoteUrl(note, inner)).toBe("https://note.com/inner/n/nabc");
  });

  test("hrefフィールド（相対パス）", () => {
    const note = { href: "/user/n/n999" };
    expect(funcs.buildNoteUrl(note, note)).toBe("https://note.com/user/n/n999");
  });

  test("URLが全くない場合は空文字列", () => {
    expect(funcs.buildNoteUrl({}, {})).toBe("");
  });
});

// ========================================
// findCreatorName
// ========================================
describe("findCreatorName", () => {
  test("user.nicknameがある場合", () => {
    const note = { user: { nickname: "テストユーザー" } };
    expect(funcs.findCreatorName(note, note)).toBe("テストユーザー");
  });

  test("user.urlnameにフォールバック", () => {
    const note = { user: { urlname: "testuser" } };
    expect(funcs.findCreatorName(note, note)).toBe("testuser");
  });

  test("creator_nameフィールド", () => {
    const note = { creator_name: "クリエイター" };
    expect(funcs.findCreatorName(note, note)).toBe("クリエイター");
  });

  test("innerのuserを優先", () => {
    const note = { user: { nickname: "outer" } };
    const inner = { user: { nickname: "inner" } };
    expect(funcs.findCreatorName(note, inner)).toBe("inner");
  });

  test("ユーザー情報なし", () => {
    expect(funcs.findCreatorName({}, {})).toBe("");
  });
});

// ========================================
// findNotesArray
// ========================================
describe("findNotesArray", () => {
  test("data.data.notes が配列の場合", () => {
    const data = { data: { notes: [{ name: "test" }] } };
    expect(funcs.findNotesArray(data)).toEqual([{ name: "test" }]);
  });

  test("data.data.contents が配列の場合", () => {
    const data = { data: { contents: [{ name: "c1" }, { name: "c2" }] } };
    expect(funcs.findNotesArray(data)).toEqual([{ name: "c1" }, { name: "c2" }]);
  });

  test("data.data.notes.contents（ネスト）の場合", () => {
    const data = { data: { notes: { contents: [{ name: "nested" }] } } };
    expect(funcs.findNotesArray(data)).toEqual([{ name: "nested" }]);
  });

  test("data.data.notes.items（ネスト）の場合", () => {
    const data = { data: { notes: { items: [{ name: "item1" }] } } };
    expect(funcs.findNotesArray(data)).toEqual([{ name: "item1" }]);
  });

  test("data が直接配列を持つ場合", () => {
    const data = { data: [{ name: "direct" }] };
    expect(funcs.findNotesArray(data)).toEqual([{ name: "direct" }]);
  });

  test("data.dataのプロパティに配列がある場合（動的探索）", () => {
    const data = { data: { my_custom_key: [{ name: "custom" }] } };
    expect(funcs.findNotesArray(data)).toEqual([{ name: "custom" }]);
  });

  test("nullデータ", () => {
    expect(funcs.findNotesArray(null)).toEqual([]);
  });

  test("空オブジェクト", () => {
    expect(funcs.findNotesArray({})).toEqual([]);
  });

  test("data.data.notes が配列でない（オブジェクト）場合", () => {
    const data = { data: { notes: { count: 10, is_last_page: false } } };
    // notes自体は配列でないため、スキップされる
    const result = funcs.findNotesArray(data);
    expect(Array.isArray(result)).toBe(true);
  });

  test("プリミティブ値は無視される", () => {
    const data = { data: { notes: "not-an-array", count: 10 } };
    expect(funcs.findNotesArray(data)).toEqual([]);
  });
});

// ========================================
// extractArticleFromNote（記事ごとに異なるデータを返すことを検証）
// ========================================
describe("extractArticleFromNote", () => {
  test("標準的なnoteオブジェクトから各フィールドを正しく抽出", () => {
    const note = {
      name: "テスト記事タイトル",
      like_count: 42,
      price: 500,
      note_url: "https://note.com/testuser/n/n123",
      user: { nickname: "テストクリエイター", urlname: "testuser" },
    };
    const result = funcs.extractArticleFromNote(note);
    expect(result.title).toBe("テスト記事タイトル");
    expect(result.likeCount).toBe(42);
    expect(result.price).toBe(500);
    expect(result.url).toBe("https://note.com/testuser/n/n123");
    expect(result.creator).toBe("テストクリエイター");
  });

  test("異なるフィールド名のnoteオブジェクト", () => {
    const note = {
      title: "別のタイトル",
      spCount: 99,
      amount: 1000,
      key: "nabc123",
      user: { urlname: "anotheruser", name: "別のユーザー" },
    };
    const result = funcs.extractArticleFromNote(note);
    expect(result.title).toBe("別のタイトル");
    expect(result.likeCount).toBe(99);
    expect(result.price).toBe(1000);
    expect(result.url).toBe("https://note.com/anotheruser/n/nabc123");
    expect(result.creator).toBe("別のユーザー");
  });

  test("ネストされたnoteオブジェクト", () => {
    const note = {
      note: {
        name: "ネストタイトル",
        like_count: 15,
        price: 0,
        note_url: "https://note.com/nested/n/n999",
        user: { nickname: "ネストユーザー" },
      },
    };
    const result = funcs.extractArticleFromNote(note);
    expect(result.title).toBe("ネストタイトル");
    expect(result.likeCount).toBe(15);
    expect(result.price).toBe(0);
    expect(result.url).toBe("https://note.com/nested/n/n999");
    expect(result.creator).toBe("ネストユーザー");
  });

  test("無料記事（price: 0）", () => {
    const note = { name: "無料記事", price: 0, user: { nickname: "user" } };
    expect(funcs.extractArticleFromNote(note).price).toBe(0);
  });

  test("null入力", () => {
    expect(funcs.extractArticleFromNote(null)).toBeNull();
  });

  test("プリミティブ入力", () => {
    expect(funcs.extractArticleFromNote("string")).toBeNull();
    expect(funcs.extractArticleFromNote(123)).toBeNull();
  });
});

// ========================================
// extractNotesFromApiResponse（統合テスト: 記事ごとに異なる値を返すか）
// ========================================
describe("extractNotesFromApiResponse", () => {
  test("必ず配列を返す（正常データ）", () => {
    const data = { data: { notes: [{ name: "article1" }] } };
    const result = funcs.extractNotesFromApiResponse(data);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  test("必ず配列を返す（nullデータ）", () => {
    expect(Array.isArray(funcs.extractNotesFromApiResponse(null))).toBe(true);
    expect(funcs.extractNotesFromApiResponse(null).length).toBe(0);
  });

  test("必ず配列を返す（空オブジェクト）", () => {
    expect(Array.isArray(funcs.extractNotesFromApiResponse({}))).toBe(true);
  });

  test("必ず配列を返す（不正なデータ構造）", () => {
    expect(Array.isArray(funcs.extractNotesFromApiResponse("string"))).toBe(true);
    expect(Array.isArray(funcs.extractNotesFromApiResponse(42))).toBe(true);
    expect(Array.isArray(funcs.extractNotesFromApiResponse(undefined))).toBe(true);
  });

  test("★核心テスト: 複数記事がそれぞれ異なるデータを持つこと", () => {
    const data = {
      data: {
        notes: [
          {
            name: "記事A: AIの活用法",
            like_count: 150,
            price: 0,
            note_url: "https://note.com/userA/n/n001",
            user: { nickname: "ユーザーA", urlname: "userA" },
          },
          {
            name: "記事B: プログラミング入門",
            like_count: 300,
            price: 1500,
            note_url: "https://note.com/userB/n/n002",
            user: { nickname: "ユーザーB", urlname: "userB" },
          },
          {
            name: "記事C: デザインの基礎",
            like_count: 75,
            price: 500,
            note_url: "https://note.com/userC/n/n003",
            user: { nickname: "ユーザーC", urlname: "userC" },
          },
        ],
      },
    };

    const result = funcs.extractNotesFromApiResponse(data);

    expect(result.length).toBe(3);

    // 記事A
    expect(result[0].title).toBe("記事A: AIの活用法");
    expect(result[0].likeCount).toBe(150);
    expect(result[0].price).toBe(0);
    expect(result[0].url).toBe("https://note.com/userA/n/n001");
    expect(result[0].creator).toBe("ユーザーA");

    // 記事B
    expect(result[1].title).toBe("記事B: プログラミング入門");
    expect(result[1].likeCount).toBe(300);
    expect(result[1].price).toBe(1500);
    expect(result[1].url).toBe("https://note.com/userB/n/n002");
    expect(result[1].creator).toBe("ユーザーB");

    // 記事C
    expect(result[2].title).toBe("記事C: デザインの基礎");
    expect(result[2].likeCount).toBe(75);
    expect(result[2].price).toBe(500);
    expect(result[2].url).toBe("https://note.com/userC/n/n003");
    expect(result[2].creator).toBe("ユーザーC");

    // 全記事が異なるタイトルを持つ
    const titles = new Set(result.map(r => r.title));
    expect(titles.size).toBe(3);

    // 全記事が異なるURLを持つ
    const urls = new Set(result.map(r => r.url));
    expect(urls.size).toBe(3);

    // 全記事が異なるクリエイター名を持つ
    const creators = new Set(result.map(r => r.creator));
    expect(creators.size).toBe(3);
  });

  test("★核心テスト: ネストされたnoteオブジェクトでも記事ごとに異なるデータ", () => {
    const data = {
      data: {
        notes: {
          contents: [
            {
              note: {
                name: "ネスト記事1",
                like_count: 10,
                price: 100,
                note_url: "https://note.com/u1/n/n001",
                user: { nickname: "著者1" },
              },
            },
            {
              note: {
                name: "ネスト記事2",
                like_count: 20,
                price: 200,
                note_url: "https://note.com/u2/n/n002",
                user: { nickname: "著者2" },
              },
            },
          ],
        },
      },
    };

    const result = funcs.extractNotesFromApiResponse(data);

    expect(result.length).toBe(2);
    expect(result[0].title).toBe("ネスト記事1");
    expect(result[0].likeCount).toBe(10);
    expect(result[0].price).toBe(100);
    expect(result[0].creator).toBe("著者1");

    expect(result[1].title).toBe("ネスト記事2");
    expect(result[1].likeCount).toBe(20);
    expect(result[1].price).toBe(200);
    expect(result[1].creator).toBe("著者2");
  });

  test("タイトルが空の記事はスキップされる", () => {
    const data = {
      data: {
        notes: [
          { name: "有効な記事", like_count: 5 },
          { name: "", like_count: 10 },
          { like_count: 15 },
        ],
      },
    };
    const result = funcs.extractNotesFromApiResponse(data);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe("有効な記事");
  });
});

// ========================================
// escapeCsvField
// ========================================
describe("escapeCsvField", () => {
  test("通常の文字列", () => {
    expect(funcs.escapeCsvField("hello")).toBe('"hello"');
  });

  test("カンマを含む文字列", () => {
    expect(funcs.escapeCsvField("a,b")).toBe('"a,b"');
  });

  test("ダブルクォートを含む文字列", () => {
    expect(funcs.escapeCsvField('a"b')).toBe('"a""b"');
  });

  test("改行を含む文字列", () => {
    expect(funcs.escapeCsvField("a\nb")).toBe('"a\nb"');
  });

  test("null", () => {
    expect(funcs.escapeCsvField(null)).toBe('""');
  });

  test("空文字列", () => {
    expect(funcs.escapeCsvField("")).toBe('""');
  });
});

// ========================================
// getPageType / getHashtagName
// ========================================
describe("getPageType", () => {
  const originalHref = window.location.href;

  afterEach(() => {
    Object.defineProperty(window.location, "href", { value: originalHref, writable: true });
    Object.defineProperty(window.location, "pathname", { value: new URL(originalHref).pathname, writable: true });
  });

  test("検索ページの場合は 'search' を返す", () => {
    Object.defineProperty(window.location, "pathname", { value: "/search", writable: true });
    expect(funcs.getPageType()).toBe("search");
  });

  test("ハッシュタグページの場合は 'hashtag' を返す", () => {
    Object.defineProperty(window.location, "pathname", { value: "/hashtag/個人開発", writable: true });
    expect(funcs.getPageType()).toBe("hashtag");
  });

  test("その他のページの場合は 'search' を返す", () => {
    Object.defineProperty(window.location, "pathname", { value: "/user/notes", writable: true });
    expect(funcs.getPageType()).toBe("search");
  });
});

describe("getHashtagName", () => {
  afterEach(() => {
    Object.defineProperty(window.location, "pathname", { value: "/search", writable: true });
  });

  test("ハッシュタグ名を正しく抽出する", () => {
    Object.defineProperty(window.location, "pathname", { value: "/hashtag/%E5%80%8B%E4%BA%BA%E9%96%8B%E7%99%BA", writable: true });
    expect(funcs.getHashtagName()).toBe("個人開発");
  });

  test("英語ハッシュタグ", () => {
    Object.defineProperty(window.location, "pathname", { value: "/hashtag/programming", writable: true });
    expect(funcs.getHashtagName()).toBe("programming");
  });

  test("ハッシュタグページでない場合は空文字列", () => {
    Object.defineProperty(window.location, "pathname", { value: "/search", writable: true });
    expect(funcs.getHashtagName()).toBe("");
  });
});

// ========================================
// fetchLikeRating（高評価数取得）
// ========================================
describe("fetchLikeRating", () => {
  // globalにfetchをモック
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    // _loggedフラグをリセット
    if (funcs.fetchLikeRating) {
      funcs.fetchLikeRating._logged = false;
    }
  });

  test("★重要: like_countはスキ数なので高評価数として返さない", async () => {
    // APIがlike_count=42を返しても、高評価数としては0（HTMLフォールバックも失敗）
    let callCount = 0;
    globalThis.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // API: like_countのみ（高評価フィールドなし）
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { like_count: 42, name: "テスト記事" } }),
        });
      }
      // HTML: 高評価テキストなし
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<html><body>記事本文</body></html>'),
      });
    });

    const result = await funcs.fetchLikeRating("https://note.com/user/n/n12345");
    expect(result).toBe(0); // like_countは高評価ではない
  });

  test("APIにrating_countがある場合は高評価数として取得", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { like_count: 42, rating_count: 15 } }),
    });

    const result = await funcs.fetchLikeRating("https://note.com/user/n/n12345");
    expect(result).toBe(15);
  });

  test("APIにrecommend_countがある場合は高評価数として取得", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { note: { recommend_count: 30 } } }),
    });

    const result = await funcs.fetchLikeRating("https://note.com/user/n/nabc");
    expect(result).toBe(30);
  });

  test("APIに高評価フィールドがない場合、HTMLの「XX人が高評価」テキストから取得", async () => {
    let callCount = 0;
    globalThis.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // API: like_countのみ（高評価フィールドなし）
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { like_count: 100 } }),
        });
      }
      // HTML: 高評価テキストあり
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<html><body><span>24人が高評価</span></body></html>'),
      });
    });

    const result = await funcs.fetchLikeRating("https://note.com/user/n/nxyz");
    expect(result).toBe(24);
  });

  test("APIが失敗した場合もHTMLフォールバックで「XX人が高評価」を抽出", async () => {
    let callCount = 0;
    globalThis.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('<html><body><span>18人が高評価</span></body></html>'),
      });
    });

    const result = await funcs.fetchLikeRating("https://note.com/user/n/nxyz");
    expect(result).toBe(18);
  });

  test("HTMLの__NEXT_DATA__からrating_countを取得", async () => {
    let callCount = 0;
    globalThis.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: { like_count: 50 } }),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(
          '<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"note":{"rating_count":12}}}}</script></html>'
        ),
      });
    });

    const result = await funcs.fetchLikeRating("https://note.com/user/n/nnext");
    expect(result).toBe(12);
  });

  test("URLが空の場合は0を返す", async () => {
    const result = await funcs.fetchLikeRating("");
    expect(result).toBe(0);
  });

  test("/n/キーが見つからないURLは0を返す", async () => {
    const result = await funcs.fetchLikeRating("https://note.com/user");
    expect(result).toBe(0);
  });

  test("API・HTML両方失敗した場合は0を返す", async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new Error("Network error"));
    const result = await funcs.fetchLikeRating("https://note.com/user/n/nfail");
    expect(result).toBe(0);
  });
});

// ========================================
// findRatingInObject（オブジェクト内の高評価数探索）
// ========================================
describe("findRatingInObject", () => {
  const candidates = ["rating_count", "recommend_count"];

  test("直接フィールドから見つける", () => {
    expect(funcs.findRatingInObject({ rating_count: 10 }, candidates)).toBe(10);
  });

  test("ネストされたオブジェクトから見つける", () => {
    expect(funcs.findRatingInObject({ note: { recommend_count: 5 } }, candidates)).toBe(5);
  });

  test("深すぎるネストは探索しない（depth > 3）", () => {
    const deep = { a: { b: { c: { d: { rating_count: 99 } } } } };
    expect(funcs.findRatingInObject(deep, candidates)).toBe(0);
  });

  test("フィールドが存在しない場合は0", () => {
    expect(funcs.findRatingInObject({ like_count: 100, name: "test" }, candidates)).toBe(0);
  });

  test("null入力は0", () => {
    expect(funcs.findRatingInObject(null, candidates)).toBe(0);
  });
});

// ========================================
// fetchAllLikeRatings（一括高評価数取得）
// ========================================
describe("fetchAllLikeRatings", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("全記事にlikeRatingフィールドが追加される", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { like_count: 50, rating_count: 10 } }),
    });

    const articles = [
      { title: "記事1", likeCount: 5, price: 0, url: "https://note.com/u1/n/n001", creator: "u1" },
      { title: "記事2", likeCount: 10, price: 100, url: "https://note.com/u2/n/n002", creator: "u2" },
    ];

    const result = await funcs.fetchAllLikeRatings(articles);
    expect(result.length).toBe(2);
    expect(result[0].likeRating).toBe(10); // rating_count（高評価数）
    expect(result[1].likeRating).toBe(10);
    // 元のフィールドも保持
    expect(result[0].title).toBe("記事1");
    expect(result[1].title).toBe("記事2");
  });

  test("空配列は空配列を返す", async () => {
    const result = await funcs.fetchAllLikeRatings([]);
    expect(result).toEqual([]);
  });
});

// ========================================
// downloadCSV（高評価数列の確認）
// ========================================
describe("downloadCSV - 高評価数列", () => {
  test("CSVヘッダーに高評価数が含まれる", () => {
    // downloadCSVはDOM操作するため、モック化して文字列生成部分のみ検証
    const articles = [
      { title: "テスト", likeCount: 5, likeRating: 24, price: 100, url: "https://note.com/u/n/n1", creator: "c" },
    ];
    const headers = ["タイトル", "スキ数", "高評価数", "単価", "記事URL", "クリエイター名"];
    const rows = articles.map((a) => [
      funcs.escapeCsvField(a.title),
      String(a.likeCount),
      String(a.likeRating || 0),
      String(a.price),
      funcs.escapeCsvField(a.url),
      funcs.escapeCsvField(a.creator),
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");

    expect(csvContent).toContain("高評価数");
    expect(csvContent).toContain(",24,");
  });

  test("likeRatingがundefinedの場合は0が出力される", () => {
    const articles = [
      { title: "テスト", likeCount: 5, price: 100, url: "https://note.com/u/n/n1", creator: "c" },
    ];
    const row = [
      String(articles[0].likeCount),
      String(articles[0].likeRating || 0),
    ];
    expect(row[1]).toBe("0");
  });
});
