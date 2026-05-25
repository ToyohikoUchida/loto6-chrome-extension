const BATCH_SIZE = 25;
const AUTOFILL_KEY = 'loto6_autofill';

(async () => {
  const stored = await chrome.storage.local.get(AUTOFILL_KEY);
  const autofill = stored[AUTOFILL_KEY];
  if (!autofill?.combinations?.length) return;

  // 30分以上経過したデータは無効
  if (Date.now() - autofill.timestamp > 30 * 60 * 1000) {
    await chrome.storage.local.remove(AUTOFILL_KEY);
    return;
  }

  // ① 確認ページ検出（「買い物を続ける」ボタンがある）
  const continueBtn = document.querySelector('[opename="買い物を続ける"]');
  if (continueBtn) {
    await handleConfirmationPage(autofill, continueBtn);
    return;
  }

  // ② LOTO6入力ページ検出（数字ボタンがある）
  try {
    await waitForElement('.m_lotteryNumInputNum_btn', 8000);
  } catch {
    // 入力ページでも確認ページでもない（ECトップ等）→ 案内を表示
    showPendingNotice(autofill);
    return;
  }

  await handleInputPage(autofill);
})();

// ===== ページ処理 =====

async function handleInputPage(autofill) {
  const currentIndex = autofill.currentIndex ?? 0;
  const total = autofill.combinations.length;
  const remaining = autofill.combinations.slice(currentIndex);
  const batch = remaining.slice(0, BATCH_SIZE);

  const statusUI = createStatusUI();
  document.body.appendChild(statusUI);

  try {
    await fillCombinations(batch, currentIndex, total, statusUI);

    // 進捗を保存
    const newIndex = currentIndex + batch.length;
    await chrome.storage.local.set({
      [AUTOFILL_KEY]: { ...autofill, currentIndex: newIndex, timestamp: Date.now() }
    });

    // 「カートに入れる」ボタンを探してクリック
    setStatus(statusUI, `${batch.length}組入力完了。カートに追加中…`, 'active');
    await delay(800);

    const cartBtn = findButtonByText('カートに入れる');
    if (cartBtn) {
      cartBtn.click();
    } else {
      setStatus(statusUI, '⚠️ 「カートに入れる」ボタンが見つかりません。手動でクリックしてください。', 'error');
    }
  } catch (e) {
    setStatus(statusUI, `⚠️ エラー: ${e.message}`, 'error');
  }
}

async function handleConfirmationPage(autofill, continueBtn) {
  const currentIndex = autofill.currentIndex ?? 0;
  const total = autofill.combinations.length;

  const statusUI = createStatusUI();
  document.body.appendChild(statusUI);

  if (currentIndex >= total) {
    // 全組み合わせ入力完了
    setStatus(statusUI, `✅ 全${total}組の入力完了！\nお支払い内容のご確認へ進んでください。`, 'done');
    await chrome.storage.local.remove(AUTOFILL_KEY);
    return;
  }

  // まだ残りがある → 「買い物を続ける」を自動クリック
  const remaining = total - currentIndex;
  setStatus(
    statusUI,
    `入力済 ${currentIndex}/${total}組\n残り${remaining}組 → 「買い物を続ける」へ移動します`,
    'active'
  );

  // タイムスタンプ更新（鮮度維持）
  await chrome.storage.local.set({
    [AUTOFILL_KEY]: { ...autofill, timestamp: Date.now() }
  });

  await delay(1500);
  continueBtn.click();
}

function showPendingNotice(autofill) {
  const currentIndex = autofill.currentIndex ?? 0;
  const remaining = autofill.combinations.length - currentIndex;
  if (remaining <= 0) return;

  const statusUI = createStatusUI();
  statusUI.style.cursor = 'default';
  document.body.appendChild(statusUI);
  setStatus(
    statusUI,
    `残り${remaining}組があります。\nLOTO6購入ページを開くと\n自動で入力を再開します。`,
    'active'
  );
}

// ===== 組み合わせ入力 =====

async function fillCombinations(batch, startIndex, total, statusUI) {
  for (let i = 0; i < batch.length; i++) {
    const combo = batch[i];
    const globalIdx = startIndex + i + 1;
    setStatus(
      statusUI,
      `入力中 ${globalIdx}/${total}組\n[${combo.numbers.join(' ')}] ${combo.kuchiCount}口`,
      'active'
    );

    await waitFor(() => !!getActivePanel());
    const panel = getActivePanel();

    // リセットボタンで初期化
    const resetBtn = panel.querySelector('.m_lotteryNumInputNum_btn2');
    if (resetBtn) {
      resetBtn.click();
      await delay(400);
    }

    // 数字ボタンを1つずつクリック
    for (const num of combo.numbers) {
      const buttons = panel.querySelectorAll('.m_lotteryNumInputNum_btn');
      let clicked = false;
      for (const btn of buttons) {
        if (btn.textContent.trim() === String(num)) {
          btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) throw new Error(`数字 ${num} のボタンが見つかりません`);
      await delay(150);
    }

    // 「次の申込数字へ」が有効になるまで待機
    const nextBtn = panel.querySelector('.m_lotteryNumInputForm_btn');
    await waitFor(
      () => nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('is_disabled')
    );

    // 口数を設定（Vue.js対応）
    const kuchiSelect = panel.querySelector('.m_lotteryNumInputForm_select select');
    if (kuchiSelect) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      nativeSetter.call(kuchiSelect, String(Math.min(combo.kuchiCount, 10)));
      kuchiSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(200);
    }

    // 「次の申込数字へ」をクリック（全組み合わせ。クリックで組み合わせが登録される）
    nextBtn.click();
    await delay(600);
  }
}

// ===== ユーティリティ =====

function findButtonByText(text) {
  return [...document.querySelectorAll('button, a')].find(
    el => el.textContent.trim().includes(text)
  ) || null;
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(selector)) return resolve();
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout: ${selector}`));
    }, timeout);
  });
}

function waitFor(condition, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error('Timeout'));
      setTimeout(check, 200);
    };
    check();
  });
}

const delay = ms => new Promise(r => setTimeout(r, ms));

function getActivePanel() {
  return [...document.querySelectorAll('.m_lotteryNumBodyItemWrap')].find(
    el => el.style.display !== 'none'
  );
}

// ===== フローティングUI =====

function createStatusUI() {
  const div = document.createElement('div');
  div.id = 'loto6-autofill-status';
  Object.assign(div.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    zIndex: '99999',
    background: '#fff',
    border: '2px solid #0b72d9',
    borderRadius: '10px',
    padding: '12px 16px',
    fontSize: '13px',
    fontFamily: 'sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
    maxWidth: '260px',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
  });
  div.innerHTML = `
    <div style="font-weight:bold;margin-bottom:4px;color:#0b72d9;">LOTO6 自動入力補助</div>
    <div id="loto6-status-msg">準備中…</div>
  `;
  return div;
}

function setStatus(ui, msg, state) {
  const el = ui.querySelector('#loto6-status-msg');
  if (el) el.textContent = msg;
  const colors = { done: '#080', error: '#c00', active: '#0b72d9' };
  ui.style.borderColor = colors[state] || '#0b72d9';
}
