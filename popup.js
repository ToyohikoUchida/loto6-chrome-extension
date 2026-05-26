document.addEventListener('DOMContentLoaded', async () => {
  const content = document.getElementById('content');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const isSelectlotoPage =
    tab?.url?.includes('selectloto.jp') ||
    tab?.url?.includes('loto6_saved_history_by_round_detail');

  if (!isSelectlotoPage) {
    content.innerHTML =
      '<div class="msg error">selectloto.jp の<br>LOTO6詳細ページで開いてください</div>';
    return;
  }

  let result;
  try {
    result = await chrome.tabs.sendMessage(tab.id, { type: 'GET_COMBINATIONS' });
  } catch {
    content.innerHTML =
      '<div class="msg error">データを読み込めませんでした。<br>ページを再読み込みしてください。</div>';
    return;
  }

  if (!result) {
    content.innerHTML =
      '<div class="msg error">データを読み込めませんでした。<br>ページを再読み込みしてください。</div>';
    return;
  }

  if (result.error === 'drawn') {
    content.innerHTML =
      '<div class="msg error">この抽せん回はすでに抽選済みです。<br>未抽選の回のページで開いてください。</div>';
    return;
  }

  const { drawRound, combinations } = result;

  if (!combinations || combinations.length === 0) {
    content.innerHTML = '<div class="msg">組み合わせデータがありません</div>';
    return;
  }

  content.innerHTML = `
    <div class="subtitle">第${drawRound}回 ／ ${combinations.length}組</div>
    <div class="toolbar">
      <button id="selectAll">全選択 / 解除</button>
    </div>
    <div class="combo-list" id="comboList"></div>
    <div class="actions">
      <button id="startBtn">公式サイトで入力開始</button>
    </div>
    <div class="status" id="status"></div>
  `;

  const comboList = document.getElementById('comboList');
  combinations.forEach((combo, i) => {
    const div = document.createElement('div');
    div.className = 'combo-item';
    const nums = combo.numbers
      .map(n => `<span class="num-chip">${String(n).padStart(2, '0')}</span>`)
      .join('');
    div.innerHTML = `
      <input type="checkbox" id="c${i}" checked data-index="${i}">
      <label for="c${i}" class="combo-numbers">${nums}</label>
      <span class="kuchi-badge">${combo.kuchiCount}口</span>
      <span class="set-label">S${combo.setNumber}</span>
    `;
    comboList.appendChild(div);
  });

  let allChecked = true;
  document.getElementById('selectAll').addEventListener('click', () => {
    allChecked = !allChecked;
    document.querySelectorAll('#comboList input[type="checkbox"]').forEach(
      cb => (cb.checked = allChecked)
    );
  });

  document.getElementById('startBtn').addEventListener('click', async () => {
    const selected = [...document.querySelectorAll('#comboList input[type="checkbox"]:checked')].map(
      cb => combinations[parseInt(cb.dataset.index)]
    );

    const statusEl = document.getElementById('status');
    if (selected.length === 0) {
      statusEl.textContent = '組み合わせを選択してください';
      return;
    }

    await chrome.storage.local.set({
      loto6_autofill: {
        drawRound,
        combinations: selected,
        timestamp: Date.now(),
      },
    });

    statusEl.className = 'status ok';
    statusEl.textContent = `✅ ${selected.length}組を保存しました。公式サイトの購入ページを開いてください。`;
    document.getElementById('startBtn').disabled = true;
  });
});
