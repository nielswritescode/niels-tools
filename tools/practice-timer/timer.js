(function () {
  // ---- state ----
  const TIMER_SOUNDS = ["chime", "bell", "beep", "gong", "ascend", "waves"];
  let timerSound = "chime";
  let timerVolume = 0.7; // 0..1, persisted — it's a preference, not session state
  let timerMode = "simple"; // 'simple' | 'multi' — also persisted
  let timerLoop = false;
  const TIMER_DURATION_UNITS = ["minutes", "seconds"];
  // The picker's pool of presets, each with its own unit — editable via the
  // Add timer / Remove timer controls, also persisted.
  let timerDurations = [
    { value: 5, unit: "minutes" },
    { value: 10, unit: "minutes" },
    { value: 15, unit: "minutes" },
    { value: 20, unit: "minutes" },
    { value: 25, unit: "minutes" },
    { value: 30, unit: "minutes" },
  ];

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
      Array.isArray(stored.timerDurations) &&
      stored.timerDurations.every((d) => (
        d && typeof d.value === "number" && d.value >= 1 && d.value <= 180 && TIMER_DURATION_UNITS.includes(d.unit)
      ))
    ) {
      timerDurations = stored.timerDurations;
    }
    if (stored.timerMode === "simple" || stored.timerMode === "multi") timerMode = stored.timerMode;
    if (typeof stored.timerLoop === "boolean") timerLoop = stored.timerLoop;
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        timerSound,
        timerVolume,
        timerDurations,
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
  const timerDurationRow = document.getElementById("timerDurationRow");
  const timerAddDurationBtn = document.getElementById("timerAddDurationBtn");
  const timerRemoveDurationBtn = document.getElementById("timerRemoveDurationBtn");
  const timerAddDialog = document.getElementById("timerAddDialog");
  const timerAddForm = document.getElementById("timerAddForm");
  const timerAddUnitPills = document.querySelectorAll(".timer-add-unit-pill");
  const timerAddValueInput = document.getElementById("timerAddValueInput");
  const timerAddCancelBtn = document.getElementById("timerAddCancelBtn");
  const practiceFlashEl = document.getElementById("practiceFlash");
  const timerSetup = document.getElementById("timerSetup");
  const timerSequenceEl = document.getElementById("timerSequence");
  const timerMultiActions = document.getElementById("timerMultiActions");
  const timerReturnBtn = document.getElementById("timerReturnBtn");
  const timerLoopBtn = document.getElementById("timerLoopBtn");
  const timerConfirmBtn = document.getElementById("timerConfirmBtn");
  const timerRunningEl = document.getElementById("timerRunning");
  const timerRunningSequenceEl = document.getElementById("timerRunningSequence");
  const timerLoopIndicator = document.getElementById("timerLoopIndicator");
  const timerCountdownEl = document.getElementById("timerCountdown");

  // Practice timer state. timerMode, timerLoop and timerDurations are
  // declared above and persisted — they're preferences. The rest here is
  // deliberately NOT persisted: you want a clean slate on a fresh visit
  // rather than resuming mid-countdown or with a stale queue. Queue items
  // are {value, unit} objects, same shape as timerDurations entries; the
  // countdown itself still ticks in seconds internally so it can show
  // MM:SS.
  let timerQueuedItems = []; // being built in multi mode, pre-Confirm
  let timerRunningNow = false;
  let timerIntervalId = null;
  let timerActiveQueue = [];
  let timerQueueIndex = 0;
  let timerRemainingSeconds = 0;
  let timerRemoveMode = false; // toggled by "Remove timer" — clicking a chip deletes it instead of starting/queueing it

  function updateTimerModeUI() {
    timerModePills.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.timerMode === timerMode);
    });
    const isMulti = timerMode === "multi";
    timerSequenceEl.hidden = !isMulti;
    timerMultiActions.hidden = !isMulti;
    renderTimerSquares(timerSequenceEl, timerQueuedItems, -1);
  }
  timerModePills.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (timerRunningNow) return; // don't let a mode switch pull the rug out mid-countdown
      timerMode = btn.dataset.timerMode;
      timerQueuedItems = []; // switching modes starts the sequence builder over
      updateTimerModeUI();
      saveSettings();
    });
  });

  // "m" or "s" depending on the item's own unit.
  function timerItemLabel(item) {
    return `${item.value}${item.unit === "seconds" ? "s" : "m"}`;
  }
  function timerItemSeconds(item) {
    return item.unit === "seconds" ? item.value : item.value * 60;
  }

  // Renders a row of duration squares — reused for both the multi-mode
  // sequence builder (activeIndex -1, nothing marked done) and the running
  // view (the in-progress item highlighted, earlier ones dimmed as done).
  function renderTimerSquares(container, items, activeIndex) {
    container.innerHTML = items.map((item, i) => {
      const cls = i === activeIndex ? "active" : i < activeIndex ? "done" : "";
      return `<div class="timer-square ${cls}">${timerItemLabel(item)}</div>`;
    }).join("");
  }

  // Renders the picker's pool of duration chips from timerDurations.
  // animateLastIn plays a pop-in animation on the newest chip (just added
  // via the dialog) rather than instantly appearing with the rest.
  function renderTimerDurationRow(animateLastIn) {
    timerDurationRow.innerHTML = timerDurations.map((item, i) => (
      `<button type="button" class="pill timer-duration-btn" data-index="${i}">${timerItemLabel(item)}</button>`
    )).join("");
    timerDurationRow.classList.toggle("remove-mode", timerRemoveMode);
    if (animateLastIn && timerDurationRow.lastElementChild) {
      timerDurationRow.lastElementChild.classList.add("entering");
    }
  }

  // Single delegated listener since the chips are re-rendered wholesale on
  // every add/remove rather than getting individual listeners each time.
  timerDurationRow.addEventListener("click", (e) => {
    const btn = e.target.closest(".timer-duration-btn");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    const item = timerDurations[index];
    if (!item) return;
    if (timerRemoveMode) {
      // Play the fade/scale-out animation, then actually remove the item
      // once it finishes so the index used above stays valid throughout.
      btn.classList.add("removing");
      btn.addEventListener("animationend", () => {
        timerDurations.splice(index, 1);
        renderTimerDurationRow();
        saveSettings();
      }, { once: true });
      return;
    }
    primeTimerAudio();
    if (timerMode === "simple") {
      startTimerQueue([item]);
    } else {
      timerQueuedItems.push(item);
      renderTimerSquares(timerSequenceEl, timerQueuedItems, -1);
    }
  });

  timerRemoveDurationBtn.addEventListener("click", () => {
    timerRemoveMode = !timerRemoveMode;
    timerRemoveDurationBtn.classList.toggle("active", timerRemoveMode);
    timerDurationRow.classList.toggle("remove-mode", timerRemoveMode);
  });

  let timerAddUnit = "minutes"; // remembered across opens in this session for convenience, not persisted
  function updateTimerAddUnitUI() {
    timerAddUnitPills.forEach((btn) => btn.classList.toggle("active", btn.dataset.unit === timerAddUnit));
  }
  timerAddUnitPills.forEach((btn) => {
    btn.addEventListener("click", () => {
      timerAddUnit = btn.dataset.unit;
      updateTimerAddUnitUI();
    });
  });

  timerAddDurationBtn.addEventListener("click", () => {
    updateTimerAddUnitUI();
    timerAddValueInput.value = "5";
    timerAddDialog.showModal();
    timerAddValueInput.focus();
    timerAddValueInput.select();
  });
  timerAddCancelBtn.addEventListener("click", () => timerAddDialog.close());
  // Click on the ::backdrop (i.e. directly on the dialog element, not its
  // form) dismisses it, like clicking outside any other popup would.
  timerAddDialog.addEventListener("click", (e) => {
    if (e.target === timerAddDialog) timerAddDialog.close();
  });
  timerAddForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const parsed = parseInt(timerAddValueInput.value, 10);
    const value = Number.isFinite(parsed) ? clamp(parsed, 1, 180) : 5;
    timerDurations.push({ value, unit: timerAddUnit });
    renderTimerDurationRow(true);
    saveSettings();
    timerAddDialog.close();
  });

  function formatMinSec(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  // Six deliberately different-sounding endings via Web Audio rather than
  // audio files — keeps the timer fully self-contained/offline. Each is
  // built from plain oscillator+gain "notes"; peak gain is scaled by
  // timerVolume (0..1) so the volume slider actually affects loudness
  // rather than just clipping. chime/bell/beep are short (under ~2s); gong/
  // ascend/waves are longer, ~5s endings for a bigger sense of completion.
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

  // Oscillators currently scheduled by the last playTimerSound() call. With
  // the ~5s gong/ascend/waves endings, clicking another sound pill (or
  // Preview) mid-playback would otherwise stack a second sound on top of
  // the first instead of replacing it — short-lived for chime/bell/beep,
  // but audibly bad once sounds run this long.
  let activeTimerOscillators = [];
  function stopActiveTimerSound() {
    const now = sharedAudioCtx ? sharedAudioCtx.currentTime : 0;
    activeTimerOscillators.forEach((osc) => {
      try { osc.stop(now); } catch (e) {} // already stopped/ended — fine
    });
    activeTimerOscillators = [];
  }

  function playTimerSound() {
    try {
      const ctx = sharedAudioCtx;
      if (!ctx) return; // never primed by a gesture (e.g. Web Audio blocked) — skip silently
      stopActiveTimerSound();
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
        activeTimerOscillators.push(osc);
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
      } else if (timerSound === "gong") {
        // A deep strike with two quiet inharmonic overtones (not a clean
        // integer-multiple series — that's what makes it read as a
        // gong/singing-bowl rather than a bell) and a long ~4.8s decay.
        note(196, 0, 0.02, 4.8, 0.36);
        note(541, 0, 0.02, 3.2, 0.13);
        note(803, 0, 0.02, 2.0, 0.08);
      } else if (timerSound === "ascend") {
        // A five-note rising run that resolves into a sustained final
        // note — a bigger, ~4.8s "you're done" than the short chime.
        note(392, 0.0, 0.02, 0.55, 0.24);
        note(440, 0.55, 0.02, 0.55, 0.24);
        note(523, 1.1, 0.02, 0.55, 0.24);
        note(659, 1.65, 0.02, 0.55, 0.24);
        note(784, 2.2, 0.03, 2.6, 0.32);
      } else if (timerSound === "waves") {
        // Three slow overlapping swells alternating between two close
        // pitches — a gentle ambient pulse (~5s) instead of a sharp hit.
        note(220, 0.0, 1.1, 1.5, 0.20);
        note(247, 1.5, 1.1, 1.5, 0.20);
        note(220, 3.0, 0.9, 1.3, 0.18);
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
      playTimerSound(); // instant feedback so picking between sounds is actually usable
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

  // Returns to the setup UI (mode pills + the duration chips, and in multi
  // mode the sequence builder) without clearing timerQueuedItems, so a
  // manual stop or a finished non-looping run can just be re-Confirmed to
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
      // timerLoop is only exposed via the Loop button, which is hidden
      // outside multi mode (see timerMultiActions in updateTimerModeUI) —
      // without this mode check, enabling it in multi and then switching to
      // simple makes simple loop forever with no visible control to turn it
      // off.
      if (timerLoop && timerMode === "multi") {
        timerQueueIndex = 0;
      } else {
        returnToTimerPicker();
        return;
      }
    }
    startCurrentTimerItem();
  }

  function startCurrentTimerItem() {
    timerRemainingSeconds = timerItemSeconds(timerActiveQueue[timerQueueIndex]);
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
    // Loop can only be toggled from the setup screen, which is hidden for
    // the whole run — this is the only place its state is visible while
    // counting down, so fix it once per run rather than reacting live.
    timerLoopIndicator.hidden = !(timerMode === "multi" && timerLoop);
    startCurrentTimerItem();
  }

  timerReturnBtn.addEventListener("click", () => {
    timerQueuedItems.pop();
    renderTimerSquares(timerSequenceEl, timerQueuedItems, -1);
  });

  timerLoopBtn.addEventListener("click", () => {
    timerLoop = !timerLoop;
    timerLoopBtn.classList.toggle("active", timerLoop);
    saveSettings();
  });

  timerConfirmBtn.addEventListener("click", () => {
    primeTimerAudio();
    startTimerQueue([...timerQueuedItems]);
  });

  // The countdown number is itself the stop control — no separate button.
  timerCountdownEl.addEventListener("click", returnToTimerPicker);

  // ---- init ----
  updateTimerModeUI();
  timerLoopBtn.classList.toggle("active", timerLoop);
  renderTimerDurationRow();
  updateTimerSoundUI();
  updateTimerVolumeUI();
})();
