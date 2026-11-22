class SoundManager {
  private ctx: AudioContext | null = null;
  public seEnabled = true; // 初期状態: 重要イベントSEのみオン
  public bgmEnabled = false; // 初期状態: BGMオフ
  private bgmInterval: number | null = null;
  private bgmStep = 0;

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    volume = 0.12,
    delay = 0
  ) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }

  public playDice() {
    if (!this.seEnabled) return;
    [320, 440, 560, 480].forEach((f, idx) => {
      this.playTone(f, 0.06, 'triangle', 0.1, idx * 0.045);
    });
  }

  public playDiceTick(step = 0) {
    if (!this.seEnabled) return;
    const freqs = [380, 460, 540, 620, 500, 420];
    this.playTone(freqs[step % freqs.length], 0.045, 'triangle', 0.09);
  }

  public playDiceResult() {
    if (!this.seEnabled) return;
    this.playTone(587.33, 0.1, 'triangle', 0.14, 0);
    this.playTone(880, 0.25, 'triangle', 0.16, 0.08);
  }

  public playTurnStart() {
    if (!this.seEnabled) return;
    this.playTone(440, 0.09, 'sine', 0.09, 0);
    this.playTone(554.37, 0.09, 'sine', 0.09, 0.08);
    this.playTone(659.25, 0.16, 'sine', 0.11, 0.16);
  }

  public playStep() {
    if (!this.seEnabled) return;
    this.playTone(620, 0.07, 'sine', 0.08);
  }

  public playPlus() {
    if (!this.seEnabled) return;
    this.playTone(523.25, 0.12, 'sine', 0.12, 0);
    this.playTone(659.25, 0.12, 'sine', 0.12, 0.09);
    this.playTone(783.99, 0.25, 'sine', 0.14, 0.18);
  }

  public playMinus() {
    if (!this.seEnabled) return;
    this.playTone(300, 0.15, 'sawtooth', 0.08, 0);
    this.playTone(220, 0.28, 'sawtooth', 0.08, 0.13);
  }

  public playGoal() {
    if (!this.seEnabled) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((n, i) => {
      this.playTone(n, 0.24, 'triangle', 0.14, i * 0.1);
    });
  }

  public playNuisance() {
    if (!this.seEnabled) return;
    [260, 240, 210, 180].forEach((n, i) => {
      this.playTone(n, 0.15, 'sawtooth', 0.09, i * 0.1);
    });
  }

  public playStamp() {
    if (!this.seEnabled) return;
    this.playTone(880, 0.08, 'sine', 0.08, 0);
    this.playTone(1174, 0.12, 'sine', 0.08, 0.06);
  }

  public toggleBgm(enable: boolean) {
    this.bgmEnabled = enable;
    if (this.bgmInterval) {
      window.clearInterval(this.bgmInterval);
      this.bgmInterval = null;
    }
    if (enable) {
      this.ensureContext();
      const melody = [392, 440, 493.88, 523.25, 493.88, 440, 392, 329.63];
      this.bgmStep = 0;
      this.bgmInterval = window.setInterval(() => {
        if (!this.bgmEnabled) return;
        const note = melody[this.bgmStep % melody.length];
        this.playTone(note, 0.25, 'sine', 0.035);
        this.bgmStep++;
      }, 420);
    }
  }
}

export const soundManager = new SoundManager();
