function noiseBuffer(context, seconds = 2) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let value = 0;
  for (let i = 0; i < length; i += 1) {
    value = value * 0.96 + (Math.random() * 2 - 1) * 0.04;
    data[i] = value * 3.2;
  }
  return buffer;
}

function noiseVoice(context, destination, filterFrequency, gainValue) {
  const source = context.createBufferSource();
  source.buffer = noiseBuffer(context);
  source.loop = true;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = filterFrequency;
  filter.Q.value = 0.8;
  const gain = context.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(destination);
  source.start();
  return { source, filter, gain, target: gainValue };
}

export class WashAudio {
  constructor() {
    this.context = null;
    this.enabled = false;
    this.voices = null;
  }

  async toggle() {
    if (!this.context) this.initialize();
    if (this.context.state === "suspended") await this.context.resume();
    this.enabled = !this.enabled;
    this.master.gain.setTargetAtTime(
      this.enabled ? 0.62 : 0,
      this.context.currentTime,
      0.08
    );
    return this.enabled;
  }

  initialize() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.context.destination);

    this.ultrasonic = this.context.createOscillator();
    this.ultrasonic.type = "sine";
    this.ultrasonic.frequency.value = 640;
    this.ultrasonicGain = this.context.createGain();
    this.ultrasonicGain.gain.value = 0;
    this.ultrasonic.connect(this.ultrasonicGain).connect(this.master);
    this.ultrasonic.start();

    this.basketHum = this.context.createOscillator();
    this.basketHum.type = "triangle";
    this.basketHum.frequency.value = 58;
    this.basketGain = this.context.createGain();
    this.basketGain.gain.value = 0;
    this.basketHum.connect(this.basketGain).connect(this.master);
    this.basketHum.start();

    this.alarm = this.context.createOscillator();
    this.alarm.type = "square";
    this.alarm.frequency.value = 760;
    this.alarmGain = this.context.createGain();
    this.alarmGain.gain.value = 0;
    this.alarm.connect(this.alarmGain).connect(this.master);
    this.alarm.start();

    this.voices = {
      pump: noiseVoice(this.context, this.master, 620, 0.13),
      fan: noiseVoice(this.context, this.master, 1550, 0.07),
      heater: noiseVoice(this.context, this.master, 180, 0.035)
    };
  }

  setGain(node, target) {
    node.gain.setTargetAtTime(target, this.context.currentTime, 0.09);
  }

  update(sim) {
    if (!this.context || !this.enabled) return;
    const working = sim.status === "running";
    const stage = sim.stage;
    const active = new Set(sim.activeEquipment);
    const pulse = 0.5 + Math.sin(sim.clock * 8) * 0.5;

    this.setGain(this.ultrasonicGain, working && stage === "ultrasonic" ? 0.072 : 0);
    this.setGain(
      this.basketGain,
      working && active.has("basket") ? 0.018 + sim.parameters.rpm * 0.000006 : 0
    );
    this.setGain(
      this.voices.pump.gain,
      working && active.has("pump") ? this.voices.pump.target : 0
    );
    this.setGain(
      this.voices.fan.gain,
      working && active.has("fan") ? this.voices.fan.target : 0
    );
    this.setGain(
      this.voices.heater.gain,
      working && active.has("heater") ? this.voices.heater.target : 0
    );
    this.setGain(this.alarmGain, sim.status === "fault" ? 0.035 * pulse : 0);

    const speed = 0.78 + sim.parameters.rpm / 1800;
    this.ultrasonic.frequency.setTargetAtTime(560 + speed * 170, this.context.currentTime, 0.15);
    this.basketHum.frequency.setTargetAtTime(40 + sim.parameters.rpm / 38, this.context.currentTime, 0.15);
    this.voices.pump.filter.frequency.setTargetAtTime(
      420 + sim.parameters.rpm * 0.28,
      this.context.currentTime,
      0.2
    );
  }
}
