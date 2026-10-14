(function () {
  'use strict';

  // ============ Константы модели ============
  const MU = 398600.4418;    // км^3/с^2
  const R_EARTH = 6371;      // км
  const R0 = R_EARTH + 400;  // радиус начальной орбиты, км
  const V0 = Math.sqrt(MU / R0); // начальная круговая скорость, км/с
  const I0 = 0;              // начальное наклонение, град

  const TOL_APOGEE = 60;     // км
  const TOL_INC = 0.7;       // град
  const G0 = 9.81;           // м/с^2
  const M_WET = 2000;        // кг (условная масса корабля с топливом)
  const MISSION_TIME = 6;    // секунд анимации

  // ============ DOM ============
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');

  const hudSpeed = document.getElementById('hud-speed');
  const hudTime = document.getElementById('hud-time');
  const hudDv = document.getElementById('hud-dv');

  const screens = {
    start: document.getElementById('screen-start'),
    setup: document.getElementById('screen-setup'),
    flying: document.getElementById('screen-flying'),
    result: document.getElementById('screen-result')
  };

  // Стартовый экран
  const tgtApogee = document.getElementById('tgt-apogee');
  const tgtInc = document.getElementById('tgt-inc');
  const fuelBudget = document.getElementById('fuel-budget');
  const ispInput = document.getElementById('isp');
  const valApogee = document.getElementById('val-apogee');
  const valInc = document.getElementById('val-inc');
  const valFuel = document.getElementById('val-fuel');
  const valIsp = document.getElementById('val-isp');
  const btnNext = document.getElementById('btn-next');

  // Экран стратегии
  const targetInfo = document.getElementById('target-info');
  const modeButtons = document.querySelectorAll('.mode-btn');
  const modeHint = document.getElementById('mode-hint');
  const inpProg = document.getElementById('inp-prog');
  const inpPlane = document.getElementById('inp-plane');
  const numProg = document.getElementById('num-prog');
  const numPlane = document.getElementById('num-plane');
  const lblProg = document.getElementById('lbl-prog');
  const lblPlane = document.getElementById('lbl-plane');
  const valProg = document.getElementById('val-prog');
  const valPlane = document.getElementById('val-plane');
  const roFormula = document.getElementById('ro-formula');
  const roTotal = document.getElementById('ro-total');
  const roFuel = document.getElementById('ro-fuel');
  const roApogee = document.getElementById('ro-apogee');
  const roInc = document.getElementById('ro-inc');
  const roMass = document.getElementById('ro-mass');
  const btnBack = document.getElementById('btn-back');
  const btnLaunch = document.getElementById('btn-launch');

  // Полёт и результат
  const flyingHint = document.getElementById('flying-hint');
  const progressBar = document.getElementById('progress-bar');
  const resultTitle = document.getElementById('result-title');
  const resultBody = document.getElementById('result-body');
  const btnRestart = document.getElementById('btn-restart');
  const btnNew = document.getElementById('btn-new');

  const toast = document.getElementById('toast');

  // ============ Состояние ============
  const state = {
    phase: 'start',
    targetApogee: 800,
    targetInc: 5,
    fuelBudget: 1000,
    isp: 300,
    mode: 'combined',
    prog: 0,
    plane: 0,
    t: 0,
    elapsed: 0,
    lastTs: 0,
    raf: R0
  };

  // ============ Размер canvas ============
  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    canvas.width = w;
    canvas.height = h;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resizeCanvas);
  window.addEventListener('orientationchange', function () {
    setTimeout(resizeCanvas, 100);
  });

  // ============ Физика (упрощённая) ============
  // prog, plane — в м/с. Возвращает итоговую орбиту.
  function computeOrbit(prog, plane) {
    const rp = R0;
    const vp = V0 + prog / 1000;
    const invA = 2 / rp - (vp * vp) / MU;
    let ra;
    if (invA <= 0) {
      ra = Infinity;
    } else {
      ra = 2 / invA - rp;
    }
    const ratio = Math.min(1, (plane / 1000) / (2 * V0));
    const di = 2 * Math.asin(ratio);
    const inc = I0 + di * 180 / Math.PI;
    return { rp: rp, ra: ra, inc: inc, vp: vp };
  }

  // Стоимость ΔV в зависимости от стратегии
  function dvCost(mode, prog, plane) {
    if (mode === 'combined') {
      return Math.hypot(prog, plane);
    }
    return prog + plane;
  }

  // Оценка израсходованной массы по Циолковскому (учебная оценка)
  function propellantUsed(dvUsed, isp) {
    if (dvUsed <= 0 || isp <= 0) return 0;
    return M_WET * (1 - Math.exp(-dvUsed / (isp * G0)));
  }

  function isFiniteOrbitRa(ra) {
    return isFinite(ra) ? ra : R0 * 4;
  }

  // ============ Экраны ============
  function showScreen(name) {
    Object.keys(screens).forEach(function (k) {
      screens[k].classList.toggle('active', k === name);
    });
    state.phase = name;
  }

  // ============ Реакция на ввод параметров миссии ============
  function readMissionParams() {
    state.targetApogee = +tgtApogee.value;
    state.targetInc = +tgtInc.value;
    state.fuelBudget = +fuelBudget.value;
    state.isp = +ispInput.value;
    valApogee.textContent = state.targetApogee + ' км';
    valInc.textContent = state.targetInc.toFixed(1) + '°';
    valFuel.textContent = state.fuelBudget + ' м/с';
    valIsp.textContent = state.isp + ' с';
  }

  [tgtApogee, tgtInc, fuelBudget, ispInput].forEach(function (el) {
    el.addEventListener('input', readMissionParams);
  });

  // ============ Стратегия ============
  function setMode(mode) {
    state.mode = mode;
    modeButtons.forEach(function (b) {
      const active = b.dataset.mode === mode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if (mode === 'combined') {
      lblProg.textContent = 'Продольная составляющая ΔV';
      lblPlane.textContent = 'Боковая составляющая ΔV';
      roFormula.textContent = '√(A² + B²)';
      modeHint.textContent = 'Один импульс в перигее: продольная составляющая меняет апогей, боковая — наклонение. Векторное сложение экономит топливо.';
    } else {
      lblProg.textContent = '1-й импульс: ΔV на апогей (в перигее)';
      lblPlane.textContent = '2-й импульс: ΔV на наклонение (в апогее)';
      roFormula.textContent = 'A + B';
      modeHint.textContent = 'Два отдельных импульса. Продольный в перигее поднимает апогей, боковой в апогее меняет наклонение. Сумма magnitudes всегда больше, чем вектор.';
    }
    updateReadout();
    draw();
  }

  modeButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      setMode(b.dataset.mode);
    });
  });

  // ============ Ввод значений импульсов ============
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function setProg(v) {
    const val = clamp(Math.round(+v) || 0, 0, 500);
    state.prog = val;
    if (+inpProg.value !== val) inpProg.value = val;
    if (+numProg.value !== val) numProg.value = val;
    valProg.textContent = val + ' м/с';
    updateReadout();
    draw();
  }
  function setPlane(v) {
    const val = clamp(Math.round(+v) || 0, 0, 1500);
    state.plane = val;
    if (+inpPlane.value !== val) inpPlane.value = val;
    if (+numPlane.value !== val) numPlane.value = val;
    valPlane.textContent = val + ' м/с';
    updateReadout();
    draw();
  }

  inpProg.addEventListener('input', function (e) { setProg(e.target.value); });
  inpPlane.addEventListener('input', function (e) { setPlane(e.target.value); });
  numProg.addEventListener('input', function (e) { setProg(e.target.value); });
  numPlane.addEventListener('input', function (e) { setPlane(e.target.value); });
  numProg.addEventListener('blur', function (e) { setProg(e.target.value); });
  numPlane.addEventListener('blur', function (e) { setPlane(e.target.value); });

  // ============ Панель-сводка ============
  function updateReadout() {
    const cost = dvCost(state.mode, state.prog, state.plane);
    roTotal.textContent = Math.round(cost) + ' м/с';

    const fuelLeft = state.fuelBudget - cost;
    roFuel.textContent = Math.round(fuelLeft) + ' м/с';
    roFuel.className = fuelLeft < 0 ? 'bad' : '';

    const o = computeOrbit(state.prog, state.plane);
    const apAlt = isFinite(o.ra) ? o.ra - R_EARTH : 99999;
    roApogee.textContent = Math.round(apAlt) + ' км';
    roInc.textContent = o.inc.toFixed(2) + '°';

    const mass = propellantUsed(cost, state.isp);
    roMass.textContent = mass.toFixed(1) + ' кг';

    state.raf = isFiniteOrbitRa(o.ra);
  }

  function updateTargetInfo() {
    targetInfo.innerHTML =
      'Цель: апогей <b>' + state.targetApogee + ' км</b>' +
      ' (± ' + TOL_APOGEE + '), наклонение <b>' + state.targetInc.toFixed(1) + '°</b>' +
      ' (± ' + TOL_INC + ').<br>' +
      'Топливо: <b>' + state.fuelBudget + ' м/с</b>. Isp: <b>' + state.isp + ' с</b>.';
  }

  // ============ Рисование ============
  function scaleFactor() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const maxR = Math.max(state.raf, R0, R_EARTH + state.targetApogee) * 1.05;
    return Math.min(W, H) * 0.42 / maxR;
  }

  function drawOrbit(cx, cy, scale, rp, ra, incDeg, color, dash, lw) {
    if (!isFinite(ra)) ra = rp * 3;
    ra = Math.max(ra, rp * 1.001);
    const a = (rp + ra) / 2;
    const b = Math.sqrt(rp * ra);
    const inc = incDeg * Math.PI / 180;
    const bVis = Math.max(0.0001, b * Math.cos(inc));
    const cVis = Math.sqrt(Math.max(0, a * a - bVis * bVis));

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if (dash && dash.length) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.ellipse(cx - cVis * scale, cy, a * scale, bVis * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawSpacecraft(x, y) {
    ctx.save();
    ctx.shadowColor = '#4da3ff';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function currentOrbit() {
    const target = computeOrbit(state.prog, state.plane);
    const t = state.t;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const raF = isFiniteOrbitRa(target.ra);
    return {
      rp: R0,
      ra: R0 + (raF - R0) * e,
      inc: target.inc * e
    };
  }

  function spacecraftPos(cx, cy, scale) {
    const o = currentOrbit();
    const a = (o.rp + o.ra) / 2;
    const b = Math.sqrt(o.rp * o.ra);
    const inc = o.inc * Math.PI / 180;
    const bVis = Math.max(0.0001, b * Math.cos(inc));
    const cVis = Math.sqrt(Math.max(0, a * a - bVis * bVis));

    const angle = -Math.PI / 2 + state.t * Math.PI * 2;
    const px = a * Math.cos(angle);
    const py = bVis * Math.sin(angle);
    return {
      x: cx + (px - cVis) * scale,
      y: cy + py * scale
    };
  }

  function draw() {
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (W <= 0 || H <= 0) return;

    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const scale = scaleFactor();

    // Земля
    const earthR = R_EARTH * scale;
    const g = ctx.createRadialGradient(cx - earthR * 0.3, cy - earthR * 0.3, earthR * 0.05, cx, cy, earthR);
    g.addColorStop(0, '#4d8bff');
    g.addColorStop(0.7, '#1e40af');
    g.addColorStop(1, '#0b1a3a');
    ctx.beginPath();
    ctx.arc(cx, cy, earthR, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    // Начальная орбита
    drawOrbit(cx, cy, scale, R0, R0, 0, 'rgba(140,155,180,0.55)', [4, 6], 1.2);

    // Целевая орбита (по текущим настройкам миссии)
    const targetRa = R_EARTH + state.targetApogee;
    drawOrbit(cx, cy, scale, R0, targetRa, state.targetInc, 'rgba(54,211,153,0.55)', [6, 6], 1.2);

    if (state.phase === 'setup') {
      const cost = dvCost(state.mode, state.prog, state.plane);
      if (cost > 0.5) {
        const o = computeOrbit(state.prog, state.plane);
        drawOrbit(cx, cy, scale, R0, o.ra, o.inc, 'rgba(77,163,255,0.8)', [3, 4], 1.6);
      }
    } else if (state.phase === 'flying' || state.phase === 'result') {
      const o = currentOrbit();
      drawOrbit(cx, cy, scale, o.rp, o.ra, o.inc, '#4da3ff', [], 2);
      const p = spacecraftPos(cx, cy, scale);
      drawSpacecraft(p.x, p.y);
    }
  }

  // ============ Полёт ============
  function startFlight() {
    state.t = 0;
    state.elapsed = 0;
    state.lastTs = performance.now();
    progressBar.style.width = '0%';
    flyingHint.textContent = state.mode === 'combined'
      ? 'Один импульс в перигее меняет и апогей, и наклонение одновременно.'
      : '1-й импульс в перигее поднимает апогей, 2-й в апогее меняет наклонение.';
    showScreen('flying');
    updateHud(0, 0);
    requestAnimationFrame(tick);
  }

  function updateHud(time, dv) {
    const o = computeOrbit(state.prog, state.plane);
    const vNow = V0 + (o.vp - V0) * state.t;
    hudSpeed.textContent = vNow.toFixed(3) + ' км/с';
    hudTime.textContent = time.toFixed(1) + ' с';
    hudDv.textContent = Math.round(dv) + ' м/с';
  }

  function tick(ts) {
    if (state.phase !== 'flying') return;
    const dt = Math.min(0.05, (ts - state.lastTs) / 1000);
    state.lastTs = ts;
    state.elapsed += dt;
    state.t = Math.min(1, state.elapsed / MISSION_TIME);

    const cost = dvCost(state.mode, state.prog, state.plane);
    updateHud(state.elapsed, cost * state.t);
    progressBar.style.width = (state.t * 100).toFixed(0) + '%';
    draw();

    if (state.t >= 1) {
      finishFlight();
      return;
    }
    requestAnimationFrame(tick);
  }

  // ============ Итог ============
  function finishFlight() {
    const o = computeOrbit(state.prog, state.plane);
    const apAlt = isFinite(o.ra) ? o.ra - R_EARTH : 99999;
    const inc = o.inc;
    const cost = dvCost(state.mode, state.prog, state.plane);
    const fuelLeft = state.fuelBudget - cost;
    const mass = propellantUsed(cost, state.isp);

    const apOk = Math.abs(apAlt - state.targetApogee) <= TOL_APOGEE;
    const incOk = Math.abs(inc - state.targetInc) <= TOL_INC;
    const fuelOk = fuelLeft >= -0.001;
    const success = apOk && incOk && fuelOk;

    resultTitle.textContent = success ? 'Успех' : 'Неудача';
    resultTitle.style.color = success ? 'var(--accent-2)' : 'var(--danger)';

    const strategy = state.mode === 'combined' ? 'Совмещённый импульс' : 'Раздельные импульсы';

    const rows = [
      ['Стратегия', strategy, null],
      ['Апогей', Math.round(apAlt) + ' км  (цель ' + state.targetApogee + ' ± ' + TOL_APOGEE + ')', apOk],
      ['Наклонение', inc.toFixed(2) + '°  (цель ' + state.targetInc.toFixed(1) + ' ± ' + TOL_INC + ')', incOk],
      ['Суммарный ΔV', Math.round(cost) + ' м/с', null],
      ['Остаток топлива', Math.round(fuelLeft) + ' м/с', fuelOk],
      ['Израсходовано массы', mass.toFixed(1) + ' кг', null],
      ['Время манёвра', state.elapsed.toFixed(1) + ' с', null]
    ];

    let html = rows.map(function (r) {
      const cls = r[2] === true ? 'ok' : r[2] === false ? 'bad' : '';
      return '<div class="result-line"><span>' + r[0] + '</span><b class="' + cls + '">' + r[1] + '</b></div>';
    }).join('');

    let explain;
    if (success) {
      explain = 'Цель достигнута. Обратите внимание: совмещённый импульс всегда экономичнее двух раздельных при одинаковом результате.';
    } else {
      const parts = [];
      if (!fuelOk) parts.push('не хватило топлива (нужно ' + Math.round(cost) + ', есть ' + state.fuelBudget + ' м/с)');
      if (!apOk && apAlt < state.targetApogee - TOL_APOGEE) parts.push('апогей ниже цели');
      if (!apOk && apAlt > state.targetApogee + TOL_APOGEE) parts.push('апогей выше цели');
      if (!incOk && inc < state.targetInc - TOL_INC) parts.push('наклонение меньше цели');
      if (!incOk && inc > state.targetInc + TOL_INC) parts.push('наклонение больше цели');
      explain = 'Причина: ' + parts.join(', ') + '.';

      const hints = [];
      if (state.mode === 'separate') {
        hints.push('При раздельных импульсах ΔV складывается как A + B, поэтому топлива тратится больше. Попробуйте совмещённый режим.');
      }
      if (!apOk && Math.abs(inc - state.targetInc) < TOL_INC) {
        hints.push('Наклонение уже верное — подберите продольную составляющую.');
      }
      if (!incOk && Math.abs(apAlt - state.targetApogee) < TOL_APOGEE) {
        hints.push('Апогей верный — подберите боковую составляющую.');
      }
      if (!fuelOk) {
        hints.push('Увеличьте запас топлива или уменьшите запрошенные ΔV.');
      }
      if (hints.length) explain += ' ' + hints.join(' ');
    }

    html += '<p class="hint" style="margin-top:10px">' + explain + '</p>';
    resultBody.innerHTML = html;

    showScreen('result');
    draw();
  }

  // ============ Toast ============
  let toastTimer = null;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 1600);
  }

  // ============ Кнопки навигации ============
  btnNext.addEventListener('click', function () {
    readMissionParams();
    updateTargetInfo();
    setMode(state.mode);
    setProg(0);
    setPlane(0);
    showScreen('setup');
    updateReadout();
    draw();
    setTimeout(function () { inpProg.focus(); }, 50);
  });

  btnBack.addEventListener('click', function () {
    showScreen('start');
  });

  btnLaunch.addEventListener('click', function () {
    const cost = dvCost(state.mode, state.prog, state.plane);
    if (cost > state.fuelBudget + 0.001) {
      showToast('Недостаточно топлива: ' + Math.round(cost) + ' > ' + state.fuelBudget + ' м/с');
      return;
    }
    if (cost < 1) {
      showToast('Задайте импульс');
      return;
    }
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
    startFlight();
  });

  btnRestart.addEventListener('click', function () {
    state.t = 0;
    state.elapsed = 0;
    setProg(0);
    setPlane(0);
    hudSpeed.textContent = V0.toFixed(3) + ' км/с';
    hudTime.textContent = '0.0 с';
    hudDv.textContent = '0 м/с';
    progressBar.style.width = '0%';
    updateTargetInfo();
    showScreen('setup');
    updateReadout();
    draw();
    setTimeout(function () { inpProg.focus(); }, 50);
  });

  btnNew.addEventListener('click', function () {
    state.t = 0;
    state.elapsed = 0;
    showScreen('start');
    draw();
  });

  // ============ Клавиатура ============
  document.addEventListener('keydown', function (e) {
    const tag = e.target && e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA';

    if (state.phase === 'flying') {
      e.preventDefault();
      return;
    }
    if (isInput) return;

    if (e.key === 'Enter' || e.key === ' ') {
      if (state.phase === 'start') { btnNext.click(); e.preventDefault(); }
      else if (state.phase === 'setup') { btnLaunch.click(); e.preventDefault(); }
      else if (state.phase === 'result') { btnRestart.click(); e.preventDefault(); }
    }
  });

  // ============ Инициализация ============
  function init() {
    resizeCanvas();
    readMissionParams();
    updateTargetInfo();
    setMode('combined');
    setProg(0);
    setPlane(0);
    showScreen('start');
    draw();
  }
  init();
})();