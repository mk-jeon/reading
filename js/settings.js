// settings.js — 설정 창: 기록 모드(저장소 연결), 사진 보관, 히스토리 분석, 화면, 앱 설치, 이 기기의 사본.

import { APP_NAME, APP_VERSION, CLAUDE_MODEL, DATA_BRANCH, LS, lsGet, lsSet, repoInfo } from './config.js';
import { confirmDialog, fmtDate, h, layersSettled, openModal, toast } from './dom.js';
import { setMode, state, subscribe, wipeDevice } from './store.js';
import { connect, disconnect, refreshViewer, scheduleSync, syncNow } from './sync.js';

let installEvent = null;

export function initInstall() {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvent = e; });
  window.addEventListener('appinstalled', () => { installEvent = null; });
}

export function applyTheme() {
  const theme = lsGet(LS.theme, 'system');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function seg(options, current, onPick) {
  return h('div', { class: 'seg', role: 'group' }, options.map(([value, label]) => h('button', {
    type: 'button', 'aria-pressed': String(value === current), onclick: () => onPick(value),
  }, label)));
}

function tokenForm(repaint) {
  const { owner, repo } = repoInfo();
  const input = h('input', { class: 'input', id: 'gh-token', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'github_pat_…' });
  const err = h('p', { class: 'field-error', role: 'alert' });
  const btn = h('button', { class: 'btn btn--primary', type: 'submit' }, '연결');
  return h('form', {
    class: 'form', novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const token = input.value.trim();
      if (!token) { err.textContent = '토큰을 붙여 넣어 주세요.'; input.focus(); return; }
      if (!/^[A-Za-z0-9_]{20,255}$/.test(token)) { err.textContent = '토큰 모양이 아닙니다. github_pat_ 로 시작하는 글자 전체를 빈칸 없이 붙여 넣어 주세요.'; input.focus(); return; }
      btn.disabled = true;
      btn.textContent = '확인하는 중';
      err.textContent = '';
      try {
        const ok = await connect(token);
        toast(ok ? '저장소에 연결했습니다. 이제 여기서 적은 것이 저장소에 쌓입니다.' : '연결은 됐지만 첫 저장에 실패했습니다. 아래 상태를 확인해 주세요.');
        repaint();
      } catch (ex) {
        err.textContent = ex.message || '연결하지 못했습니다.';
        btn.disabled = false;
        btn.textContent = '연결';
      }
    },
  },
  h('ol', { class: 'steps' },
    h('li', null, 'GitHub에서 Fine-grained 토큰을 새로 만듭니다. ', h('a', { href: 'https://github.com/settings/personal-access-tokens/new', target: '_blank', rel: 'noopener' }, '토큰 만들기 화면 열기')),
    h('li', null, `Repository access는 Only select repositories에서 ${repo} 하나만 고릅니다.`),
    h('li', null, 'Permissions의 Repository permissions에서 Contents를 Read and write로 둡니다.'),
    h('li', null, '만든 토큰을 아래에 붙여 넣습니다.')),
  h('div', { class: 'field' },
    h('label', { class: 'field-label', for: 'gh-token' }, `${owner}/${repo} 토큰`),
    input,
    h('p', { class: 'field-help' }, '토큰은 이 기기에만 보관하고, GitHub로만 보냅니다. 기기마다 한 번씩 넣습니다.')),
  err,
  h('div', { class: 'set-row' }, btn));
}

function syncGroup(repaint) {
  const { owner, repo } = repoInfo();
  if (state.mode === 'owner') {
    const s = state.sync;
    const label = { saved: '저장됨', syncing: '올리는 중', pending: '저장 대기', offline: '오프라인', error: '저장 오류', idle: '연결됨' }[s.status] || '연결됨';
    const cls = s.status === 'error' ? 'chip chip--bad' : (s.status === 'pending' || s.status === 'offline') ? 'chip chip--wait' : 'chip chip--ok';
    return h('section', { class: 'set-group' },
      h('h3', { class: 'set-title' }, '기록 모드'),
      h('div', { class: 'set-row' }, h('span', { class: cls }, label), h('span', { class: 'note' }, `${owner}/${repo} 의 ${DATA_BRANCH} 브랜치`)),
      s.error ? h('p', { class: 'field-error' }, s.error) : null,
      h('p', { class: 'note' }, s.lastAt ? `마지막으로 맞춘 날 ${fmtDate(s.lastAt)}` : '아직 맞춘 적이 없습니다.'),
      h('div', { class: 'set-row' },
        h('button', { class: 'btn btn--sm', type: 'button', disabled: s.status === 'syncing', onclick: async (e) => {
          e.currentTarget.disabled = true;
          const ok = await syncNow();
          toast(ok ? '저장소와 맞췄습니다.' : '맞추지 못했습니다. 상태를 확인해 주세요.');
          repaint();
        } }, '지금 맞추기'),
        h('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: async () => {
          const yes = await confirmDialog({ title: '연결 끊기', message: '이 기기에서 토큰과 Claude 키를 지우고 구경 모드로 돌아갑니다. 저장소의 기록은 그대로입니다.', confirmLabel: '끊기' });
          if (yes) { await disconnect(); lsSet(LS.claudeKey, null); repaint(); }
        } }, '연결 끊기')));
  }
  return h('section', { class: 'set-group' },
    h('h3', { class: 'set-title' }, '기록 모드'),
    h('p', { class: 'note' }, state.mode === 'local'
      ? '지금은 이 기기에만 저장하고 있습니다. 저장소에 연결하면 여기서 적은 것이 그대로 올라가고, 다른 기기에서도 이어 쓸 수 있습니다.'
      : '지금은 구경 모드입니다. 기록하려면 저장소에 쓸 수 있는 토큰이 필요합니다.'),
    tokenForm(repaint),
    h('div', { class: 'set-row' }, state.mode === 'local'
      ? h('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: async () => { await setMode('viewer'); await refreshViewer(); repaint(); } }, '구경 모드로 돌아가기')
      : h('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: async () => { await setMode('local'); toast('이 기기에서만 써 봅니다. 저장소로는 올라가지 않습니다.'); repaint(); } }, '토큰 없이 이 기기에서만 써 보기')));
}

function photoGroup(repaint) {
  if (state.mode !== 'owner') return null;
  const remote = lsGet(LS.photosRemote, '1') !== '0';
  return h('section', { class: 'set-group' },
    h('h3', { class: 'set-title' }, '사진 보관'),
    seg([['1', '저장소에 올리기'], ['0', '이 기기에만']], remote ? '1' : '0', (v) => { lsSet(LS.photosRemote, v); if (v === '1') scheduleSync(300); repaint(); }),
    h('p', { class: 'note' }, remote
      ? '저장소가 공개라서, 올린 사진은 누구나 볼 수 있습니다. 다른 기기에서도 보입니다.'
      : '사진은 찍은 기기에서만 보입니다. 이미 올린 사진은 저장소에 남아 있습니다.'));
}

function analyzeGroup(repaint) {
  if (state.mode === 'viewer') return null;
  const has = Boolean(lsGet(LS.claudeKey));
  const key = h('input', { class: 'input', id: 'claude-key', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: has ? '저장된 키가 있습니다' : 'sk-ant-…' });
  const model = h('input', { class: 'input', id: 'claude-model', autocomplete: 'off', spellcheck: 'false' });
  model.value = lsGet(LS.claudeModel) || CLAUDE_MODEL;
  return h('section', { class: 'set-group' },
    h('h3', { class: 'set-title' }, '히스토리 분석'),
    h('p', { class: 'note' }, '키가 없으면 리뷰에 직접 쓴 한 줄과 읽기 전·후를 그대로 연혁에 옮깁니다. Claude API 키를 넣으면, 새로 쓴 리뷰와 이전 요약만 보내 한 줄과 달라진 점을 받아 옵니다.'),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'claude-key' }, 'Claude API 키 (선택)'), key,
      h('p', { class: 'field-help' }, '이 기기에만 보관하고, 분석할 때 api.anthropic.com 으로만 보냅니다.')),
    h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'claude-model' }, '모델'), model),
    h('div', { class: 'set-row' },
      h('button', { class: 'btn btn--sm', type: 'button', onclick: () => {
        const k = key.value.trim();
        const m = model.value.trim();
        if (k && !/^[A-Za-z0-9_-]{20,300}$/.test(k)) { toast('키 모양이 아닙니다. sk-ant- 로 시작하는 글자 전체를 빈칸 없이 붙여 넣어 주세요.'); return; }
        if (m && !/^[A-Za-z0-9._-]{3,80}$/.test(m)) { toast('모델 이름에는 영문, 숫자, 점, 줄표만 쓸 수 있습니다.'); return; }
        if (k) lsSet(LS.claudeKey, k);
        lsSet(LS.claudeModel, m && m !== CLAUDE_MODEL ? m : null);
        toast('분석 설정을 저장했습니다.');
        repaint();
      } }, '저장'),
      has ? h('button', { class: 'btn btn--sm btn--quiet', type: 'button', onclick: () => { lsSet(LS.claudeKey, null); toast('키를 지웠습니다.'); repaint(); } }, '키 지우기') : null));
}

function themeGroup(repaint) {
  return h('section', { class: 'set-group' },
    h('h3', { class: 'set-title' }, '화면'),
    seg([['system', '기기 설정대로'], ['light', '밝게'], ['dark', '어둡게']], lsGet(LS.theme, 'system'), (v) => { lsSet(LS.theme, v === 'system' ? null : v); applyTheme(); repaint(); }));
}

function installGroup(repaint) {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  let body;
  if (standalone) body = h('p', { class: 'note' }, '앱으로 실행 중입니다.');
  else if (installEvent) {
    body = h('div', { class: 'set-row' }, h('button', { class: 'btn btn--sm', type: 'button', onclick: async () => {
      const ev = installEvent;
      installEvent = null;
      await ev.prompt();
      repaint();
    } }, '앱으로 설치'));
  } else body = h('p', { class: 'note' }, '브라우저 메뉴에서 「앱 설치」나 「홈 화면에 추가」를 누르면 앱처럼 열립니다.');
  return h('section', { class: 'set-group' }, h('h3', { class: 'set-title' }, '앱 설치'), body);
}

function dataGroup(repaint, modal) {
  if (state.mode === 'viewer') return null;
  return h('section', { class: 'set-group' },
    h('h3', { class: 'set-title' }, '이 기기의 사본'),
    h('div', { class: 'set-row' },
      h('button', { class: 'btn btn--sm', type: 'button', onclick: () => {
        const blob = new Blob([JSON.stringify(state.lib, null, 1)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: `dogam-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } }, '기록 내려받기'),
      h('button', { class: 'btn btn--sm btn--danger', type: 'button', onclick: async () => {
        const yes = await confirmDialog({
          title: '이 기기의 사본 지우기',
          message: state.mode === 'owner'
            ? '이 기기에 둔 기록 사본과 사진을 지웁니다. 저장소의 기록은 그대로이고, 다음에 맞출 때 다시 받아 옵니다. 아직 저장소에 올리지 않은 기록과 사진은 사라집니다.'
            : '이 기기에만 있던 기록과 사진을 모두 지웁니다. 되돌릴 수 없습니다.',
          confirmLabel: '지우기', danger: true,
        });
        if (!yes) return;
        await wipeDevice();
        if (state.mode === 'owner') scheduleSync(300);
        toast('이 기기의 사본을 지웠습니다.');
        await layersSettled();
        modal.close();
      } }, '사본 지우기')));
}

export function openSettings() {
  const body = h('div', { class: 'settings' });
  let modal = null;
  const repaint = () => {
    if (!body.isConnected && modal) return;
    body.replaceChildren(...[syncGroup(repaint), photoGroup(repaint), analyzeGroup(repaint), themeGroup(repaint), installGroup(repaint), dataGroup(repaint, modal),
      h('section', { class: 'set-group' }, h('p', { class: 'note' }, `${APP_NAME} ${APP_VERSION}`), h('p', { class: 'note' }, '앱은 main 브랜치, 기록은 data 브랜치에 있습니다.'))].filter(Boolean));
  };
  const off = subscribe((type) => { if (type === 'sync' || type === 'mode') repaint(); });
  modal = openModal({ title: '설정', content: body, onClose: off });
  repaint();
}
