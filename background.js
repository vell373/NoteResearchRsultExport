/**
 * Background Service Worker
 *
 * 拡張機能アイコンクリック時にSide Panelを開く
 */

chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});
