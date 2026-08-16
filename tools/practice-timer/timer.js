(function () {
  // ---- state ----
  const TIMER_SOUNDS = ["chime", "bell", "beep"];
  let timerSound = "chime";
  let timerVolume = 0.7; // 0..1, persisted — it's a preference, not session state
  let timerMode = "simple"; // 'simple' | 'multi' — also persisted
  let timerLoop = false;
  let timerDurationMinutes = [5, 10, 15, 20, 25, 30]; // editable via the Settings panel inputs, also persisted
  const TIMER_DURATION_UNITS = ["minutes", "seconds"];
  let timerDurationUnit = "minutes"; // whether the 6 values above mean minutes or seconds; also persisted

  // ---- persisted settings ----
  const SETTINGS_KEY = "nielsTools:practiceTimer";

  function loadSettings() {
    let stored;
    try {
      stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    } catch (e) {
      return; // corrupted JSON — fall back to defaults
    }
    if (!stored || typeof stored !== "object") return;
    if (TIMER_SOUNDS.includes(stored.timerSound)) timerSound = stored.timerSound;
    if (typeof stored.timerVolume === "number" && stored.timerVolume >= 0 && stored.timerVolume <= 1) {
      timerVolume = stored.timerVolume;
    }
    if (
      Array.isArray(stored.timerDurationMinutes) &&
      stored.timerDurationMinutes.length === 6 &&
      stored.timerDurationMinutes.every((m) => typeof m === "number" && m >= 1 && m <= 180)
    ) {
      timerDurationMinutes = stored.timerDurationMinutes;
    }
    if (TIMER_DURATION_UNITS.includes(stored.timerDurationUnit)) timerDurationUnit = stored.timerDurationUnit;
    if (stored.timerMode === "simple" || stored.timerMode === "multi") timerMode = stored.timerMode;
    if (typeof stored.timerLoop === "boolean") timerLoop = stored.timerLoop;
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        timerSound,
        timerVolume,
        timerDurationMinutes,
        timerDurationUnit,
        timerMode,
        timerLoop,
      }));
    } catch (e) {
      // storage full or unavailable (e.g. private browsing) — settings
      // just won't persist, nothing else to do about it here
    }
  }

  loadSettings();

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // ---- DOM refs ----
  const timerModePills = document.querySelectorAll(".timer-mode-pill");
  const timerSoundPills = document.querySelectorAll(".timer-sound-pill");
  const timerSoundPreviewBtn = document.getElementById("timerSoundPreviewBtn");
  const timerVolumeSlider = document.getElementById("timerVolumeSlider");
  const timerVolumeValue = document.getElementById("timerVolumeValue");
  const timerDurationBtns = document.querySelectorAll(".timer-duration-btn");
  const timerDurationInputs = document.querySelectorAll(".timer-duration-input");
  const timerDurationUnitPills = document.querySelectorAll(".timer-duration-unit-pill");
  const practiceFlashEl = document.getElementById("practiceFlash");
  const timerSetup = document.getElementById("timerSetup");
  const timerSequenceEl = document.getElementById("timerSequence");
  const timerMultiActions = document.getElementById("timerMultiActions");
  const timerReturnBtn = document.getElementById("timerReturnBtn");
  const timerLoopBtn = document.getElementById("timerLoopBtn");
  const timerConfirmBtn = document.getElementById("timerConfirmBtn");
  const timerRunningEl = document.getElementById("timerRunning");
  const timerRunningSequenceEl = document.getElementById("timerRunningSequence");
  const timerCountdownEl = document.getElementById("timerCountdown");

  // Practice timer state. timerMode, timerLoop, timerDurationMinutes and
  // timerDurationUnit are declared above and persisted — they're
  // preferences. The rest here is deliberately NOT persisted: you want a
  // clean slate on a fresh visit rather than resuming mid-countdown or with
  // a stale queue. Durations are in whatever timerDurationUnit says (what
  // the 6 buttons offer and what a built sequence is made of); the
  // countdown itself still ticks in seconds internally so it can show
  // MM:SS.
  let timerQueuedMinutes = []; // being built in multi mode, pre-Confirm
  let timerRunningNow = false;
  let timerIntervalId = null;
  let timerActiveQueue = [];
  let timerQueueIndex = 0;
  let timerRemainingSeconds = 0;

  function updateTimerModeUI() {
    timerModePills.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.timerMode === timerMode);
    });
    const isMulti = timerMode === "multi";
    timerSequenceEl.hidden = !isMulti;
    timerMultiActions.hidden = !isMulti;
    renderTimerSquares(timerSequenceEl, timerQueuedMinutes, -1);
  }
  timerModePills.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (timerRunningNow) return; // don't let a mode switch pull the rug out mid-countdown
      timerMode = btn.dataset.timerMode;
      timerQueuedMinutes = []; // switching modes starts the sequence builder over
      updateTimerModeUI();
      saveSettings();
    });
  });

  // "m" or "s" depending on timerDurationUnit — shared by the duration
  // buttons/inputs and the sequence squares so they always agree.
  function timerUnitSuffix() {
    return timerDurationUnit === "seconds" ? "s" : "m";
  }

  // Renders a row of duration squares — reused for both the multi-mode
  // sequence builder (activeIndex -1, nothing marked done) and the running
  // view (the in-progress item highlighted, earlier ones dimmed as done).
  function renderTimerSquares(container, minutes, activeIndex) {
    const suffix = timerUnitSuffix();
    container.innerHTML = minutes.map((m, i) => {
      const cls = i === activeIndex ? "active" : i < activeIndex ? "done" : "";
      return `<div class="timer-square ${cls}">${m}${suffix}</div>`;
    }).join("");
  }

  // Keeps the 6 duration buttons' labels/data-minutes and the matching
  // Settings-panel number inputs in sync with timerDurationMinutes, whether
  // it just changed via an input or was restored from localStorage. The
  // buttons' values are always in timerDurationUnit — minutes or seconds —
  // and startCurrentTimerItem is what actually converts them to seconds.
  function applyTimerDurations() {
    const suffix = timerUnitSuffix();
    timerDurationBtns.forEach((btn, i) => {
      const m = timerDurationMinutes[i];
      btn.dataset.minutes = m;
      btn.textContent = `${m}${suffix}`;
    });
    timerDurationInputs.forEach((input, i) => {
      input.value = timerDurationMinutes[i];
    });
  }
  timerDurationInputs.forEach((input, i) => {
    input.addEventListener("change", () => {
      const parsed = parseInt(input.value, 10);
      const clamped = Number.isFinite(parsed) ? Math.min(180, Math.max(1, parsed)) : timerDurationMinutes[i];
      timerDurationMinutes[i] = clamped;
      applyTimerDurations();
      saveSettings();
    });
    input.addEventListener("focus", () => input.select());
  });

  function updateTimerDurationUnitUI() {
    timerDurationUnitPills.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.timerDurationUnit === timerDurationUnit);
    });
    applyTimerDurations();
    // Re-label any squares already on screen (a queued multi-mode sequence,
    // or the running view) so they stay in sync instead of showing a stale unit.
    renderTimerSquares(timerSequenceEl, timerQueuedMinutes, -1);
    if (timerMode === "multi" && timerRunningNow) {
      renderTimerSquares(timerRunningSequenceEl, timerActiveQueue, timerQueueIndex);
    }
  }
  timerDurationUnitPills.forEach((btn) => {
    btn.addEventListener("click", () => {
      timerDurationUnit = btn.dataset.timerDurationUnit;
      updateTimerDurationUnitUI();
      saveSettings();
    });
  });

  function formatMinSec(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // Three deliberately different-sounding endings via Web Audio rather than
  // audio files — keeps the timer fully self-contained/offline. Each is
  // built from plain oscillator+gain "notes"; peak gain is scaled by
  // timerVolume (0..1) so the volume slider actually affects loudness
  // rather than just clipping.
  // A single AudioContext, created (or resumed) lazily the first time any
  // timer control is touched — and reused for every sound after that,
  // including the one triggered from setInterval when a countdown hits
  // zero. Mobile browsers only allow *creating/resuming* an AudioContext
  // synchronously inside a real user-gesture handler (a click); a fresh
  // `new AudioContext()` made later from a timer callback gets silently
  // blocked on phones even though desktop browsers tolerate it once the
  // page has seen any click. Reusing an already-running context sidesteps
  // that: only the context's *creation* needs a gesture, not each sound
  // scheduled on it afterwards.
  let sharedAudioCtx = null;
  function primeTimerAudio() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!sharedAudioCtx) sharedAudioCtx = new Ctx();
      if (sharedAudioCtx.state === "suspended") sharedAudioCtx.resume().catch(() => {});
    } catch (e) {
      // Web Audio unavailable — playTimerSound's own try/catch covers playback
    }
  }

  function playTimerSound() {
    try {
      const ctx = sharedAudioCtx;
      if (!ctx) return; // never primed by a gesture (e.g. Web Audio blocked) — skip silently
      const now = ctx.currentTime;
      const note = (freq, start, attack, decay, peak, type) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type || "sine";
        osc.frequency.value = freq;
        const t0 = now + start;
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(peak * timerVolume, t0 + attack);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + attack + decay + 0.05);
      };
      if (timerSound === "bell") {
        // A single resonant tone (fundamental + two quiet overtones) with a
        // long decay — sustained and warm, not bright/percussive.
        note(523, 0, 0.01, 1.8, 0.32);
        note(1046, 0, 0.01, 1.4, 0.14);
        note(1568, 0, 0.01, 1.0, 0.08);
      } else if (timerSound === "beep") {
        // Three flat, punchy square-wave beeps — digital/alarm-clock, the
        // most utilitarian and attention-grabbing of the three.
        note(660, 0, 0.005, 0.25, 0.22, "square");
        note(660, 0.45, 0.005, 0.25, 0.22, "square");
        note(660, 0.9, 0.005, 0.25, 0.22, "square");
      } else {
        // "chime" (default): two bright ascending sine notes.
        note(880, 0, 0.05, 0.9, 0.3);
        note(1320, 0.35, 0.05, 0.9, 0.3);
      }
    } catch (e) {
      // Web Audio unavailable/blocked — the visual countdown already shows completion
    }
  }

  function updateTimerSoundUI() {
    timerSoundPills.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.timerSound === timerSound);
    });
  }
  timerSoundPills.forEach((btn) => {
    btn.addEventListener("click", () => {
      primeTimerAudio();
      timerSound = btn.dataset.timerSound;
      updateTimerSoundUI();
      saveSettings();
      playTimerSound(); // instant feedback so picking between the 3 is actually usable
    });
  });
  timerSoundPreviewBtn.addEventListener("click", () => {
    primeTimerAudio();
    playTimerSound();
  });

  function updateTimerVolumeUI() {
    const pct = Math.round(timerVolume * 100);
    timerVolumeSlider.value = String(pct);
    timerVolumeValue.textContent = `${pct}%`;
  }
  timerVolumeSlider.addEventListener("input", () => {
    timerVolume = clamp(parseInt(timerVolumeSlider.value, 10), 0, 100) / 100;
    updateTimerVolumeUI();
  });
  timerVolumeSlider.addEventListener("change", () => {
    primeTimerAudio();
    saveSettings();
    playTimerSound(); // hear the level you landed on
  });

  function stopTimerInterval() {
    if (timerIntervalId) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
    }
  }

  // Returns to the setup UI (mode pills + the 6 duration buttons, and in
  // multi mode the sequence builder) without clearing timerQueuedMinutes, so
  // a manual stop or a finished non-looping run can just be re-Confirmed to
  // replay it.
  function returnToTimerPicker() {
    stopTimerInterval();
    timerRunningNow = false;
    timerRunningEl.hidden = true;
    timerSetup.hidden = false;
  }

  function tickTimer() {
    timerRemainingSeconds--;
    if (timerRemainingSeconds > 0) {
      timerCountdownEl.textContent = formatMinSec(timerRemainingSeconds);
      return;
    }
    stopTimerInterval();
    playTimerSound();
    timerQueueIndex++;
    if (timerQueueIndex >= timerActiveQueue.length) {
      if (timerLoop) {
        timerQueueIndex = 0;
      } else {
        returnToTimerPicker();
        return;
      }
    }
    startCurrentTimerItem();
  }

  function startCurrentTimerItem() {
    timerRemainingSeconds = timerActiveQueue[timerQueueIndex] * (timerDurationUnit === "seconds" ? 1 : 60);
    timerCountdownEl.textContent = formatMinSec(timerRemainingSeconds);
    // Simple mode is just one bare countdown — no sequence, so no point
    // showing a single square for it.
    if (timerMode === "multi") renderTimerSquares(timerRunningSequenceEl, timerActiveQueue, timerQueueIndex);
    timerIntervalId = setInterval(tickTimer, 1000);
  }

  // 7 alternate entrance/motion animations (see the matching flash-*
  // keyframes in timer.css), one picked at random per flash so the
  // wordart doesn't roll in the same way every time a timer starts.
  const PRACTICE_FLASH_ROLLINS = ["glow", "slide", "flicker", "wipe", "glitch", "zoom", "flip"];
  // 7 alternate visual looks (see the matching .style-* rules in
  // timer.css) — a second, independent axis from the rollin above, so the
  // two combine for up to 49 distinct flashes. These only ever touch CSS
  // properties the rollin keyframes don't animate (background, border,
  // font, text-stroke, decoration, ...), never opacity/transform/color/
  // text-shadow/filter/clip-path, so the two layers can't fight over the
  // same property mid-animation.
  const PRACTICE_FLASH_STYLES = ["outline", "mono", "card", "underline", "italic", "wide", "neon"];
  // Retriggerable via the classList remove/reflow/add dance since the CSS
  // animation's "forwards" fill would otherwise leave it stuck invisible
  // (not "not yet started") on a second call.
  function flashPracticeWordart() {
    practiceFlashEl.classList.remove(
      "show",
      ...PRACTICE_FLASH_ROLLINS.map((s) => `flash-${s}`),
      ...PRACTICE_FLASH_STYLES.map((s) => `style-${s}`)
    );
    void practiceFlashEl.offsetWidth;
    const rollin = PRACTICE_FLASH_ROLLINS[Math.floor(Math.random() * PRACTICE_FLASH_ROLLINS.length)];
    const style = PRACTICE_FLASH_STYLES[Math.floor(Math.random() * PRACTICE_FLASH_STYLES.length)];
    practiceFlashEl.classList.add("show", `flash-${rollin}`, `style-${style}`);
  }

  function startTimerQueue(queue) {
    if (queue.length === 0) return;
    flashPracticeWordart();
    timerActiveQueue = queue;
    timerQueueIndex = 0;
    timerRunningNow = true;
    timerSetup.hidden = true;
    timerRunningEl.hidden = false;
    timerRunningSequenceEl.hidden = timerMode !== "multi";
    if (timerMode !== "multi") timerRunningSequenceEl.innerHTML = ""; // clear any squares left from a prior multi-mode run
    startCurrentTimerItem();
  }

  timerDurationBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      primeTimerAudio();
      const minutes = Number(btn.dataset.minutes);
      if (timerMode === "simple") {
        startTimerQueue([minutes]);
      } else {
        timerQueuedMinutes.push(minutes);
        renderTimerSquares(timerSequenceEl, timerQueuedMinutes, -1);
      }
    });
  });

  timerReturnBtn.addEventListener("click", () => {
    timerQueuedMinutes.pop();
    renderTimerSquares(timerSequenceEl, timerQueuedMinutes, -1);
  });

  timerLoopBtn.addEventListener("click", () => {
    timerLoop = !timerLoop;
    timerLoopBtn.classList.toggle("active", timerLoop);
    saveSettings();
  });

  timerConfirmBtn.addEventListener("click", () => {
    primeTimerAudio();
    startTimerQueue([...timerQueuedMinutes]);
  });

  // The countdown number is itself the stop control — no separate button.
  timerCountdownEl.addEventListener("click", returnToTimerPicker);

  // ---- init ----
  updateTimerModeUI();
  timerLoopBtn.classList.toggle("active", timerLoop);
  updateTimerDurationUnitUI();
  updateTimerSoundUI();
  updateTimerVolumeUI();
})();
