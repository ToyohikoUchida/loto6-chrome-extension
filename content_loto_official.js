const BATCH_SIZE = 25;
const AUTOFILL_KEY = 'loto6_autofill';

(async () => {
  const stored = await chrome.storage.local.get(AUTOFILL_KEY);
  const autofill = stored[AUTOFILL_KEY];
  if (!autofill?.combinations?.length) return;

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

  // ② ECトップページ検出（glonaviLoto6Form がある → LOTO6購入ページへ自動遷移）
  const loto6Form = document.getElementById('glonaviLoto6Form');
  if (loto6Form) {
    await handleEcTopPage(autofill, loto6Form);
    return;
  }

  // ③ LOTO6入力ページ検出
  try {
    await waitForElement('.m_lotteryNumInputNum_btn', 8000);
  } catch {
    showPendingNotice(autofill);
    return;
  }

  await handleInputPage(autofill);
})();

// ===== ページ処理 =====

async function handleInputPage(autofill) {
  const currentIndex = autofill.currentIndex ?? 0;
  const total = autofill.combinations.length;
  const batch = autofill.combinations.slice(currentIndex, currentIndex + BATCH_SIZE);

  const statusUI = createStatusUI();
  document.body.appendChild(statusUI);

  try {
    await fillCombinations(batch, currentIndex, total, statusUI);

    const newIndex = currentIndex + batch.length;
    await chrome.storage.local.set({
      [AUTOFILL_KEY]: { ...autofill, currentIndex: newIndex, timestamp: Date.now() }
    });

    // 「カートに入れる」ボタンを探してクリック
    setStatus(statusUI, `${batch.length}組入力完了。カートに追加中…`, 'active');
    await delay(800);

    const cartBtn = findEnabledButton('カートに入れる');
    if (cartBtn) {
      cartBtn.click();
    } else {
      setStatus(statusUI, '⚠️ 「カートに入れる」が見つかりません。手動でクリックしてください。', 'error');
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
    setStatus(statusUI, `✅ 全${total}組の入力完了！\nお支払い内容のご確認へ進んでください。`, 'done');
    await chrome.storage.local.remove(AUTOFILL_KEY);
    return;
  }

  const remaining = total - currentIndex;
  setStatus(statusUI, `入力済 ${currentIndex}/${total}組\n残り${remaining}組 → 「買い物を続ける」へ移動します`, 'active');
  await chrome.storage.local.set({
    [AUTOFILL_KEY]: { ...autofill, timestamp: Date.now() }
  });
  await delay(1500);
  continueBtn.click();
}

async function handleEcTopPage(autofill, loto6Form) {
  const remaining = autofill.combinations.length - (autofill.currentIndex ?? 0);
  const statusUI = createStatusUI();
  document.body.appendChild(statusUI);
  setStatus(statusUI, `残り${remaining}組 → LOTO6購入ページへ移動します`, 'active');

  await chrome.storage.local.set({
    [AUTOFILL_KEY]: { ...autofill, timestamp: Date.now() }
  });
  await delay(1200);
  loto6Form.submit();
}

function showPendingNotice(autofill) {
  const remaining = autofill.combinations.length - (autofill.currentIndex ?? 0);
  if (remaining <= 0) return;
  const ui = createStatusUI();
  document.body.appendChild(ui);
  setStatus(ui, `残り${remaining}組があります。\nLOTO6購入ページを開くと\n自動で入力を再開します。`, 'active');
}

// ===== 組み合わせ入力 =====

async function fillCombinations(batch, startIndex, total, statusUI) {
  for (let i = 0; i < batch.length; i++) {
    const combo = batch[i];
    const globalIdx = startIndex + i + 1;
    setStatus(statusUI, `入力中 ${globalIdx}/${total}組\n[${combo.numbers.join(' ')}] ${combo.kuchiCount}口`, 'active');

    // アクティブパネルを待つ
    await waitFor(() => !!getActivePanel());
    const panel = getActivePanel();

    // リセット
    const resetBtn = panel.querySelector('.m_lotteryNumInputNum_btn2');
    if (resetBtn) { resetBtn.click(); await delay(400); }

    // 数字を1つずつクリック
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

    // 口数を設定
    const kuchiSelect = panel.querySelector('.m_lotteryNumInputForm_select select');
    if (kuchiSelect) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      nativeSetter.call(kuchiSelect, String(Math.min(combo.kuchiCount, 10)));
      kuchiSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(200);
    }

    // 「次の申込数字へ」か「カートに入れる」のどちらかが有効になるまで待機
    await waitFor(() => isNextBtnReady(panel) || !!findEnabledButton('カートに入れる'));

    if (isNextBtnReady(panel)) {
      panel.querySelector('.m_lotteryNumInputForm_btn').click();
      await delay(600);
    } else {
      // カートに入れるボタンが現れた → ループを抜けて外側でクリック
      break;
    }
  }
}

// ===== ユーティリティ =====

function isNextBtnReady(panel) {
  const btn = panel.querySelector('.m_lotteryNumInputForm_btn');
  return btn && !btn.disabled && !btn.classList.contains('is_disabled');
}

function findEnabledButton(text) {
  return [...document.querySelectorAll('button, a')].find(
    el => el.textContent.trim().includes(text) && !el.disabled
  ) || null;
}

function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(selector)) return resolve();
    const observer = new MutationObserver(() => {
      if (document.querySelector(selector)) { observer.disconnect(); resolve(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); reject(new Error(`Timeout: ${selector}`)); }, timeout);
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
    position: 'fixed', top: '16px', right: '16px', zIndex: '99999',
    background: '#fff', border: '2px solid #0b72d9', borderRadius: '10px',
    padding: '12px 16px', fontSize: '13px', fontFamily: 'sans-serif',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)', maxWidth: '260px',
    lineHeight: '1.6', whiteSpace: 'pre-wrap',
  });
  div.innerHTML = `<div style="font-weight:bold;margin-bottom:4px;color:#0b72d9;">LOTO6 自動入力補助</div><div id="loto6-status-msg">準備中…</div>`;
  return div;
}

function setStatus(ui, msg, state) {
  const el = ui.querySelector('#loto6-status-msg');
  if (el) el.textContent = msg;
  ui.style.borderColor = { done: '#080', error: '#c00', active: '#0b72d9' }[state] || '#0b72d9';
}
