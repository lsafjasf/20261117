// 主控制器：双人键盘输入、HUD、录制、回放、保护状态

import { VentilationGame, keyToAction, STATIONS, CONFIG } from './engine.js';
import { Recorder, ReplayPlayer, seededRng } from './replay.js';
import { ReplayStore, makeReplayEntry } from './storage.js';
import { MineView } from './render.js';

const $ = (sel) => document.querySelector(sel);
const fmt = (s) => {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};

class App {
  constructor() {
    this.seed = (Date.now() % 100000) + 1;
    this.game = new VentilationGame({ rng: seededRng(this.seed) });
    this.recorder = new Recorder(this.seed, {
      targetSafeSeconds: this.game.targetSafeSeconds,
      timeoutSeconds: this.game.timeoutSeconds,
    });
    this.view = new MineView($('#mine'));
    this.view.resize();
    this.replay = null;
    this.replayTimer = null;
    this._last = 0;
    this._bindKeys();
    this._bindButtons();
    window.addEventListener('resize', () => this.view.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.game.status === 'running') {
        this._pause();
      }
    });
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
    this._renderHud();
  }

  _bindKeys() {
    const guarded = new Set(['KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'Space']);
    document.addEventListener('keydown', (e) => {
      if (guarded.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      if (e.code === 'KeyP' || e.code === 'Escape') {
        return this._togglePause();
      }
      if (e.code === 'KeyR') return this._restart();
      if (e.code === 'KeyD') return this._toggleDebug();
      const mapped = keyToAction(e.code);
      if (mapped) this._routeInput(mapped.station, mapped.action, true);
    });
    document.addEventListener('keyup', (e) => {
      if (guarded.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      const mapped = keyToAction(e.code);
      if (mapped) this._routeInput(mapped.station, mapped.action, false);
    });
  }

  _routeInput(station, action, pressed) {
    const ok = this.game.input(station, action, pressed);
    if (ok) {
      this.recorder.recordInput(this.game.simTime, station, action, pressed);
    } else if (pressed) {
      this._flashReject(station);
    }
  }

  _bindButtons() {
    $('#btn-pause').addEventListener('click', () => this._togglePause());
    $('#btn-restart').addEventListener('click', () => this._restart());
    $('#btn-debug').addEventListener('click', () => this._toggleDebug());
    $('#btn-save-replay').addEventListener('click', () => this._saveReplay());
    $('#btn-replay-list').addEventListener('click', () => this._renderReplayList());
    $('#btn-clear-replays').addEventListener('click', () => {
      ReplayStore.clear();
      this._renderReplayList();
    });
    $('#btn-stop-replay').addEventListener('click', () => this._stopReplay());
    $('#sim-disconnect-up').addEventListener('click', () => this._toggleConnection('upstream'));
    $('#sim-disconnect-down').addEventListener('click', () => this._toggleConnection('downstream'));
  }

  _toggleConnection(stationId) {
    const next = !this.game.stations[stationId].connected;
    this.game.setConnected(stationId, next);
    this.recorder.recordLifecycle(this.game.simTime, 'connection',
      { station: stationId, connected: next });
    this._renderHud();
  }

  _togglePause() {
    if (this.game.status === 'running') this._pause();
    else if (this.game.status === 'paused') this._resume();
  }

  _pause() {
    this.game.pause();
    this.recorder.recordLifecycle(this.game.simTime, 'pause');
    this._renderHud();
  }

  _resume() {
    this.game.resume();
    this.recorder.recordLifecycle(this.game.simTime, 'resume');
  }

  _restart() {
    this._stopReplay();
    this.seed = (Date.now() % 100000) + 1;
    this.game = new VentilationGame({ rng: seededRng(this.seed) });
    this.recorder = new Recorder(this.seed, {
      targetSafeSeconds: this.game.targetSafeSeconds,
      timeoutSeconds: this.game.timeoutSeconds,
    });
    this.game.restart();
    this._renderHud();
  }

  _toggleDebug() {
    if (this.game.mode === 'debug') {
      this.game.setDebug(false);
    } else {
      const station = $('#debug-station').value;
      const scale = Number($('#debug-scale').value);
      this.game.setDebug(true, station, scale);
    }
    this.recorder.recordLifecycle(this.game.simTime, 'debug', {
      enabled: this.game.mode === 'debug',
      station: this.game.humanStation,
      scale: this.game.timeScale,
    });
    this._renderHud();
  }

  _saveReplay() {
    const state = this.game.getState();
    for (const ev of this.game.events) {
      if (!this.recorder.events.some((r) => r.t === ev.t && r.msg === ev.msg)) {
        this.recorder.recordEvent(ev);
      }
    }
    this.recorder.maybeSnapshot(this.game.simTime + 0.01, state);
    const id = ReplayStore.save(
      makeReplayEntry(this.recorder, state, `${state.status} / ${fmt(state.simTime)}`),
    );
    this._renderReplayList();
    this._toast(`回放已保存（${id}）`);
  }

  _renderReplayList() {
    const box = $('#replay-list');
    const list = ReplayStore.list();
    if (!list.length) {
      box.innerHTML = '<p class="muted">暂无存档，完成一局后点击“保存回放”。</p>';
      return;
    }
    box.innerHTML = list.map((e) => `
      <div class="replay-item">
        <div>
          <strong>${e.label}</strong>
          <span class="muted">冲突 ${e.conflicts} · 保护 ${e.protections} · 安全 ${fmt(e.safeElapsed)}</span>
        </div>
        <div class="row">
          <button data-play="${e.id}">播放</button>
          <button data-del="${e.id}">删除</button>
        </div>
      </div>`).join('');
    box.querySelectorAll('[data-play]').forEach((btn) =>
      btn.addEventListener('click', () => this._playReplay(btn.dataset.play)));
    box.querySelectorAll('[data-del]').forEach((btn) =>
      btn.addEventListener('click', () => {
        ReplayStore.remove(btn.dataset.del);
        this._renderReplayList();
      }));
  }

  _playReplay(id) {
    const entry = ReplayStore.get(id);
    if (!entry) return;
    this._stopReplay(false);
    const rec = Recorder.deserialize(entry.data);
    this.replay = new ReplayPlayer(rec, VentilationGame, { dt: 1 / 60 });
    $('#replay-panel').hidden = false;
    $('#replay-title').textContent = `回放：${entry.label}`;
    let acc = 0;
    this.replayTimer = setInterval(() => {
      acc += 0.1;
      const state = this.replay.seekTo(acc);
      this.view.render(state, performance.now());
      this._renderHud(state, true);
      $('#replay-progress').value = Math.min(100, acc / Math.max(entry.simTime, 1) * 100);
      $('#replay-time').textContent = fmt(acc);
      if (acc >= entry.simTime + 1 || state.status === 'succeeded' || state.status === 'failed') {
        this._stopReplay();
      }
    }, 100);
  }

  _stopReplay(resetView = true) {
    if (this.replayTimer) clearInterval(this.replayTimer);
    this.replayTimer = null;
    this.replay = null;
    $('#replay-panel').hidden = true;
    if (resetView) this._renderHud();
  }

  _loop(now) {
    if (!this.replay) {
      const dt = Math.min((now - (this._last || now)) / 1000, 0.1);
      this._last = now;
      if (this.game.status === 'running') {
        this.game.step(dt);
        this.recorder.maybeSnapshot(this.game.simTime, this.game.getState());
        this._drainEventsToRecorder();
      }
      this.view.render(this.game.getState(), now);
      this._renderHud();
    }
    requestAnimationFrame(this._loop);
  }

  _drainEventsToRecorder() {
    const known = new Set(this.recorder.events.map((e) => `${e.t}|${e.msg}`));
    for (const ev of this.game.events) {
      if (!known.has(`${ev.t}|${ev.msg}`)) this.recorder.recordEvent(ev);
    }
  }

  _flashReject(station) {
    const el = station === 'upstream' ? $('#panel-up') : $('#panel-down');
    el.classList.add('reject');
    setTimeout(() => el.classList.remove('reject'), 350);
  }

  _toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 1800);
  }

  _renderHud(override, isReplay = false) {
    const s = override || this.game.getState();
    const label = {
      ready: '待开始', running: '运行中', paused: '已暂停',
      succeeded: '成功', failed: '失败',
    }[s.status];
    $('#status-pill').textContent = isReplay ? '回放中' : label;
    $('#status-pill').className = `pill ${s.status}`;
    $('#timer').textContent = fmt(s.remaining);
    $('#safe-elapsed').textContent = fmt(s.safeElapsed);
    $('#sim-time').textContent = fmt(s.simTime);
    $('#energy-bar').style.width = `${s.energy}%`;
    $('#energy-text').textContent = s.energyLocked ? '能量锁定' : `${s.energy.toFixed(0)}%`;
    this._stationPanel('up', s);
    this._stationPanel('down', s);
    this._zoneTable(s);
    this._log(s);
  }

  _stationPanel(suffix, s) {
    const id = suffix === 'up' ? 'upstream' : 'downstream';
    const st = s.stations[id];
    const panel = $(`#panel-${suffix}`);
    panel.classList.toggle('protected', st.protected);
    panel.classList.toggle('auto', st.auto);
    $(`#${suffix}-role`).textContent = st.auto ? '自动辅助（调试）'
      : st.protected ? '安全保护中' : st.connected ? '人工操控' : '已断开';
    $(`#${suffix}-keys`).textContent = STATIONS[id].keys.join(' / ');
    if (id === 'upstream') {
      $('#up-value').textContent = s.fan.toFixed(0);
      $('#up-meter').style.width = `${s.fan}%`;
    } else {
      const span = (s.door - CONFIG.door.min) / (CONFIG.door.max - CONFIG.door.min) * 100;
      $('#down-value').textContent = s.door.toFixed(0);
      $('#down-meter').style.width = `${span}%`;
    }
  }

  _zoneTable(s) {
    $('#zone-table').innerHTML = s.zones.map((z) => `
      <tr class="${z.safe ? '' : 'danger'}">
        <td>${z.name}</td>
        <td>${z.flow.toFixed(1)}</td>
        <td>${z.pressure.toFixed(1)}</td>
        <td>${z.gas.toFixed(1)}%</td>
        <td>${z.backflow ? '回流' : z.spike ? '尖峰' : z.safe ? '安全' : z.unsafeReasons.join('/')}</td>
      </tr>`).join('');
  }

  _log(s) {
    $('#event-log').innerHTML = s.log.slice(-9).reverse().map((e) =>
      `<li class="log-${e.type}"><span class="muted">${fmt(e.t)}</span> ${e.msg}</li>`).join('');
  }
}

// 模块脚本位于 body 末尾，执行时 DOM 已就绪，直接构造单一实例
new App();
