// selectloto.jp ページからLOTO6の組み合わせデータを読み取り、popupへ返す
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'GET_COMBINATIONS') return;

  // このフレームにテーブルがなければ応答しない（親フレームの誤応答を防ぐ）
  if (!document.getElementById('combinationTable')) return;

  const drawRound = new URLSearchParams(location.search).get('draw_round') || '';
  const rows = document.querySelectorAll('#combinationTable tbody tr');

  const combinations = [];
  rows.forEach(tr => {
    const cells = tr.querySelectorAll('td');
    if (cells.length < 4) return;

    // 数字はspan.circle-backgroundのテキストから取得
    const numberSpans = cells[2].querySelectorAll('.circle-background');
    const numbers = [...numberSpans]
      .map(s => parseInt(s.textContent.trim(), 10))
      .filter(n => !isNaN(n));

    const kuchiCount = parseInt(cells[3].textContent.trim(), 10) || 1;
    const setNumber = cells[1].textContent.trim();

    if (numbers.length === 6) {
      combinations.push({ setNumber, numbers, kuchiCount });
    }
  });

  sendResponse({ drawRound, combinations });
  return true;
});
