import "./styles.css";
import { SonarAudio, renderOffline } from "./audio";
import { SonarRenderer } from "./renderer";
import {
  clamp,
  createContacts,
  DEFAULT_PARAMS,
  makeEchoes,
  PROFILES,
} from "./scenario";
import type {
  Contact,
  ContactKind,
  MonitorMode,
  ScanRecord,
  SonarParams,
  RenderResult,
} from "./types";

const STORAGE_KEY = "abyss.sonar.params.v1";
const audio = new SonarAudio();
const canvas = byId<HTMLCanvasElement>("sonar-canvas");
const scopeCanvas = byId<HTMLCanvasElement>("scope-canvas");
const renderer = new SonarRenderer(canvas, scopeCanvas);

let contacts: Contact[] = createContacts();
let discovered = new Set<string>();
let records: ScanRecord[] = [];
let selectedTool: ContactKind = "shallow";
let params: SonarParams = { ...DEFAULT_PARAMS };
let battery = 100;
let heat = 18;
let scanCount = 0;
let overheated = false;
let cooldownUntil = 0;
let success = false;
let wrongIds = new Set<string>();
let lastExport: RenderResult | null = null;
let lastSavedAt = 0;
let sessionStart = Date.now();
let toastTimer = 0;

declare global {
  interface Window {
    sonarLab: Record<string, (...args: any[]) => any>;
  }
}

const els = {
  batteryValue: byId("battery-value"),
  batteryMeter: byId("battery-meter"),
  heatValue: byId("heat-value"),
  heatMeter: byId("heat-meter"),
  powerValue: byId("power-value"),
  powerSegments: byId("power-segments"),
  scanButton: byId<HTMLButtonElement>("scan-button"),
  sailButton: byId<HTMLButtonElement>("sail-button"),
  scanLabel: byId("scan-label"),
  echoList: byId("echo-list"),
  echoCount: byId("echo-count"),
  audioState: byId("audio-state"),
  nodeCount: byId("node-count"),
  bandLabel: byId("band-label"),
  beatLabel: byId("beat-label"),
  beatPosition: byId("beat-position"),
  playButton: byId<HTMLButtonElement>("play-button"),
  replayButton: byId<HTMLButtonElement>("replay-button"),
  stepButton: byId<HTMLButtonElement>("step-button"),
  exportButton: byId<HTMLButtonElement>("export-button"),
  meterLeft: byId("meter-left"),
  meterRight: byId("meter-right"),
  levelLeft: byId("level-left"),
  levelRight: byId("level-right"),
  verifyBadge: byId("verify-badge"),
  verifyDuration: byId("verify-duration"),
  verifyPeaks: byId("verify-peaks"),
  verifyChannels: byId("verify-channels"),
  verifyNodes: byId("verify-nodes"),
  verifyDetail: byId("verify-detail"),
  verifyButton: byId<HTMLButtonElement>("verify-button"),
  paramStatus: byId("param-status"),
  missionClock: byId("mission-clock"),
  toast: byId("toast"),
  resultModal: byId<HTMLDivElement>("result-modal"),
};

const paramInputs = {
  master: byId<HTMLInputElement>("master-volume"),
  panWidth: byId<HTMLInputElement>("pan-width"),
  echoGain: byId<HTMLInputElement>("echo-gain"),
  tempo: byId<HTMLInputElement>("tempo"),
};

const paramOutputs = {
  master: byId<HTMLOutputElement>("master-volume-out"),
  panWidth: byId<HTMLOutputElement>("pan-width-out"),
  echoGain: byId<HTMLOutputElement>("echo-gain-out"),
  tempo: byId<HTMLOutputElement>("tempo-out"),
};

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

function syncRenderer(): void {
  renderer.setState({
    contacts,
    discovered: new Set(discovered),
    selectedTool,
    heat,
    paused: !audio.isPlaying,
    success,
    wrongIds: new Set(wrongIds),
  });
}

function syncParamsToUI(): void {
  paramInputs.master.value = String(Math.round(params.master * 100));
  paramInputs.panWidth.value = String(Math.round(params.panWidth * 100));
  paramInputs.echoGain.value = String(Math.round(params.echoGain * 100));
  paramInputs.tempo.value = String(Math.round(params.tempo));
  paramOutputs.master.value = String(Math.round(params.master * 100));
  paramOutputs.panWidth.value = String(Math.round(params.panWidth * 100));
  paramOutputs.echoGain.value = String(Math.round(params.echoGain * 100));
  paramOutputs.tempo.value = String(Math.round(params.tempo));
  els.beatLabel.textContent = `${Math.round(params.tempo)} BPM`;
}

function updateResources(): void {
  const batteryPct = clamp(battery, 0, 100);
  const heatPct = clamp(heat, 0, 100);
  els.batteryValue.textContent = `${Math.round(batteryPct)}%`;
  els.batteryMeter.style.transform = `scaleX(${batteryPct / 100})`;
  els.heatValue.textContent = `${Math.round(heatPct)}°`;
  els.heatMeter.style.transform = `scaleX(${heatPct / 100})`;
  els.powerValue.textContent = `${Math.round(52 + batteryPct * 0.38)} kW`;
  const litSegments = Math.round(batteryPct / 12.5);
  [...els.powerSegments.children].forEach((segment, index) => {
    segment.classList.toggle("off", index >= litSegments);
  });
  const now = performance.now();
  const blocked = overheated || now < cooldownUntil || battery < 13 || success;
  els.scanButton.disabled = blocked;
  els.sailButton.disabled = contacts.some((contact) => !contact.mark) || success;
  if (overheated) {
    const seconds = Math.max(0, (cooldownUntil - Date.now()) / 1000);
    els.scanLabel.innerHTML = `<span class="scan-label-wave"></span><span>换能器过热 · 冷却 ${seconds.toFixed(1)}s</span>`;
    els.scanLabel.classList.add("active");
  } else {
    els.scanLabel.innerHTML = `<span class="scan-label-wave"></span><span>${
      discovered.size ? "回波稳定 · 可重新扫描校准" : "待命 · 点击“发射声呐”"
    }</span>`;
    els.scanLabel.classList.toggle("active", discovered.size > 0);
  }
}

function markStrengths(intensity: number): string {
  const on = Math.max(1, Math.round(intensity * 5));
  return `<span class="strength-bars">${Array.from(
    { length: 5 },
    (_, index) => `<i class="${index < on ? "on" : ""}"></i>`,
  ).join("")}</span>`;
}

function panLabel(pan: number): string {
  if (Math.abs(pan) < 0.04) return "CENTER";
  const side = pan < 0 ? "L" : "R";
  return `${side} ${Math.round(Math.abs(pan) * 100)}`;
}

function renderEchoes(): void {
  if (!discovered.size) {
    els.echoList.innerHTML = '<p class="empty-state">尚未捕获回波。<br />发射一次声呐，读取延迟、强度与左右声像。</p>';
    els.echoCount.textContent = "0 / 4";
    return;
  }
  const visible = contacts.filter((contact) => discovered.has(contact.id));
  els.echoCount.textContent = `${visible.filter((contact) => contact.mark).length} / 4`;
  els.echoList.replaceChildren();
  for (const contact of visible) {
    const row = document.createElement("div");
    row.className = `echo-item${contact.mark ? " marked" : ""}`;
    row.dataset.contactId = contact.id;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `回波 ${contact.id}，点击以当前工具标记`);
    const bandShort = contact.profile.frequencyLabel.split(" · ")[1];
    row.innerHTML = `
      <span class="echo-index">${contact.id.replace("-", "")}</span>
      <div class="echo-main">
        <div class="echo-title">
          <strong>${contact.id}</strong>
          <em>${bandShort}</em>
        </div>
        <div class="echo-detail">
          <span>${panLabel(contact.pan)}</span>
          <i></i>
          <span>${Math.round(contact.delay * 1000)} ms</span>
          ${contact.mark ? `<span class="echo-mark">${PROFILES[contact.mark].shortLabel}</span>` : ""}
        </div>
      </div>
      <div class="echo-strength">
        ${markStrengths(contact.intensity)}
        <span>${Math.round(contact.intensity * 100)}</span>
      </div>
    `;
    const activate = () => {
      renderer.setState({ hoveredId: contact.id });
      markContact(contact.id);
    };
    row.addEventListener("click", activate);
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
    row.addEventListener("mouseenter", () => renderer.setState({ hoveredId: contact.id }));
    row.addEventListener("mouseleave", () => renderer.setState({ hoveredId: null }));
    els.echoList.append(row);
  }
}

function markContact(id: string): void {
  if (success) return;
  const contact = contacts.find((item) => item.id === id);
  if (!contact || !discovered.has(id)) return;
  contact.mark = selectedTool;
  wrongIds.delete(id);
  renderer.setState({ contacts, wrongIds: new Set(wrongIds) });
  renderEchoes();
  updateResources();
  const selected = PROFILES[selectedTool].shortLabel;
  showToast(`${id} 已标记为「${selected}」`);
}

function selectTool(tool: ContactKind): void {
  selectedTool = tool;
  document.querySelectorAll<HTMLButtonElement>(".tool").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  renderer.setState({ selectedTool: tool });
}

function showToast(message: string, warn = false): void {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.toggle("warn", warn);
  els.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => els.toast.classList.remove("visible"), 2600);
}

function appendLog(message: string): void {
  els.verifyDetail.textContent = message;
}

async function performScan(): Promise<void> {
  if (success) return;
  if (overheated || Date.now() < cooldownUntil) {
    showToast("换能器过热，等待冷却后再扫描。", true);
    return;
  }
  if (battery < 13) {
    showToast("电量不足，无法再次发射。", true);
    return;
  }
  battery = Math.max(0, battery - 13);
  heat = clamp(heat + 18 + scanCount * 1.4, 0, 100);
  scanCount += 1;
  if (heat >= 100) {
    overheated = true;
    cooldownUntil = Date.now() + 4200;
    showToast("温度阈值触发，换能器进入强制冷却。", true);
  }
  const baseBeat = Math.max(1, audio.displayBeat());
  const echoes = makeEchoes(contacts, baseBeat, params);
  const record: ScanRecord = {
    id: scanCount,
    beat: baseBeat,
    time: 0,
    echoes,
  };
  records.push(record);
  for (const contact of contacts) discovered.add(contact.id);
  renderer.triggerScan();
  syncRenderer();
  renderEchoes();
  updateResources();
  els.bandLabel.textContent = "LOW / MID / HIGH";
  appendLog(`扫描 #${scanCount} 已记录：4 组回波，延迟 ${contacts
    .slice(0, 3)
    .map((contact) => `${Math.round(contact.delay * 1000)}ms`)
    .join(" / ")}。`);
  try {
    await audio.liveScan(echoes, baseBeat);
    updateAudioUI();
  } catch (error) {
    showToast("音频上下文启动失败，请再次点击。", true);
    console.error(error);
  }
}

function sailOut(): void {
  if (success || contacts.some((contact) => !contact.mark)) return;
  const wrong = contacts.filter((contact) => contact.mark !== contact.kind);
  if (wrong.length) {
    wrongIds = new Set(wrong.map((contact) => contact.id));
    renderer.setState({ wrongIds: new Set(wrongIds) });
    battery = Math.max(0, battery - 3);
    heat = clamp(heat + 4, 0, 100);
    updateResources();
    renderEchoes();
    showToast(`${wrong.length} 处标记不匹配，检查回波频段与强度。`, true);
    els.sailButton.textContent = "重新校准标记者 →";
    return;
  }
  success = true;
  wrongIds.clear();
  syncRenderer();
  updateResources();
  els.resultModal.hidden = false;
  byId("result-copy").textContent = "四处回波全部判读正确，推进器已穿越安全出口。";
  byId("result-battery").textContent = `${Math.round(battery)}%`;
  byId("result-scans").textContent = String(scanCount);
  byId("result-time").textContent = formatClock(Date.now() - sessionStart);
  void audio.successCue();
}

async function startPlayback(fromBeat = 0): Promise<void> {
  try {
    const fallback = makeEchoes(contacts, 1, params);
    await audio.ensure();
    await audio.replay(records, fallback, fromBeat);
    renderer.setState({ paused: false });
    updateAudioUI();
  } catch (error) {
    showToast("无法启动音频播放。", true);
    console.error(error);
  }
}

function pausePlayback(): void {
  audio.pause();
  renderer.setState({ paused: true });
  updateAudioUI();
  showToast("已暂停 · 所有实时发声节点已停止");
}

async function togglePlayback(): Promise<void> {
  if (audio.isPlaying) {
    pausePlayback();
  } else {
    await startPlayback(audio.displayBeat() > 0.05 ? audio.displayBeat() : 0);
  }
}

async function stepPlayback(): Promise<void> {
  try {
    const next = await audio.step(records);
    renderer.setState({ paused: true });
    updateAudioUI();
    appendLog(`单步推进到第 ${next.toFixed(1)} 拍，仅播放当前拍事件。`);
  } catch (error) {
    showToast("单步播放失败。", true);
    console.error(error);
  }
}

function updateAudioUI(): void {
  const active = audio.activeNodeCount;
  const playing = audio.isPlaying;
  els.playButton.textContent = playing ? "❚❚" : "▶";
  els.nodeCount.textContent = String(active);
  if (playing) {
    setAudioPill("实时 · " + (audio.currentMonitor === "main" ? "主输出" : audio.currentMonitor === "bypass" ? "旁路" : "静音"), "live");
  } else if (audio.isAudioReady) {
    setAudioPill(active ? "尾音收束" : "已暂停", active ? "live" : "idle");
  } else {
    setAudioPill("待机", "idle");
  }
}

function setAudioPill(text: string, state: "idle" | "live" | "warn" | "pass" | "fail"): void {
  els.audioState.textContent = text;
  els.audioState.className = `status-pill ${state}`;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function resetGame(): void {
  audio.stopEverything();
  contacts = createContacts();
  discovered = new Set();
  records = [];
  selectedTool = "shallow";
  wrongIds = new Set();
  battery = 100;
  heat = 18;
  scanCount = 0;
  overheated = false;
  cooldownUntil = 0;
  success = false;
  sessionStart = Date.now();
  lastExport = null;
  els.resultModal.hidden = true;
  els.sailButton.textContent = "驶出航道 →";
  els.verifyBadge.textContent = "未运行";
  els.verifyBadge.className = "status-pill";
  els.verifyDuration.textContent = "—";
  els.verifyPeaks.textContent = "—";
  els.verifyChannels.textContent = "—";
  els.verifyNodes.textContent = "—";
  appendLog("使用同一参数渲染两次 10 秒立体声 WAV，并检测峰值位置与尾音。");
  selectTool("shallow");
  renderEchoes();
  updateResources();
  updateAudioUI();
  syncRenderer();
}

function readParamsFromUI(): SonarParams {
  return {
    master: Number(paramInputs.master.value) / 100,
    panWidth: Number(paramInputs.panWidth.value) / 100,
    echoGain: Number(paramInputs.echoGain.value) / 100,
    tempo: Number(paramInputs.tempo.value),
  };
}

function applyParams(next: SonarParams, persistStatus = true): void {
  params = {
    master: clamp(Number(next.master) || DEFAULT_PARAMS.master, 0, 1),
    panWidth: clamp(Number(next.panWidth) || DEFAULT_PARAMS.panWidth, 0.2, 1),
    echoGain: clamp(Number(next.echoGain) || DEFAULT_PARAMS.echoGain, 0.2, 1),
    tempo: clamp(Number(next.tempo) || DEFAULT_PARAMS.tempo, 60, 100),
  };
  syncParamsToUI();
  audio.updateParams(params);
  if (persistStatus) {
    els.paramStatus.textContent = "有未保存的更改";
    els.paramStatus.className = "mini-status";
  }
}

function saveParams(showFeedback = true): boolean {
  try {
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      params,
      monitor: audio.currentMonitor,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  lastSavedAt = Date.now();
    if (showFeedback) {
      els.paramStatus.textContent = `已保存 · ${new Date(lastSavedAt).toLocaleTimeString("zh-CN", {
        hour12: false,
      })}`;
      els.paramStatus.className = "mini-status good";
      showToast("声学参数已写入本地存储");
    }
    return true;
  } catch (error) {
    els.paramStatus.textContent = "本地存储不可用";
    els.paramStatus.className = "mini-status error";
    console.error(error);
    return false;
  }
}

function readSavedParams(): { params: SonarParams; savedAt: number; monitor?: MonitorMode } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      params?: Partial<SonarParams>;
      savedAt?: string;
      monitor?: MonitorMode;
    };
    if (!parsed.params) return null;
    return {
      params: { ...DEFAULT_PARAMS, ...parsed.params },
      savedAt: parsed.savedAt ? Date.parse(parsed.savedAt) : Date.now(),
      monitor: parsed.monitor,
    };
  } catch {
    return null;
  }
}

async function loadParamsAndPlay(): Promise<void> {
  const saved = readSavedParams();
  if (!saved) {
    showToast("尚无可重载的参数，请先保存。", true);
    els.paramStatus.textContent = "未找到已保存参数";
    els.paramStatus.className = "mini-status error";
    return;
  }
  applyParams(saved.params);
  lastSavedAt = saved.savedAt;
  if (saved.monitor) {
    audio.setMonitor(saved.monitor);
    syncMonitorButtons(saved.monitor);
  }
  els.paramStatus.textContent = `已重载 · 源自 ${new Date(saved.savedAt).toLocaleTimeString("zh-CN", {
    hour12: false,
  })}`;
  els.paramStatus.className = "mini-status good";
  await startPlayback();
  showToast("参数已重载，正在重播声呐序列");
}

function syncMonitorButtons(mode: MonitorMode): void {
  document.querySelectorAll<HTMLButtonElement>(".monitor").forEach((button) => {
    button.classList.toggle("active", button.dataset.monitor === mode);
  });
}

function replayRecords(): ScanRecord[] {
  if (records.length) return records;
  return [{
    id: 0,
    beat: 1,
    time: 0,
    echoes: makeEchoes(contacts, 1, params),
  }];
}

async function renderExport(updateFields = true): Promise<RenderResult> {
  const renderMonitor: MonitorMode = audio.currentMonitor === "bypass" ? "bypass" : "main";
  const result = await renderOffline(replayRecords(), params, 10, renderMonitor);
  if (updateFields) {
    lastExport = result;
    updateExportFields(result);
  }
  return result;
}

function updateExportFields(result: RenderResult): void {
  const analysis = result.analysis;
  els.verifyDuration.textContent = `${analysis.duration.toFixed(3)} s`;
  els.verifyPeaks.textContent = `${toDbText(analysis.peakLeft)} / ${toDbText(analysis.peakRight)}`;
  els.verifyChannels.textContent = `${analysis.channels} · L/R`;
  els.verifyNodes.textContent = "0 残留";
  els.verifyBadge.textContent = "导出就绪";
  els.verifyBadge.className = "status-pill live";
  const panSpread = Math.abs(analysis.rmsLeft - analysis.rmsRight);
  els.verifyDetail.textContent =
    `立体声 ${analysis.channels}ch · 峰位 ${analysis.peakTimeLeft.toFixed(3)}s / ${analysis.peakTimeRight.toFixed(3)}s · ` +
    `L/R RMS 差 ${(panSpread * 100).toFixed(1)}% · 尾段 ${toDbText(analysis.tailRms)} dB · ${analysis.peakCount} 个关键峰。`;
}

function toDbText(value: number): string {
  if (value < 0.000001) return "−∞ dB";
  return `${(20 * Math.log10(value)).toFixed(1)} dB`;
}

async function exportWav(): Promise<void> {
  els.exportButton.disabled = true;
  els.exportButton.textContent = "渲染中…";
  try {
    const result = await renderExport();
    const blob = new Blob([result.wav.buffer as ArrayBuffer], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `abyss-sonar-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast(`WAV 已导出 · ${result.analysis.duration.toFixed(2)}s / 2ch`);
  } catch (error) {
    showToast("WAV 导出失败。", true);
    console.error(error);
  } finally {
    els.exportButton.disabled = false;
    els.exportButton.textContent = "导出 WAV";
  }
}

interface VerificationResult {
  passed: boolean;
  durationDrift: number;
  peakDrift: number;
  timingDrift: number;
  tailRms: number;
  leftRightDelta: number;
  bands: number;
  delays: number;
  activeNodes: number;
  details: string;
}

async function verifyRoundTrip(): Promise<VerificationResult> {
  els.verifyButton.disabled = true;
  els.verifyButton.textContent = "比对渲染中…";
  els.verifyBadge.textContent = "检查中";
  els.verifyBadge.className = "status-pill warn";
  audio.pause();
  updateAudioUI();
  try {
    if (!saveParams(false)) throw new Error("Cannot persist parameters");
    const first = await renderExport(false);
    const saved = readSavedParams();
    if (!saved) throw new Error("Cannot reload parameters");
    applyParams(saved.params, false);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
    const second = await renderExport(false);
    const a = first.analysis;
    const b = second.analysis;
    const durationDrift = Math.abs(a.duration - b.duration);
    const peakDrift = Math.max(
      Math.abs(a.peakLeft - b.peakLeft),
      Math.abs(a.peakRight - b.peakRight),
    );
    const timingDrift = Math.max(
      Math.abs(a.peakTimeLeft - b.peakTimeLeft),
      Math.abs(a.peakTimeRight - b.peakTimeRight),
    );
    const tailRms = Math.max(a.tailRms, b.tailRms);
    const leftRightDelta = Math.abs(a.peakLeft - a.peakRight);
    const uniqueBands = new Set(contacts.map((contact) => contact.profile.freq)).size;
    const uniqueDelays = new Set(contacts.map((contact) => Math.round(contact.delay * 1000))).size;
    const activeNodes = audio.activeNodeCount;
    const stereoPass = a.channels === 2 && a.peakLeft > 0.002 && a.peakRight > 0.002 && leftRightDelta > 0.00001;
    const dimensions = [stereoPass, uniqueBands >= 3, uniqueDelays >= 3, timingDrift < 0.002];
    const dimensionPass = dimensions.filter(Boolean).length >= 3;
    const passed =
      durationDrift < 0.002 &&
      a.channels === 2 &&
      b.channels === 2 &&
      peakDrift < 0.001 &&
      timingDrift < 0.002 &&
      tailRms < 0.004 &&
      activeNodes === 0 &&
      dimensionPass;
    const details =
      `维度：声道 ${stereoPass ? "PASS" : "FAIL"} · 频段 ${uniqueBands}/4 · 延迟 ${uniqueDelays}/4 · ` +
      `节拍漂移 ${(timingDrift * 1000).toFixed(3)}ms · 尾音 ${(tailRms * 100).toFixed(2)}%。`;
    updateExportFields(first);
    els.verifyBadge.textContent = passed ? "PASS" : "FAIL";
    els.verifyBadge.className = `status-pill ${passed ? "pass" : "fail"}`;
    els.verifyNodes.textContent = `${activeNodes} 残留`;
    els.verifyDetail.textContent =
      `${details} 双导出偏差：时长 ${(durationDrift * 1000).toFixed(2)}ms，` +
      `峰值 ${(peakDrift * 1000).toFixed(3)}‰，关键峰 ${a.peakCount}/${b.peakCount}，` +
      `首峰 ${a.firstPeak.toFixed(3)}s / ${b.firstPeak.toFixed(3)}s。`;
    els.paramStatus.textContent = "参数已保存、重载并完成双导出比对";
    els.paramStatus.className = `mini-status ${passed ? "good" : "error"}`;
    await startPlayback();
    return {
      passed,
      durationDrift,
      peakDrift,
      timingDrift,
      tailRms,
      leftRightDelta,
      bands: uniqueBands,
      delays: uniqueDelays,
      activeNodes,
      details,
    };
  } catch (error) {
    els.verifyBadge.textContent = "ERROR";
    els.verifyBadge.className = "status-pill fail";
    els.verifyDetail.textContent = `验收失败：${error instanceof Error ? error.message : String(error)}`;
    console.error(error);
    return {
      passed: false,
      durationDrift: Infinity,
      peakDrift: Infinity,
      timingDrift: Infinity,
      tailRms: Infinity,
      leftRightDelta: 0,
      bands: 0,
      delays: 0,
      activeNodes: audio.activeNodeCount,
      details: "验收失败",
    };
  } finally {
    els.verifyButton.disabled = false;
    els.verifyButton.textContent = "保存 → 重载 → 双导出比对";
  }
}

function animateTelemetry(): void {
  const samples = audio.getMeterSamples();
  renderer.drawScope(samples.left, samples.right);
  const levels = audio.getLevels();
  const leftScale = clamp(levels.left * 12, 0, 1);
  const rightScale = clamp(levels.right * 12, 0, 1);
  els.meterLeft.style.transform = `scaleY(${Math.max(0.012, leftScale)})`;
  els.meterRight.style.transform = `scaleY(${Math.max(0.012, rightScale)})`;
  els.levelLeft.textContent = Number.isFinite(levels.dbLeft) ? `${levels.dbLeft.toFixed(0)}` : "−∞";
  els.levelRight.textContent = Number.isFinite(levels.dbRight) ? `${levels.dbRight.toFixed(0)}` : "−∞";
  els.nodeCount.textContent = String(audio.activeNodeCount);
  const beat = audio.displayBeat();
  els.beatPosition.textContent = beat.toFixed(1).padStart(4, "0");
  updateAudioUI();
  requestAnimationFrame(animateTelemetry);
}

function initPowerSegments(): void {
  els.powerSegments.replaceChildren(
    ...Array.from({ length: 8 }, () => document.createElement("i")),
  );
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>(".tool").forEach((button) => {
    button.addEventListener("click", () => {
      selectTool(button.dataset.tool as ContactKind);
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".monitor").forEach((button) => {
    button.addEventListener("click", async () => {
      const mode = button.dataset.monitor as MonitorMode;
      audio.setMonitor(mode);
      syncMonitorButtons(mode);
      await audio.ensure();
      updateAudioUI();
      showToast(
        mode === "main" ? "监听：主输出（滤波与压缩）" : mode === "bypass" ? "监听：旁路（原始干声）" : "监听：静音",
      );
    });
  });

  canvas.addEventListener("pointermove", (event) => {
    const contact = renderer.pick(event.clientX, event.clientY);
    renderer.setState({ hoveredId: contact?.id ?? null });
    canvas.style.cursor = contact ? "crosshair" : "default";
    if (contact) {
      els.bandLabel.textContent = contact.profile.frequencyLabel;
      document.querySelectorAll(".echo-item").forEach((row) => {
        row.classList.toggle("selected", (row as HTMLElement).dataset.contactId === contact.id);
      });
    }
  });

  canvas.addEventListener("pointerleave", () => {
    renderer.setState({ hoveredId: null });
  });

  canvas.addEventListener("click", (event) => {
    const contact = renderer.pick(event.clientX, event.clientY);
    if (contact) markContact(contact.id);
    else if (!discovered.size) showToast("先发射声呐捕捉回波，再放置标记。", true);
  });

  els.scanButton.addEventListener("click", () => void performScan());
  els.sailButton.addEventListener("click", sailOut);
  els.playButton.addEventListener("click", () => void togglePlayback());
  els.replayButton.addEventListener("click", () => void startPlayback());
  els.stepButton.addEventListener("click", () => void stepPlayback());
  els.exportButton.addEventListener("click", () => void exportWav());
  els.verifyButton.addEventListener("click", () => void verifyRoundTrip());
  byId("restart-button").addEventListener("click", resetGame);

  (Object.keys(paramInputs) as Array<keyof typeof paramInputs>).forEach((key) => {
    paramInputs[key].addEventListener("input", () => {
      params = readParamsFromUI();
      syncParamsToUI();
      audio.updateParams(params);
      els.paramStatus.textContent = "参数已修改，尚未保存";
      els.paramStatus.className = "mini-status";
      els.beatLabel.textContent = `${Math.round(params.tempo)} BPM`;
    });
  });

  byId("save-params").addEventListener("click", () => {
    params = readParamsFromUI();
    audio.updateParams(params);
    saveParams();
  });
  byId("load-params").addEventListener("click", () => void loadParamsAndPlay());
  byId("param-toggle").addEventListener("click", (event) => {
    const body = byId("params-body");
    const button = event.currentTarget as HTMLButtonElement;
    const hidden = body.hidden;
    body.hidden = !hidden;
    button.textContent = hidden ? "收起" : "展开";
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target as HTMLElement;
    if (target.matches("input, button, textarea, select")) return;
    if (event.code === "Space") {
      event.preventDefault();
      void performScan();
    }
    if (event.code === "KeyP") {
      event.preventDefault();
      void togglePlayback();
    }
  });

  window.setInterval(() => {
    if (overheated && Date.now() >= cooldownUntil) {
      overheated = false;
      heat = 66;
      showToast("换能器冷却完成，可再次扫描");
    } else {
      heat = Math.max(18, heat - (overheated ? 0 : 0.16));
    }
    updateResources();
  }, 130);

  window.setInterval(() => {
    els.missionClock.textContent = `T+ ${formatClock(Date.now() - sessionStart)}`;
  }, 1000);
}

audio.setStopListener(() => {
  renderer.setState({ paused: true });
  updateAudioUI();
});

initPowerSegments();
syncParamsToUI();
selectTool("shallow");
renderEchoes();
updateResources();
syncRenderer();
bindEvents();
animateTelemetry();

window.sonarLab = {
  scan: performScan,
  pause: () => {
    pausePlayback();
    return { activeNodes: audio.activeNodeCount, ...audio.getLevels() };
  },
  play: startPlayback,
  step: stepPlayback,
  exportWav,
  verify: verifyRoundTrip,
  selectTool,
  markAllCorrect: () => {
    for (const contact of contacts) {
      contact.mark = contact.kind;
      discovered.add(contact.id);
    }
    wrongIds.clear();
    renderEchoes();
    updateResources();
    syncRenderer();
  },
  sailOut,
  setMonitor: (mode: MonitorMode) => {
    audio.setMonitor(mode);
    syncMonitorButtons(mode);
  },
  setParams: (patch: Partial<SonarParams>) => {
    applyParams({ ...params, ...patch });
  },
  saveParams,
  loadSavedParams: readSavedParams,
  renderAnalysis: async (override?: Partial<SonarParams>) => {
    const result = await renderOffline(
      replayRecords(),
      { ...params, ...override },
      10,
      audio.currentMonitor === "bypass" ? "bypass" : "main",
    );
    return result.analysis;
  },
  getState: () => ({
    contacts: contacts.map((contact) => ({ ...contact, profile: { ...contact.profile } })),
    discovered: [...discovered],
    records,
    params: { ...params },
    battery,
    heat,
    scanCount,
    success,
    wrongIds: [...wrongIds],
    monitor: audio.currentMonitor,
    playing: audio.isPlaying,
    contextState: audio.contextState,
    activeNodes: audio.activeNodeCount,
    levels: audio.getLevels(),
    lastExport: lastExport?.analysis ?? null,
  }),
};
