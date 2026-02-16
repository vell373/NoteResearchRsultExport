document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("startBtn");
  const countInput = document.getElementById("count");
  const statusEl = document.getElementById("status");
  const progressBar = document.getElementById("progressBar");
  const progressFill = document.getElementById("progressFill");

  function setStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
  }

  function setProgress(current, total) {
    progressBar.classList.add("active");
    const pct = Math.min((current / total) * 100, 100);
    progressFill.style.width = `${pct}%`;
  }

  function resetUI() {
    startBtn.disabled = false;
    startBtn.textContent = "データ取得開始";
    progressBar.classList.remove("active");
    progressFill.style.width = "0%";
  }

  startBtn.addEventListener("click", async () => {
    const count = parseInt(countInput.value, 10);

    if (isNaN(count) || count < 1) {
      setStatus("取得件数を1以上の数値で入力してください。", "error");
      return;
    }

    // アクティブタブを取得
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !tab.url || !tab.url.includes("note.com/search")) {
      setStatus(
        "note.comの検索結果ページを開いた状態で実行してください。",
        "error"
      );
      return;
    }

    startBtn.disabled = true;
    startBtn.textContent = "取得中...";
    setStatus("データ取得を開始しています...", "info");
    setProgress(0, count);

    // Content Scriptにメッセージ送信
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: "startScraping",
        count: count,
      });

      if (response && response.status === "started") {
        setStatus("自動スクロールでデータを収集中...", "info");
        pollProgress(tab.id, count);
      } else {
        setStatus(
          "Content Scriptとの通信に失敗しました。ページをリロードしてください。",
          "error"
        );
        resetUI();
      }
    } catch (err) {
      setStatus(
        "Content Scriptとの通信に失敗しました。ページをリロードして再度お試しください。",
        "error"
      );
      resetUI();
    }
  });

  function pollProgress(tabId, totalCount) {
    const interval = setInterval(async () => {
      try {
        const response = await chrome.tabs.sendMessage(tabId, {
          action: "getProgress",
        });

        if (!response) {
          clearInterval(interval);
          setStatus("通信エラーが発生しました。", "error");
          resetUI();
          return;
        }

        setProgress(response.current, totalCount);

        if (response.status === "completed") {
          clearInterval(interval);
          setStatus(
            `${response.current}件のデータを取得しました。CSVをダウンロードしています...`,
            "success"
          );
          resetUI();
        } else if (response.status === "error") {
          clearInterval(interval);
          setStatus(`エラー: ${response.message}`, "error");
          resetUI();
        } else {
          setStatus(
            `データ収集中... ${response.current} / ${totalCount} 件`,
            "info"
          );
        }
      } catch (err) {
        clearInterval(interval);
        setStatus("通信エラーが発生しました。", "error");
        resetUI();
      }
    }, 1000);
  }
});
