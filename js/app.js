(() => {
  'use strict';

  const C = window.SCDCore;
  const T = (text) => window.SCDI18n?.translate(text) ?? text;
  const $ = id => document.getElementById(id);
  const palette = ['#2f7d4a', '#78b87a', '#4f8f72', '#a7c957', '#5b8f5a', '#8fbc8f', '#3f6f52', '#9fbd75'];
  const phaseBasePalette = new Map([['A', '#2f7d4a'], ['B', '#f1862b'], ['C', '#4f8f72'], ['D', '#a7c957']]);
  const fontMap = {
    'noto-sans': '"Noto Sans JP", "Yu Gothic", Meiryo, sans-serif',
    'times-new-roman': '"Times New Roman", Times, serif',
    'ms-gothic': '"MS Gothic", "ＭＳ ゴシック", monospace',
    'ms-mincho': '"MS Mincho", "ＭＳ 明朝", serif',
    meiryo: 'Meiryo, "メイリオ", sans-serif',
    'yu-gothic': '"Yu Gothic", "游ゴシック", sans-serif',
    'yu-mincho': '"Yu Mincho", "游明朝", serif',
    'noto-serif': '"Noto Serif JP", serif',
    aptos: 'Aptos, Calibri, sans-serif',
    calibri: 'Calibri, Arial, sans-serif',
    arial: 'Arial, sans-serif',
    helvetica: 'Helvetica, Arial, sans-serif',
    'segoe-ui': '"Segoe UI", sans-serif',
    cambria: 'Cambria, Georgia, serif',
    georgia: 'Georgia, serif',
    verdana: 'Verdana, sans-serif',
    'courier-new': '"Courier New", monospace'
  };

  const state = {
    workbook: null,
    analysisRange: null,
    prepRange: null,
    activeRole: null,
    keyboardPoint: null,
    stage: 'welcome',
    prepared: false,
    fileName: '',
    baseFileName: '',
    headers: [],
    rows: [],
    types: [],
    selection: null,
    dragging: false,
    movingRange: null,
    dragAnchor: null,
    phases: [],
    phaseColors: {},
    slots: Array.from({ length: 4 }, (_, index) => ({ name: ['A1', 'B1', 'A2', 'B2'][index], range: '', values: [], excluded: 0 })),
    lastChartSize: { width: 1000, height: 620 }
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function setStatus(id, text, type = 'neutral') {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = `status ${type}`;
  }

  function showMessage(id, text, type = 'error') {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = `message ${type}`;
  }

  function hideMessage(id) {
    const el = $(id);
    if (!el) return;
    el.className = 'message hidden';
    el.textContent = '';
  }

  function uniqueHeaders(rawHeaders, width) {
    const used = new Map();
    return Array.from({ length: width }, (_, index) => {
      const base = String(rawHeaders[index] ?? '').trim() || `Column ${C.columnNumberToLetters(index + 1)}`;
      const count = (used.get(base) || 0) + 1;
      used.set(base, count);
      return count === 1 ? base : `${base}_${count}`;
    });
  }

  function inferColumnType(index) {
    const nonMissing = state.rows.map(row => row[index]).filter(value => value !== null && value !== undefined && String(value).trim() !== '');
    if (!nonMissing.length) return 'empty';
    const numericCount = nonMissing.filter(C.isFiniteNumber).length;
    if (numericCount === nonMissing.length) return 'numeric';
    if (numericCount > 0) return 'mixed';
    return 'text';
  }

  function loadMatrix(matrix, fileName) {
    if (!Array.isArray(matrix) || !matrix.length) throw new Error('データが空です．');
    const width = Math.max(...matrix.map(row => Array.isArray(row) ? row.length : 0));
    if (!width) throw new Error('列を認識できませんでした．');
    state.headers = uniqueHeaders(matrix[0] || [], width);
    state.rows = matrix.slice(1).map(row => Array.from({ length: width }, (_, index) => row?.[index] ?? null));
    state.types = state.headers.map((_, index) => inferColumnType(index));
    state.fileName = fileName;
    state.selection = null;
    state.prepRange={start:0,end:state.rows.length-1};
    state.activeRole=null;
    $('exampleGuide').open=false;
    $('selectionLabel').textContent='セルをドラッグして選択。点線の端をつかむと範囲を移動できます。';
    $('preparationFeedback').textContent='';
    state.analysisRange = null;
    state.prepared = false;
    state.phases = [];
    state.phaseColors = {};
    state.slots = newSlots();
    renderDataSummary();
    renderGrid();
    populateColumnSelectors();

    $('preparationControls').classList.remove('hidden');
    $('visualBaseline').innerHTML='';$('visualIntervention').innerHTML='';
    setPrepared(false);
    renderSlots();
    showStage('prep');
    $('globalStatus').classList.add('hidden');
    setStatus('visualStatus', '解析可能', 'success');
    setStatus('statsStatus', '範囲を登録してください', 'neutral');
    updatePreparationSummary();
  }

  function renderDataSummary() {
    const missing = state.rows.flat().filter(value => value === null || value === undefined || String(value).trim() === '').length;
    const mixed = state.types.filter(type => type === 'mixed').length;
    const el = $('dataSummary');
    el.classList.remove('hidden');
    el.innerHTML = `<span class="summary-pill" data-i18n-skip>${escapeHtml(state.fileName)}</span><span class="summary-pill">${state.workbook?.SheetNames.length || 1}シート</span><span class="summary-pill">${state.rows.length}データ行</span><span class="summary-pill">${state.headers.length}列</span><span class="summary-pill">欠損セル ${missing}</span><span class="summary-pill">混合型列 ${mixed}</span>`;
  }

  function renderGrid() {
    const wrap = $('dataGridWrap');
    if (!state.headers.length) {
      wrap.innerHTML = '<div class="empty-state">ファイルを読み込むと，ここにデータ表が表示されます．</div>';
      return;
    }
    const displayRows = Math.min(state.rows.length, 5000);
    let html = '<table class="data-grid"><thead><tr><th class="row-number">#</th>';
    state.headers.forEach((header, index) => {
      html += `<th data-col="${index}" tabindex="0" title="${escapeHtml(header)}">${escapeHtml(header)}<span class="data-type">${escapeHtml(state.types[index])} · ${C.columnNumberToLetters(index + 1)}</span></th>`;
    });
    html += '</tr></thead><tbody>';
    for (let row = 0; row < displayRows; row += 1) {
      html += `<tr><td class="row-number" data-row="${row}" data-col="0" data-whole-row="true" title="行全体を選択">${row + 2}</td>`;
      for (let col = 0; col < state.headers.length; col += 1) {
        const value = state.rows[row][col];
        const missing = value === null || value === undefined || String(value).trim() === '';
        const invalid = !missing && state.types[col] === 'mixed' && !C.isFiniteNumber(value);
        html += `<td data-row="${row}" data-col="${col}" class="${missing ? 'missing' : invalid ? 'invalid' : ''}" title="${escapeHtml(value ?? '')}">${missing ? '—' : escapeHtml(value)}</td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    if (state.rows.length > displayRows) html += `<div class="message">${T('プレビューは先頭5,000行までです。列の見出しを選ぶと全測定を対象にできます。')}</div>`;
    wrap.innerHTML = html;
    bindGridSelection();
  }

  const roleIds = ['timeColumn','phaseColumn','dataColumn'];
  const roleClasses = ['role-time','role-phase','role-value'];
  function splitPhases(values) {
    const phases=C.splitConsecutivePhases(values);
    const counts=new Map();
    phases.forEach(p=>counts.set(p.raw,(counts.get(p.raw)||0)+1));
    phases.forEach(p=>{ if (/^[A-Za-z]+\d+$/.test(p.raw) && counts.get(p.raw)===1) p.label=p.raw; });
    return phases;
  }
  function bindGridSelection() {
    const wrap=$('dataGridWrap');
    wrap.querySelectorAll('td[data-row]').forEach(cell=>{
      cell.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;
        const rect=cell.getBoundingClientRect();
        const onEdge=cell.classList.contains('range-mark')&&(event.clientX-rect.left<7||rect.right-event.clientX<7||(cell.classList.contains('range-top')&&event.clientY-rect.top<7)||(cell.classList.contains('range-bottom')&&rect.bottom-event.clientY<7));
        if(onEdge&&!state.activeRole&&!event.shiftKey){
          state.activeRole=roleIds.find(id=>$(id).value!==''&&Number($(id).value)===Number(cell.dataset.col));
          if(state.activeRole){state.movingRange={...state.prepRange,col:Number(cell.dataset.col),row:Number(cell.dataset.row)};}
        }
        if(!state.activeRole){state.activeRole=roleIds.find(id=>Number($(id).value)===Number(cell.dataset.col))||'dataColumn';wrap.dataset.role=state.activeRole;}
        event.preventDefault();
        const point={row:Number(cell.dataset.row),col:Number(cell.dataset.col)};
        state.dragging=true;
        if(!event.shiftKey||!state.dragAnchor)state.dragAnchor=point;
        state.keyboardPoint=point;
        wrap.setPointerCapture?.(event.pointerId);
        if(state.movingRange)setSelection({row:state.movingRange.start,col:point.col},{row:state.movingRange.end,col:point.col});
        else setSelection(state.dragAnchor,{row:point.row,col:state.dragAnchor.col});wrap.focus({preventScroll:true});
      });
      cell.addEventListener('pointerenter',()=>{
        if(state.dragging&&!state.movingRange)setSelection(state.dragAnchor,{row:Number(cell.dataset.row),col:state.dragAnchor.col});
      });
    });
    wrap.querySelectorAll('th[data-col]').forEach(header=>{
      const pick=()=>{const col=Number(header.dataset.col);if(!state.activeRole)state.activeRole=roleIds.find(id=>Number($(id).value)===col)||'dataColumn';setSelection({row:0,col},{row:state.rows.length-1,col});commitSelection();};
      header.addEventListener('click',pick);
      header.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});
    });
  }
  function startSelection(role) {
    state.activeRole=role;
    const col=Number($(role).value||0),r=state.prepRange||{start:0,end:state.rows.length-1};
    state.keyboardPoint={row:r.start,col};state.dragAnchor={...state.keyboardPoint};state.selection=null;
    document.querySelectorAll('[data-pick-role]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pickRole===role)));
    $('dataGridWrap').dataset.role=role;
    $('selectionLabel').textContent=T('列の見出しで全体を選択、セルのドラッグで一部を選択。Enterで確定、Escapeで取り消せます。');
    $('dataGridWrap').scrollIntoView({behavior:'instant',block:'center'});
    $('dataGridWrap').focus({preventScroll:true});
    updateSelectionHighlight();
  }
  function setSelection(a,b) {
    state.selection={startRow:Math.min(a.row,b.row),endRow:Math.max(a.row,b.row),startCol:a.col,endCol:a.col};
    state.keyboardPoint={row:b.row,col:a.col};
    updateSelectionHighlight();
  }
  function commitSelection() {
    if(!state.activeRole || !state.selection)return;
    const r=state.selection;
    $(state.activeRole).value=String(r.startCol);
    state.prepRange={start:r.startRow,end:r.endRow};
    state.activeRole=null;state.selection=null;state.dragging=false;state.movingRange=null;
    document.querySelectorAll('[data-pick-role]').forEach(b=>b.setAttribute('aria-pressed','false'));
    delete $('dataGridWrap').dataset.role;
    setPrepared(false);updatePreparationSummary();
    $('selectionLabel').textContent=T('選択中：')+selectionToA1(r)+T('。ドラッグで選び直せます。');
    $('preparationFeedback').textContent=T('選択した測定範囲を①〜③に共通で反映しました。');
  }
  function cancelSelection() {
    state.activeRole=null;state.selection=null;state.dragging=false;state.movingRange=null;
    document.querySelectorAll('[data-pick-role]').forEach(b=>b.setAttribute('aria-pressed','false'));
    delete $('dataGridWrap').dataset.role;updateSelectionHighlight();
    $('selectionLabel').textContent=T('セルをドラッグして選択。点線の端をつかむと範囲を移動できます。');
  }
  function selectionToA1(selection) {
    if(!selection)return '';
    return `${C.columnNumberToLetters(selection.startCol+1)}${selection.startRow+2}:${C.columnNumberToLetters(selection.endCol+1)}${selection.endRow+2}`;
  }
  function updateSelectionHighlight() {
    const r=state.prepRange;
    $('dataGridWrap').querySelectorAll('[data-col]').forEach(cell=>{
      cell.classList.remove('selected','range-mark','range-top','range-bottom',...roleClasses);
      const col=Number(cell.dataset.col),row=Number(cell.dataset.row);
      roleIds.forEach((id,i)=>{if($(id).value!=='' && Number($(id).value)===col && (cell.tagName==='TH' || (r && row>=r.start&&row<=r.end)))cell.classList.add(roleClasses[i]);});
      if(cell.tagName==='TD' && !cell.dataset.wholeRow){
        const draft=state.selection && col===state.selection.startCol;
        const bounds=draft?{start:state.selection.startRow,end:state.selection.endRow}:r;
        const assigned=roleIds.some(id=>$(id).value!==''&&Number($(id).value)===col);
        if(bounds&&(draft||assigned)&&row>=bounds.start&&row<=bounds.end){
          cell.classList.add('range-mark');
          if(draft)cell.classList.add('selected');
          if(row===bounds.start)cell.classList.add('range-top');
          if(row===bounds.end)cell.classList.add('range-bottom');
        }
      }
    });
    if(state.selection)$('selectionLabel').textContent=selectionToA1(state.selection);
  }

  function populateColumnSelectors() {
    ['timeColumn', 'phaseColumn', 'dataColumn'].forEach(id => {
      $(id).innerHTML = '<option value="">選択してください</option>' + state.headers.map((header, index) => `<option value="${index}">${escapeHtml(header)} (${C.columnNumberToLetters(index + 1)})</option>`).join('');
    });
    const findHeader = patterns => state.headers.findIndex(header => patterns.some(pattern => pattern.test(header)));
    let time = findHeader([/^day$/i, /time/i, /session/i, /回数/, /介入数/, /^no$/i, /日/i]);
    let phase = findHeader([/phase/i, /フェーズ/i, /条件/i, /時期/]);
    if (time < 0) time = state.types.findIndex(type => type === 'numeric');
    if (phase < 0) phase = state.types.findIndex(type => type === 'text');
    let data = findHeader([/^outcome$/i, /^nrs$/i, /^cop$/i, /測定値/, /歩行速度/, /gait speed/i, /score/i, /value/i]);
    if (data < 0) data = state.types.findIndex((type, index) => ['numeric','mixed'].includes(type) && index !== time && index !== phase);
    if (data < 0) data = state.types.findIndex(type => type === 'numeric');
    if (time >= 0) $('timeColumn').value = String(time);
    if (phase >= 0) $('phaseColumn').value = String(phase);
    if (data >= 0) $('dataColumn').value = String(data);
  }

  function phaseBaseKey(phase) {
    const match = String(phase.raw || phase.label || '').trim().match(/^[A-Za-z]+/);
    return (match?.[0] || String(phase.raw || phase.label || '')).toUpperCase();
  }

  function defaultPhaseColor(phase, index) {
    const key = phaseBaseKey(phase);
    return phaseBasePalette.get(key) || palette[index % palette.length];
  }

  function ensurePhaseColors(phases) {
    phases.forEach((phase, index) => {
      if (!state.phaseColors[phase.label]) {
        const color = defaultPhaseColor(phase, index);
        state.phaseColors[phase.label] = { point: color, line: color };
      }
    });
    renderPhaseColorControls(phases);
  }

  function renderPhaseColorControls(phases) {
    const el = $('phaseColorControls');
    const labels = phases.map(phase => phase.label);
    const existing = [...el.querySelectorAll('.phase-color-row')].map(row => row.dataset.phase);
    if (JSON.stringify(labels) === JSON.stringify(existing)) return;
    el.innerHTML = phases.map(phase => `<div class="phase-color-row" data-phase="${escapeHtml(phase.label)}"><strong>${escapeHtml(phase.label)}</strong><label>点<input type="color" data-color-type="point" value="${state.phaseColors[phase.label].point}"></label><label>線<input type="color" data-color-type="line" value="${state.phaseColors[phase.label].line}"></label></div>`).join('');
    el.querySelectorAll('input[type=color]').forEach(input => input.addEventListener('input', event => {
      const row = event.target.closest('.phase-color-row');
      state.phaseColors[row.dataset.phase][event.target.dataset.colorType] = event.target.value;
      renderVisual();
    }));
  }

  function getVisualDataset() {
    validatePreparation();
    const timeCol = Number($('timeColumn').value);
    const phaseCol = Number($('phaseColumn').value);
    const dataCol = Number($('dataColumn').value);
    if (![timeCol, phaseCol, dataCol].every(Number.isInteger)) throw new Error('時間列，フェーズ列，データ列をすべて選択してください．');
    const subset = selectedRows();
    const phases = splitPhases(subset.map(row => row[phaseCol]));
    phases.forEach(phase => {
      const points = phase.indices.map(rowIndex => ({ rowIndex, x: C.toNumber(subset[rowIndex][timeCol]), y: C.toNumber(subset[rowIndex][dataCol]) })).filter(point => point.x !== null && point.y !== null);
      phase.points = points;
      phase.x = points.map(point => point.x);
      phase.y = points.map(point => point.y);
      phase.excluded = phase.indices.length - points.length;
    });
    state.phases = phases;
    ensurePhaseColors(phases);
    return { phases, timeCol, phaseCol, dataCol, timeName: state.headers[timeCol], dataName: state.headers[dataCol] };
  }

  function optionalNumber(id) {
    const text = $(id).value.trim();
    if (text === '') return null;
    const value = Number(text);
    return Number.isFinite(value) ? value : null;
  }

  function readChartSettings() {
    return {
      showPoints: $('showPoints').checked,
      showLines: $('showLines').checked,
      pointShape: $('pointShape').value,
      pointSize: Number($('pointSizeNumber').value),
      lineWidth: Number($('lineWidthNumber').value),
      showTrend: $('showTrend').checked,
      trendColor: $('trendColor').value,
      trendWidth: Number($('trendWidthNumber').value),
      trendDash: $('trendDash').value,
      showBounds: $('showBounds').checked,
      sdColor: $('sdColor').value,
      sdWidth: Number($('sdWidthNumber').value),
      sdDash: $('sdDash').value,
      vaiorColor: $('vaiorColor').value,
      vaiorWidth: Number($('vaiorWidthNumber').value),
      vaiorDash: $('vaiorDash').value,
      showPhaseBoundaries: $('showPhaseBoundaries').checked,
      boundaryColor: $('boundaryColor').value,
      boundaryWidth: Number($('boundaryWidthNumber').value),
      chartFont: fontMap[$('chartFont').value] || fontMap['noto-sans'],
      backgroundColor: $('backgroundColor').value,
      axisColor: $('axisColor').value,
      showGridLines: $('showGridLines').checked,
      gridColor: $('gridColor').value,
      yMin: optionalNumber('yAxisMin'),
      yMax: optionalNumber('yAxisMax'),
      yTick: optionalNumber('yAxisTick')
    };
  }

  function fmt(value, digits = Number($('visualDigits').value)) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return '算出不能';
    return Number(value).toFixed(digits);
  }

  function fmtPercent(value, digits = Number($('visualDigits').value)) {
    if (value === null || !Number.isFinite(value)) return '算出不能';
    return `${(value * 100).toFixed(digits)}％`;
  }

  function fmtStat(value, digits) {
    return value === null || value === undefined || !Number.isFinite(Number(value)) ? '算出不能' : Number(value).toFixed(digits);
  }

  function pFmt(value, digits = Number($('statsDigits').value)) {
    if (value === null || value === undefined || !Number.isFinite(value)) return '算出不能';
    if (value < 0.001) return 'p＜0.001';
    return `p＝${value.toFixed(digits)}`;
  }

  function ciFmt(ci, digits = Number($('statsDigits').value)) {
    if (!ci) return '算出不能';
    return `${ci.lower.toFixed(digits)}～${ci.upper.toFixed(digits)}`;
  }

  function equation(slope, intercept, digits = Number($('visualDigits').value)) {
    if (![slope, intercept].every(Number.isFinite)) return '算出不能';
    return `Y ＝ ${slope.toFixed(digits)} × X ${intercept >= 0 ? '＋' : '－'} ${Math.abs(intercept).toFixed(digits)}`;
  }

  function table(headers, rows) {
    return `<div class="table-scroll"><table class="result-table"><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }

  function metric(label, value) {
    return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${value}</strong></div>`;
  }

  function statusBadge(result) {
    if (!result || result.status === 'indeterminate') return `<span class="badge unknown">判定不能${result?.reason ? `：${escapeHtml(result.reason)}` : ''}</span>`;
    return result.status === 'effective' ? '<span class="badge good">効果あり</span>' : '<span class="badge bad">効果なし</span>';
  }

  function makeYAxis(data, settings) {
    const allY = data.phases.flatMap(phase => phase.y);
    if (!allY.length) return {};
    let min = settings.yMin;
    let max = settings.yMax;
    if (min !== null && max !== null && min >= max) throw new Error('縦軸の最小値は最大値より小さくしてください．');
    const dataMin = Math.min(...allY);
    const dataMax = Math.max(...allY);
    const span = Math.max(dataMax - dataMin, Math.abs(dataMax || 1) * 0.1, 1);
    if (min !== null && max === null) max = Math.max(dataMax + span * 0.08, min + span);
    if (max !== null && min === null) min = Math.min(dataMin - span * 0.08, max - span);
    const axis = {
      title: {text:data.dataName},
      showline: true,
      linecolor: settings.axisColor,
      showgrid: settings.showGridLines,
      gridcolor: settings.gridColor,
      zeroline: false
    };
    if (min !== null || max !== null) axis.range = [min, max];
    if (settings.yTick !== null) {
      if (settings.yTick <= 0) throw new Error('縦軸の目盛間隔は0より大きい値にしてください．');
      axis.dtick = settings.yTick;
    }
    return axis;
  }

  function renderVisual() {
    hideMessage('visualValidation');
    if (!state.prepared) return;
    try {
      setStatus('visualStatus', '計算中', 'loading');
      const data = getVisualDataset();
      const method = $('visualMethod').value;
      const directionNeeded = method === 'twoSD' || method === 'celeration' || method === 'vaior';
      $('visualDirectionWrap').classList.toggle('hidden', !directionNeeded);
      const direction = $('visualDirection').value;
      $('visualComparison').classList.toggle('hidden',!directionNeeded);
      ['visualBaseline','visualIntervention'].forEach(id=>{
        const select=$(id), previous=select.value;
        select.innerHTML='<option value="">A→Bを自動比較（全ペア）</option>'+data.phases.map(p=>'<option value="'+escapeHtml(p.label)+'">'+escapeHtml(p.label)+'</option>').join('');
        if(data.phases.some(p=>p.label===previous))select.value=previous;
      });
      const settings = readChartSettings();
      const traces = [];
      const shapes = [];
      const mode = settings.showPoints && settings.showLines ? 'lines+markers' : settings.showPoints ? 'markers' : settings.showLines ? 'lines' : 'none';

      data.phases.forEach(phase => {
        if (!phase.points.length) return;
        traces.push({
          x: phase.x,
          y: phase.y,
          type: 'scatter',
          mode,
          name: phase.label,
          marker: { color: state.phaseColors[phase.label].point, size: settings.pointSize, symbol: settings.pointShape },
          line: { color: state.phaseColors[phase.label].line, width: settings.lineWidth },
          hovertemplate: `${escapeHtml(phase.label)}<br>${escapeHtml(data.timeName)}=%{x}<br>${escapeHtml(data.dataName)}=%{y}<extra></extra>`
        });
      });

      if (settings.showPhaseBoundaries) {
        for (let index = 0; index < data.phases.length - 1; index += 1) {
          const left = data.phases[index].x;
          const right = data.phases[index + 1].x;
          if (!left.length || !right.length) continue;
          const boundary = (left[left.length - 1] + right[0]) / 2;
          shapes.push({ type: 'line', x0: boundary, x1: boundary, y0: 0, y1: 1, yref: 'paper', line: { color: settings.boundaryColor, width: settings.boundaryWidth, dash: 'dash' } });
        }
      }

      let analysisHtml = '';
      if (method === 'ols' || method === 'theil') analysisHtml = renderPhaseTrendAnalysis(data, method, traces, settings);
      else if (method === 'twoSD') analysisHtml = renderTwoSD(data, direction, traces, settings);
      else if (method === 'celeration') analysisHtml = renderCelerationAB(data, direction, traces, settings);
      else analysisHtml = renderVaior(data, direction, traces, settings);

      const allStats = C.descriptiveStats(data.phases.flatMap(phase => phase.y));
      const statRows = [['データ全体', fmt(allStats.mean), fmt(allStats.sd), fmt(allStats.median), fmt(allStats.max), fmt(allStats.min)]];
      data.phases.forEach(phase => {
        const stats = C.descriptiveStats(phase.y);
        statRows.push([escapeHtml(phase.label), fmt(stats.mean), fmt(stats.sd), fmt(stats.median), fmt(stats.max), fmt(stats.min)]);
      });
      $('visualResults').innerHTML = `<div class="result-block"><h3>記述統計量</h3>${table(['対象', '平均値', '標準偏差', '中央値', '最大値', '最小値'], statRows)}</div>${analysisHtml}`;
      $('chartCaption').textContent = `${data.timeName} × ${data.dataName}｜${data.phases.map(phase => phase.label).join(' → ')}`;

      const layout = {
        margin: { l: 70, r: 24, t: 34, b: 62 },
        paper_bgcolor: settings.backgroundColor,
        plot_bgcolor: settings.backgroundColor,
        font: { family: settings.chartFont, color: '#2b2b2b' },
        hovermode: 'closest',
        showlegend: true,
        legend: { orientation: 'h', y: 1.08, x: 0 },
        xaxis: { title: {text:data.timeName}, showline: true, linecolor: settings.axisColor, showgrid: settings.showGridLines, gridcolor: settings.gridColor, zeroline: false },
        yaxis: makeYAxis(data, settings),
        shapes
      };
      Plotly.react('chart', traces, layout, { responsive: true, displayModeBar: false, displaylogo: false, scrollZoom: false });
      const chartEl = $('chart');
      state.lastChartSize = { width: Math.max(320, Math.round(chartEl.clientWidth)), height: Math.max(240, Math.round(chartEl.clientHeight)) };
      setStatus('visualStatus', '計算完了', 'success');
    } catch (error) {
      $('chart').innerHTML = '<div class="empty-state">グラフを表示できません．</div>';
      $('visualResults').innerHTML = `<div class="message error">${escapeHtml(error.message)}</div>`;
      showMessage('visualValidation', error.message);
      setStatus('visualStatus', '計算不能', 'error');
    }
  }

  function renderPhaseTrendAnalysis(data, method, traces, settings) {
    const rows = [];
    const notices = [];
    data.phases.forEach(phase => {
      try {
        if (phase.x.length < 2) throw new Error('有効データが2点未満です．');
        const result = method === 'ols' ? C.linearRegression(phase.x, phase.y) : C.theilSen(phase.x, phase.y);
        if (settings.showTrend) {
          const xMin = Math.min(...phase.x);
          const xMax = Math.max(...phase.x);
          traces.push({ x: [xMin, xMax], y: [result.predict(xMin), result.predict(xMax)], type: 'scatter', mode: 'lines', showlegend: false, line: { color: settings.trendColor, width: settings.trendWidth, dash: settings.trendDash }, hoverinfo: 'skip' });
        }
        rows.push([escapeHtml(phase.label), escapeHtml(equation(result.slope, result.intercept)), fmt(result.slope), fmt(result.intercept)]);
        if (method === 'theil' && result.excludedSameX > 0) notices.push(`${phase.label}：同一Xの組み合わせを${result.excludedSameX}ペア除外`);
      } catch (error) {
        const count = 4;
        rows.push([escapeHtml(phase.label), `<span class="badge unknown">${escapeHtml(error.message)}</span>`, ...Array(count - 2).fill('—')]);
      }
    });
    const title = method === 'ols' ? 'Trend（最小二乗法）' : 'Trend（Theil–Sen法）';
    const body = table(['フェーズ', '回帰式', 'Slope', 'Intercept'], rows);
    const note = notices.length ? `<p class="result-note">${notices.map(escapeHtml).join('／')}</p>` : '';
    return `<div class="result-block"><h3>${title}</h3>${body}${note}</div>`;
  }

  function phasePairsWithData(data) {
    const baseline=data.phases.find(p=>p.label===$('visualBaseline').value);
    const intervention=data.phases.find(p=>p.label===$('visualIntervention').value);
    if (baseline || intervention) {
      if (!baseline || !intervention || baseline === intervention) throw Error('比較する異なる2フェーズを指定してください。');
      return [{baseline,intervention}];
    }
    return C.pairBaselineIntervention(data.phases);
  }

  function renderTwoSD(data, direction, traces, settings) {
    const pairs = phasePairsWithData(data);
    if (!pairs.length) throw new Error('A期の直後にB期が続く組み合わせがありません．');
    const rows = [];
    pairs.forEach(({ baseline, intervention }) => {
      try {
        const result = C.twoSDAnalysis(baseline.x, baseline.y, intervention.x, intervention.y, direction);
        const xAll = [...baseline.x, ...intervention.x];
        if (settings.showTrend) traces.push({ x: xAll, y: xAll.map(() => result.baselineMean), type: 'scatter', mode: 'lines', showlegend: false, line: { color: settings.trendColor, width: settings.trendWidth, dash: settings.trendDash }, hoverinfo: 'skip' });
        if (settings.showBounds) {
          traces.push({ x: xAll, y: xAll.map(() => result.upper), type: 'scatter', mode: 'lines', showlegend: false, line: { color: settings.sdColor, width: settings.sdWidth, dash: settings.sdDash }, hoverinfo: 'skip' });
          traces.push({ x: xAll, y: xAll.map(() => result.lower), type: 'scatter', mode: 'lines', showlegend: false, line: { color: settings.sdColor, width: settings.sdWidth, dash: settings.sdDash }, hoverinfo: 'skip' });
        }
        rows.push([`${escapeHtml(baseline.label)} → ${escapeHtml(intervention.label)}`, fmt(result.baselineMean), fmt(result.sd), fmt(result.twoSD), fmt(result.upper), fmt(result.lower), `${result.improvedCount}/${result.interventionN}（${fmtPercent(result.improvedRate)}）`]);
      } catch (error) {
        rows.push([`${escapeHtml(baseline.label)} → ${escapeHtml(intervention.label)}`, `<span class="badge unknown">${escapeHtml(error.message)}</span>`, '—', '—', '—', '—', '—']);
      }
    });
    return `<div class="result-block"><h3>2SD法</h3>${table(['比較', 'A期平均', 'SD', '2SD', '上限', '下限', '改善側境界を超えたB期データ'], rows)}</div>`;
  }

  function renderCelerationAB(data, direction, traces, settings) {
    const pairs = phasePairsWithData(data);
    if (!pairs.length) throw new Error('A期の直後にB期が続く組み合わせがありません．');
    const rows = [];
    pairs.forEach(({ baseline, intervention }) => {
      try {
        const result = C.celerationABAnalysis(baseline.x, baseline.y, intervention.x, intervention.y, direction);
        const xAll = [...baseline.x, ...intervention.x];
        if (settings.showTrend) traces.push({ x: xAll, y: xAll.map(result.predict), type: 'scatter', mode: 'lines', showlegend: false, line: { color: settings.trendColor, width: settings.trendWidth, dash: settings.trendDash }, hoverinfo: 'skip' });
        const judgment = result.effective ? '<span class="badge good">効果あり</span>' : '<span class="badge bad">効果ありとは判定されない</span>';
        rows.push([
          `${escapeHtml(baseline.label)} → ${escapeHtml(intervention.label)}`,
          `(${fmt(result.firstPoint.x)}，${fmt(result.firstPoint.y)})`,
          `(${fmt(result.secondPoint.x)}，${fmt(result.secondPoint.y)})`,
          escapeHtml(equation(result.slope, result.intercept)),
          `${result.improvedCount}/${result.testN}`,
          String(result.oppositeCount),
          String(result.tiedCount),
          pFmt(result.pValue, Number($('visualDigits').value)),
          judgment
        ]);
      } catch (error) {
        rows.push([`${escapeHtml(baseline.label)} → ${escapeHtml(intervention.label)}`, `<span class="badge unknown">${escapeHtml(error.message)}</span>`, '—', '—', '—', '—', '—', '—', '—']);
      }
    });
    return `<div class="result-block"><h3>Celeration Line分析</h3>${table(['比較', '前半中央値座標', '後半中央値座標', '回帰式', '改善側／検定対象', '反対側', '同値', '二項検定（片側）', '判定'], rows)}<p class="result-note">二項検定は，介入期の各実測値をベースライン期から延長したCeleration Lineの予測値と比較し，改善方向に位置する点が偶然の50％を上回るかを正確片側検定で確認します．線上の点は検定から除外します．</p></div>`;
  }

  function renderVaior(data, direction, traces, settings) {
    const pairs = phasePairsWithData(data);
    if (!pairs.length) throw new Error('A期の直後にB期が続く組み合わせがありません．');
    const blocks = [];
    pairs.forEach(({ baseline, intervention }) => {
      try {
        const result = C.vaiorAnalysis(baseline.x, baseline.y, intervention.x, intervention.y, direction);
        const xAll = [...baseline.x, ...intervention.x];
        if (settings.showTrend) traces.push({ x: xAll, y: xAll.map(result.predict), type: 'scatter', mode: 'lines', showlegend: false, line: { color: settings.trendColor, width: settings.trendWidth, dash: settings.trendDash }, hoverinfo: 'skip' });
        if (settings.showBounds) {
          traces.push({ x: xAll, y: xAll.map(x => result.predict(x) + result.mad), type: 'scatter', mode: 'lines', showlegend: false, line: { color: settings.vaiorColor, width: settings.vaiorWidth, dash: settings.vaiorDash }, hoverinfo: 'skip' });
          traces.push({ x: xAll, y: xAll.map(x => result.predict(x) - result.mad), type: 'scatter', mode: 'lines', showlegend: false, line: { color: settings.vaiorColor, width: settings.vaiorWidth, dash: settings.vaiorDash }, hoverinfo: 'skip' });
        }
        const criterion = result.criterion > 1 ? `${fmtPercent(result.criterion)}（100％を超えるため到達不能）` : fmtPercent(result.criterion);
        blocks.push(`<section class="compact-result-section"><h4>${escapeHtml(baseline.label)} → ${escapeHtml(intervention.label)}</h4><div class="result-grid">${metric('Theil–Sen回帰式', escapeHtml(equation(result.slope, result.intercept)))}${metric('変動幅（絶対偏差中央値）', fmt(result.mad))}${metric('A期範囲外', `${result.baselineOutsideCount}/${result.baselineN}（${fmtPercent(result.baselineOutsideRate)}）`)}${metric('判定基準値', criterion)}${metric('B期改善側範囲外', `${result.interventionImprovedCount}/${result.interventionN}（${fmtPercent(result.interventionImprovedRate)}）`)}${metric('即時効果', statusBadge(result.immediate))}${metric('漸進的・遅延的効果', statusBadge(result.delayed))}${metric('介入期全体', statusBadge(result.overall))}</div></section>`);
      } catch (error) {
        blocks.push(`<div class="message error">${escapeHtml(baseline.label)} → ${escapeHtml(intervention.label)}：${escapeHtml(error.message)}</div>`);
      }
    });
    return `<div class="result-block"><h3>VAIOR（Visual Aid Implying an Objective Rule）</h3>${blocks.join('')}</div>`;
  }

  function renderSlots() {
    const el = $('dataSlots');
    el.innerHTML = state.slots.map((slot, index) => `<article class="slot-card" data-slot="${index}"><h3>データ${index + 1}</h3><label class="field">データ名<input class="slot-name" value="${escapeHtml(slot.name)}"></label><label class="field">セル範囲<input class="slot-range" value="${escapeHtml(slot.range)}" placeholder="例：C2:C6"></label><div class="slot-meta">${slot.range ? `<strong>${escapeHtml(slot.range)}</strong><div>数値データ：${slot.values.length - slot.excluded}点</div><div>除外：${slot.excluded}点</div><div class="preview-values">${slot.values.slice(0, 10).map(value => escapeHtml(value)).join(', ') || '数値データなし'}</div>` : '未登録'}</div><div class="slot-actions"><button class="button secondary register-slot" type="button">現在の選択を登録</button><button class="button danger clear-slot" type="button">解除</button></div></article>`).join('');
    el.querySelectorAll('.slot-name').forEach((input, index) => input.addEventListener('input', () => {
      state.slots[index].name = input.value || `データ${index + 1}`;
      renderComparisonChecks();
    }));
    el.querySelectorAll('.slot-range').forEach((input, index) => input.addEventListener('change', () => registerSlot(index, input.value)));
    el.querySelectorAll('.register-slot').forEach((button, index) => button.addEventListener('click', () => registerSlot(index, state.selection ? selectionToA1(state.selection) : button.closest('.slot-card').querySelector('.slot-range').value)));
    el.querySelectorAll('.clear-slot').forEach((button, index) => button.addEventListener('click', () => {
      state.slots[index] = { name: ['A1', 'B1', 'A2', 'B2'][index], range: '', values: [], excluded: 0 };
      renderSlots();
    }));
    renderComparisonChecks();
    if(state.prepared)refreshStats();
  }

  function suggestedPhaseName(parsed) {
    const phaseCol = Number($('phaseColumn').value);
    if (!Number.isInteger(phaseCol)) return null;
    const phases = splitPhases(selectedRows().map(row => row[phaseCol]));
    const offset = state.analysisRange?.start ?? 0;
    return phases.find(phase => parsed.startRow >= phase.start + offset && parsed.endRow <= phase.end + offset)?.label || null;
  }

  function registerSlot(index, rangeText) {
    hideMessage('statsValidation');
    try {
      if (!state.headers.length) throw new Error('先にデータを読み込んでください．');
      const parsed = C.parseA1Range(rangeText);
      if (parsed.startCol !== parsed.endCol) throw new Error('統計解析の各データ欄には，1列の範囲を指定してください．');
      if (parsed.endCol >= state.headers.length || parsed.endRow >= state.rows.length) throw new Error('指定範囲がデータ表の範囲を超えています．');
      if (state.analysisRange && (parsed.startRow < state.analysisRange.start || parsed.endRow > state.analysisRange.end)) throw new Error('準備画面で指定した行範囲内を選んでください．');
      if (parsed.startCol !== Number($('dataColumn').value)) throw Error('STEP 1で選択した測定値列の範囲を指定してください。');
      const rawValues = [];
      for (let row = parsed.startRow; row <= parsed.endRow; row += 1) rawValues.push(C.isFiniteNumber(state.rows[row][Number($('timeColumn').value)]) ? state.rows[row][parsed.startCol] : null);
      const cleaned = C.cleanNumeric(rawValues);
      if (!cleaned.values.length) throw new Error('指定範囲に数値データがありません．');
      state.slots[index] = { name: suggestedPhaseName(parsed) || state.slots[index].name || `データ${index + 1}`, range: parsed.normalized, values: rawValues, excluded: cleaned.excludedCount };
      renderSlots();
      setStatus('statsStatus', `${state.slots.filter(slot => slot.range).length}データ登録済み`, 'success');
    } catch (error) {
      showMessage('statsValidation', error.message);
      $('statsResults').innerHTML='<div class="empty-state">登録範囲を確認してください。</div>';
      setStatus('statsStatus', '登録エラー', 'error');
    }
  }

  function renderComparisonChecks() {
    const el = $('comparisonChecks');
    const selected = [...el.querySelectorAll('input:checked')].map(input => Number(input.value));
    el.innerHTML = state.slots.map((slot, index) => `<label class="comparison-item"><input type="checkbox" value="${index}" ${selected.includes(index) ? 'checked' : ''} ${slot.range ? '' : 'disabled'}><strong>${escapeHtml(slot.name)}</strong><span>${slot.range ? escapeHtml(slot.range) : '未登録'}</span></label>`).join('');
  }

  function renderStatsDefinition() {
    const method = $('statsMethod').value;
    const tau = method === 'tauU';
    $('tauCorrectionWrap').classList.toggle('hidden', !tau);
    $('statsDefinitionNote').innerHTML = helpHtml(method === 'tauU' && !$('tauCorrection').checked ? 'tau' : method, 'stat-reference');
  }

  function compactAnalysisInfo(result, baseline, intervention) {
    const excludedA = result.excludedBaseline ?? C.cleanNumeric(baseline.values).excludedCount;
    const excludedB = result.excludedIntervention ?? C.cleanNumeric(intervention.values).excludedCount;
    const nA = baseline.values.length - excludedA;
    const nB = intervention.values.length - excludedB;
    const excluded = excludedA + excludedB > 0 ? `／除外：A期 ${excludedA}，B期 ${excludedB}` : '';
    const inference = result.inferenceMethod ? `<br>推論法：${escapeHtml(result.inferenceMethod)}` : '';
    const caution = result.inferenceCaution ? `<br>${escapeHtml(result.inferenceCaution)}` : '';
    return `<p class="result-note">使用データ：${escapeHtml(baseline.name)} n=${nA}，${escapeHtml(intervention.name)} n=${nB}${excluded}${inference}${caution}<br>統計解析はB期が${$('statsDirection').value === 'lower' ? '低い' : '高い'}方向を改善として計算します．目安は便宜的な区分であり，グラフの水準・傾向・ばらつきと併せて解釈してください．</p>`;
  }

  function calculateStats() {
    hideMessage('statsValidation');
    try {
      setStatus('statsStatus', '計算中', 'loading');
      const selected = [...document.querySelectorAll('#comparisonChecks input:checked')].map(input => Number(input.value));
      if (selected.length !== 2) throw new Error('比較するデータを2つだけ選択してください．上側のデータをベースライン期，下側のデータを介入期として扱います．');
      if (!state.prepared) throw Error('データの設定を確認してください。');
      selected.sort((a, b) => a - b);
      const baseline = state.slots[selected[0]];
      const intervention = state.slots[selected[1]];
      const method = $('statsMethod').value;
      const direction = $('statsDirection').value;
      const digits = Number($('statsDigits').value);
      const comparison = `${baseline.name}–${intervention.name}`;
      const pairLabel = direction === 'lower' ? 'B&lt;A' : 'B&gt;A';
      const reverseLabel = direction === 'lower' ? 'B&gt;A' : 'B&lt;A';
      let result;
      let html;

      if (method === 'pnd') {
        result = C.pnd(baseline.values, intervention.values, direction);
        html = table(['比較', direction === 'lower' ? 'A期最小値' : 'A期最大値', '基準を超えたB期データ', 'PND', '目安'], [[escapeHtml(comparison), fmtStat(result.bestBaseline, digits), `${result.improvedCount}/${result.interventionN}`, `${fmtStat(result.pnd * 100, digits)}％`, escapeHtml(result.interpretation)]]);
      } else if (method === 'nap') {
        result = C.nap(baseline.values, intervention.values, direction);
        html = table(['比較', 'NAP', '90％CI', '95％CI', 'P値', '目安', 'ペア内訳'], [[escapeHtml(comparison), fmtStat(result.nap, digits), ciFmt(result.ci90, digits), ciFmt(result.ci95, digits), pFmt(result.pValue, digits), escapeHtml(result.interpretation), `${pairLabel} ${result.improved}／同値 ${result.tied}／${reverseLabel} ${result.worsened}`]]);
      } else {
        const corrected = method === 'tauU' && $('tauCorrection').checked;
        if (corrected) {
          result = C.tauU(baseline.values, intervention.values, direction, { correctBaseline: true });
          html = table(['比較', 'Tau-U', '90％CI', '95％CI', 'P値', '目安'], [[escapeHtml(comparison), fmtStat(result.tauU, digits), ciFmt(result.ci90, digits), ciFmt(result.ci95, digits), pFmt(result.pValue, digits), escapeHtml(result.interpretation)]]);
          html += `<details class="calculation-details"><summary>計算過程を表示</summary><div class="result-grid">${metric('補正前のTau', fmtStat(result.tauAB, digits))}${metric('ベースライン傾向 S_A', fmtStat(result.trend.score, digits))}${metric('計算式', `(${fmtStat(result.cross.score, digits)} − ${fmtStat(result.trend.score, digits)}) ÷ ${result.denominator}`)}</div></details>`;
        } else {
          result = C.tau(baseline.values, intervention.values, direction);
          html = table(['比較', 'Tau', '90％CI', '95％CI', 'P値', '目安', 'ペア内訳'], [[escapeHtml(comparison), fmtStat(result.tau, digits), ciFmt(result.ci90, digits), ciFmt(result.ci95, digits), pFmt(result.pValue, digits), escapeHtml(result.interpretation), `${pairLabel} ${result.improved}／同値 ${result.tied}／${reverseLabel} ${result.worsened}`]]);
        }
      }
      const interpreted = direction === 'lower'
        ? result.interpretation.replaceAll('B期が高い方向', '改善方向').replaceAll('B期が低い方向', '逆方向')
        : result.interpretation;
      if (direction === 'lower' && result.interpretation !== interpreted) {
        html = html.replaceAll(escapeHtml(result.interpretation), escapeHtml(interpreted));
      }
      const label = method === 'tauU' && !$('tauCorrection').checked ? 'Tau（補正なし）' : {pnd:'PND',nap:'NAP',tau:'Tau',tauU:'Tau-U'}[method];
      const value = result.pnd ?? result.nap ?? result.tauU ?? result.tau;
      $('statsResults').innerHTML = `<div class="key-result"><span>${label}</span><strong>${fmtStat(method === 'pnd' ? value * 100 : value, digits)}${method === 'pnd' ? '％' : ''}</strong><p>${escapeHtml(interpreted)}</p></div>` + html + compactAnalysisInfo(result, baseline, intervention) + '<p class="result-note">非重複指標だけでは介入との因果関係を断定できません。研究デザイン・自己相関・測定条件と併せて判断してください。</p>';
      setStatus('statsStatus', '計算完了', 'success');
    } catch (error) {
      $('statsResults').innerHTML = '<div class="empty-state">設定を確認して再計算してください。</div>';
      showMessage('statsValidation', error.message);
      setStatus('statsStatus', '計算不能', 'error');
    }
  }

  async function handleFile(file) {
    try {
      setStatus('globalStatus', '読込中', 'loading');
      if (!/\.(csv|xlsx|xls)$/i.test(file.name)) throw Error('Excel（.xlsx・.xls）またはCSV（.csv）ファイルを選んでください。');
      if (typeof XLSX === 'undefined') throw Error('読み込みライブラリを取得できません。インターネット接続を確認して再読み込みしてください。');
      const buffer = await file.arrayBuffer();
      let input=buffer, inputType='array';
      if (/\.csv$/i.test(file.name)) {
        try { input=new TextDecoder('utf-8',{fatal:true}).decode(buffer); }
        catch { input=new TextDecoder('shift-jis').decode(buffer); }
        inputType='string';
      }
      const workbook = XLSX.read(input, { type: inputType, cellDates: false });
      state.workbook = workbook;
      state.baseFileName = file.name;
      $('sheetSelect').innerHTML = workbook.SheetNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
      $('sheetControl').classList.toggle('hidden', workbook.SheetNames.length <= 1);
      loadSheet(workbook.SheetNames[0], state.baseFileName);
    } catch (error) {
      setPrepared(false);
      setStatus('globalStatus', '読み込みに失敗しました：' + error.message + ' ファイルが破損・暗号化されていないか確認し、CSVで保存して再試行してください。', 'error');
    }
  }

  function loadSheet(name, fileName = state.baseFileName || state.fileName) {
    if (!state.workbook) return;
    try {
      const matrix = XLSX.utils.sheet_to_json(state.workbook.Sheets[name], { header: 1, defval: null, raw: true, blankrows: true, range: 0 });
      loadMatrix(matrix, `${fileName} / ${name}`);
    } catch (error) {
      state.rows=[];state.headers=[];state.slots=newSlots();
      setPrepared(false);renderGrid();renderSlots();updatePreparationSummary();
      $('dataSummary').classList.add('hidden');
      setStatus('globalStatus','このシートを読み込めません：'+error.message+' 見出しとデータがある別のシートを選んでください。','error');
    }
  }

  function resetChartSettings() {
    const values = {
      showPoints: true, showLines: true, pointShape: 'circle', pointSizeRange: 17, pointSizeNumber: 17,
      lineWidthRange: 2, lineWidthNumber: 2, showTrend: true, trendColor: '#2b2b2b', trendWidthRange: 2,
      trendWidthNumber: 2, trendDash: 'solid', showBounds: true, sdColor: '#5faf68', sdWidthRange: 1.5,
      sdWidthNumber: 1.5, sdDash: 'dash', vaiorColor: '#93c47d', vaiorWidthRange: 1.5, vaiorWidthNumber: 1.5,
      vaiorDash: 'dot', showPhaseBoundaries: true, boundaryColor: '#aab8ac', boundaryWidthRange: 1,
      boundaryWidthNumber: 1, chartFont: 'noto-sans', backgroundColor: '#ffffff', axisColor: '#415047',
      showGridLines: true, gridColor: '#dfeadf', yAxisMin: '', yAxisMax: '', yAxisTick: ''
    };
    Object.entries(values).forEach(([id, value]) => {
      const el = $(id);
      if (!el) return;
      if (typeof value === 'boolean') el.checked = value;
      else el.value = value;
    });
    state.phaseColors = {};
    renderVisual();
  }

  function bindDual(rangeId, numberId) {
    const range = $(rangeId);
    const number = $(numberId);
    range.addEventListener('input', () => { number.value = range.value; renderVisual(); });
    number.addEventListener('input', () => { range.value = number.value; renderVisual(); });
  }

  function openDownloadDialog() {
    if (!state.headers.length || !$('chart').data) {
      showMessage('visualValidation', '先にグラフを表示してください．');
      return;
    }
    const width = Math.max(320, state.lastChartSize.width || 1000);
    const height = Math.max(240, state.lastChartSize.height || 620);
    $('downloadWidth').value = width;
    $('downloadHeight').value = height;
    $('downloadAspect').checked = true;
    $('downloadDialog').dataset.aspect = String(width / height);
    if (typeof $('downloadDialog').showModal === 'function') $('downloadDialog').showModal();
    else $('downloadDialog').setAttribute('open', '');
  }

  function closeDownloadDialog() {
    if (typeof $('downloadDialog').close === 'function') $('downloadDialog').close();
    else $('downloadDialog').removeAttribute('open');
  }

  function syncDownloadDimension(changed) {
    if (!$('downloadAspect').checked) return;
    const aspect = Number($('downloadDialog').dataset.aspect) || 1.6;
    if (changed === 'width') $('downloadHeight').value = Math.max(1, Math.round(Number($('downloadWidth').value) / aspect));
    else $('downloadWidth').value = Math.max(1, Math.round(Number($('downloadHeight').value) * aspect));
  }

  async function downloadChart() {
    const format = $('downloadFormat').value;
    const width = Number($('downloadWidth').value);
    const height = Number($('downloadHeight').value);
    if (format !== 'pptx' && (!Number.isFinite(width) || !Number.isFinite(height) || width < 100 || height < 100)) {
      $('downloadError').textContent = '幅と高さは100以上の数値で入力してください．';
      $('downloadError').classList.remove('hidden');
      return;
    }
    $('downloadError').classList.add('hidden');
    $('confirmDownloadButton').disabled = true;
    $('confirmDownloadButton').textContent = '作成中…';
    try {
      if(format==='pptx'){await window.SCDPptx.download($('chart'),$('chartCaption').textContent);closeDownloadDialog();return;}
      const dataUrl = await Plotly.toImage('chart', { format, width: Math.round(width), height: Math.round(height), scale: 1 });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `SCD_graph.${format === 'jpeg' ? 'jpg' : format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      closeDownloadDialog();
    } catch (error) {
      $('downloadError').textContent = `画像を作成できませんでした：${error.message}`;
      $('downloadError').classList.remove('hidden');
    } finally {
      $('confirmDownloadButton').disabled = false;
      $('confirmDownloadButton').textContent = 'ダウンロード';
    }
  }


  function newSlots() { return ['A1','B1','A2','B2'].map(name => ({name,range:'',values:[],excluded:0})); }
  function selectedRows() {const r=state.analysisRange;return r ? state.rows.slice(r.start,r.end+1) : state.rows;}
  function setPrepared(ok) {
    state.prepared=ok;
    $('startAnalysisButton').disabled=!ok;
    $('startAnalysisButton').setAttribute('aria-disabled',String(!ok));
    $('navAnalysisButton').disabled=!ok;
    $('analysisLockNote').textContent = ok ? 'データの準備ができています' : 'STEP 1でデータを準備すると利用できます';
    if (!ok) {
      $('statsResults').innerHTML = '<div class="empty-state">データと比較対象を設定すると結果を表示します。</div>';
      $('visualResults').innerHTML = '';
      $('chart').innerHTML = '';
    }
  }
  function showStage(stage) {
    state.stage=stage;
    document.querySelector('.header-actions .reference-link')?.classList.toggle('hidden',stage==='reference');
    $('referenceStage').classList.toggle('hidden',stage!=='reference');
    $('returnAnalysisButton').classList.toggle('hidden',stage!=='reference');
    $('welcomeGuide').classList.toggle('hidden',stage!=='welcome');
    $('stageNavigation').classList.toggle('hidden',stage==='welcome'||stage==='reference');
    $('prepStage').classList.toggle('hidden',stage!=='prep');
    $('analysisStage').classList.toggle('hidden',stage!=='analysis');
    $('navPrepButton').classList.toggle('current',stage==='prep');
    $('navAnalysisButton').classList.toggle('current',stage==='analysis');
    $('navPrepButton').setAttribute('aria-current',stage==='prep'?'step':'false');
    $('navAnalysisButton').setAttribute('aria-current',stage==='analysis'?'step':'false');
    if(stage==='analysis' && !state.prepared) return showStage('prep');
    if(stage==='analysis' && state.headers.length) renderVisual();
    if(stage==='prep')requestAnimationFrame(updatePreparationSummary);
    requestAnimationFrame(() => { const heading = document.querySelector(stage === 'welcome' ? '#welcome-heading' : stage === 'prep' ? '#data-heading' : stage === 'reference' ? '#referenceStage h2' : '#analysisStage h2'); if (heading) { heading.tabIndex = -1; heading.focus({preventScroll:true}); } });
    window.scrollTo(0,0);
    window.SCDI18n?.apply();
  }
  function applyPreparation() {
    try {
      if(!state.workbook || !state.rows.length) throw Error('先にExcelまたはCSVを読み込んでください．');
      const colValues=['timeColumn','phaseColumn','dataColumn'].map(id => $(id).value);
      if(colValues.some(v=>v==='') || new Set(colValues).size!==3) throw Error('時間・フェーズ・測定値を異なる3列から選んでください．');
      const [time,phase,value]=colValues.map(Number);
      const first=(state.prepRange?.start ?? 0)+2,last=(state.prepRange?.end ?? state.rows.length-1)+2;
      if(!Number.isInteger(first)||!Number.isInteger(last)||first<2||last<first||last>state.rows.length+1)throw Error('表から有効な測定範囲を選択してください。');
      const subset=state.rows.slice(first-2,last-1);
      if(!subset.some(r=>C.isFiniteNumber(r[time]) && C.isFiniteNumber(r[value]))) throw Error('時間列と測定値列には数値データが必要です．');
      if(!subset.some(r=>String(r[phase]??'').trim()))throw Error('フェーズ列が空です．');
      validatePreparation();
      state.analysisRange={start:first-2,end:last-2};
      state.slots=newSlots();
      renderSlots();
      setPrepared(true);
      $('analysisDatasetSummary').textContent=state.fileName+' ／ '+state.headers[value]+' ／ '+first+'〜'+last+'行（'+subset.length+'行）';
      $('preparationFeedback').textContent='解析データを設定しました：'+subset.length+'行．';
      $('preparationFeedback').className='prep-feedback';
      showStage('analysis');
      autoRegisterPhases();
      refreshStats();
    } catch(e) {
      $('preparationFeedback').textContent=e.message;
      $('preparationFeedback').className='prep-feedback error';
      setPrepared(false);
    }
  }
  function autoRegisterPhases() {
    const out=$('autoRegistrationFeedback');
    try {
      if(!state.analysisRange) throw Error('先にデータを準備してください．');
      const phaseCol=Number($('phaseColumn').value),dataCol=Number($('dataColumn').value);
      const rows=selectedRows(),phases=splitPhases(rows.map(r=>r[phaseCol]));
      if(phases.length<2)throw Error('2フェーズ以上のデータが必要です．');

      const slots=newSlots();
      for(const [i,p] of phases.entries()){
        if(p.raw==='(欠損)')throw Error('フェーズ列に欠損があります．');
        const timeCol=Number($('timeColumn').value);
        const values=rows.slice(p.start,p.end+1).map(r=>C.isFiniteNumber(r[timeCol])?r[dataCol]:null),clean=C.cleanNumeric(values);
        if(!clean.values.length)throw Error(p.label+'には数値データがありません．');
        const letter=C.columnNumberToLetters(dataCol+1);
        slots[i]={name:p.label,range:letter+(p.start+state.analysisRange.start+2)+':'+letter+(p.end+state.analysisRange.start+2),values,excluded:clean.excludedCount};
      }
      state.slots=slots;
      renderSlots();
      const comparisons = [...document.querySelectorAll('#comparisonChecks input:not(:disabled)')];
      comparisons.forEach((input,i)=>{input.checked=i<2;});
      refreshStats();
      setStatus('statsStatus',phases.length+'フェーズ登録済み','success');
      out.textContent='自動登録：'+phases.map(p=>p.label).join(' → ')+'．比較する2フェーズを選んでください．';
      out.className='auto-registration-feedback';
    }catch(e){out.textContent=e.message;out.className='auto-registration-feedback error';}
  }
  const methodHelp = {
    ols: ['各フェーズの測定値の増減を直線で表します。','数値の時間列と測定値がある時系列に使います。','傾きの符号と大きさを確認します。外れ値の影響を受けます。'],
    theil: ['点の組み合わせの傾きの中央値で傾向を表します。','外れ値の影響を抑えて傾向を確認したい時系列に使います。','傾きとデータの散らばりを併せて確認します。同一時間のペアは除外します。'],
    twoSD: ['A期の平均±2標準偏差を超えるB期の点を数えます。','A期に複数の測定値があり、水準が安定したデータで確認します。','改善側の境界超過割合を見ます。傾向や自己相関が強い場合は解釈に注意します。'],
    celeration: ['A期の前半・後半の中央値を結ぶ線をB期へ延長します。','時間順のA期とB期の傾向を比較します。','改善側の点数と片側二項検定を確認します。線上の同値は検定から除外します。'],
    vaior: ['A期の傾向と変動幅からB期の変化を確認します。','連続したA期とB期の時系列に使います。','即時・遅延・全体の結果を見ます。B期が3点未満なら一部は判定できません。'],
    pnd: ['A期の改善側の最良値を超えたB期の割合です。','比較する2フェーズの数値データに使います。','高いほど改善側の非重複が多い指標です。A期の極端な値に影響され、同値は改善に含めません。'],
    nap: ['A期とB期の全ペアを比較した改善側の割合です。','比較する2フェーズの数値データに使います。','0.5は方向差なし、1はすべて改善側です。同値は0.5点とし、信頼区間とP値の推論上の制約も確認します。'],
    tau: ['全ペアの改善側と逆側の差を表します。','比較する2フェーズの数値データに使います。','正は改善側、負は逆方向です。Tau = 2×NAP−1で、A期の傾向は補正しません。'],
    tauU: ['A–B間の変化をA期内の傾向で補正します。','A期の測定順を保持した2フェーズに使います。','補正前のTauと併せて見ます。CI・P値は近似で、独立性などの仮定に制約があります。']
  };
  function helpHtml(method, section) {
    return '<div class="method-explanation">' + methodHelp[method].map((t,i)=>'<p><strong>'+['評価すること','使えるデータ','見方・注意点'][i]+'</strong>'+escapeHtml(t)+'</p>').join('')+'<a href="reference.html#'+section+'">詳しく見る・計算式と参考文献 ↗</a></div>';
  }
  function describeMethod() { $('visualMethodHelp').innerHTML=helpHtml($('visualMethod').value,'visual-reference'); }
  function validatePreparation() {
    const cols=['timeColumn','phaseColumn','dataColumn'].map(id=>$(id).value);
    if (!state.rows.length) throw Error('先にファイルを読み込んでください。');
    if(cols.some(v=>v==='') || new Set(cols).size!==3) throw Error('①介入数・②フェーズ・③測定値には、それぞれ異なる列を選択してください。');
    const first=(state.prepRange?.start ?? 0)+2,last=(state.prepRange?.end ?? state.rows.length-1)+2;
    if(!Number.isInteger(first)||!Number.isInteger(last)||first<2||last<first||last>state.rows.length+1) throw Error('表から有効な測定範囲を選択してください。');
    const rows=state.rows.slice(first-2,last-1),[time,phase,value]=cols.map(Number);
    const valid=rows.filter(r=>C.isFiniteNumber(r[time])&&C.isFiniteNumber(r[value])).length;
    if(!valid) throw Error('同じ行に数値の時間と測定値が必要です。列と行範囲を確認してください。');
    if(!rows.some(r=>String(r[phase]??'').trim())) throw Error('フェーズ列が空です。列を選び直してください。');
    return {rows,valid,first,last,cols:cols.map(Number),phases:splitPhases(rows.map(r=>r[phase]))};
  }
  function updatePreparationSummary() {
    try {
      const d=validatePreparation(),[timeCol,phaseCol,valueCol]=d.cols;
      const phases=splitPhases(d.rows.map(r=>r[phaseCol]));
      phases.forEach(p=>{p.points=p.indices.map(i=>({x:C.toNumber(d.rows[i][timeCol]),y:C.toNumber(d.rows[i][valueCol])})).filter(p=>p.x!==null&&p.y!==null);});
      const all=C.descriptiveStats(phases.flatMap(p=>p.points.map(pt=>pt.y)));
      const sessionCount=d.rows.filter(r=>C.isFiniteNumber(r[timeCol])).length;
      const statRow=(name,stats)=>`<tr><th scope="row" data-i18n-skip>${escapeHtml(name)}</th><td>${stats.n}</td><td>${fmt(stats.mean,3)} ± ${fmt(stats.sd,3)}</td><td>${fmt(stats.median,3)} <small>(${fmt(stats.min,3)}, ${fmt(stats.max,3)})</small></td></tr>`;
      $('preparationSummary').innerHTML=`<div class="prep-metrics"><div><span>${T('選択した回数')}</span><strong>${sessionCount}</strong></div><div><span>${T('有効な測定値')}</span><strong>${d.valid}</strong></div><div><span>${T('欠損・非数値')}</span><strong>${d.rows.length-d.valid}</strong></div></div><h4>${T('全体と各フェーズの記述統計')}</h4><div class="table-scroll"><table class="prep-stat-table"><thead><tr><th>${T('対象')}</th><th>n</th><th>${T('平均値 ± SD')}</th><th>${T('中央値 (最小値, 最大値)')}</th></tr></thead><tbody>${statRow(T('全データ'),all)}${phases.map(p=>statRow(p.label,C.descriptiveStats(p.points.map(pt=>pt.y)))).join('')}</tbody></table></div><p class="result-note">${T('回数は①の数値がある測定行を数えています。SDは標本標準偏差です。欠損・非数値の行は解析から除外します。')}</p>`;
      $('prepChartCaption').textContent=state.headers[valueCol];
      const traces=phases.map((p,i)=>({x:p.points.map(pt=>pt.x),y:p.points.map(pt=>pt.y),name:p.label,type:'scatter',mode:'lines+markers',line:{color:defaultPhaseColor(p,i),width:2.5},marker:{size:17},connectgaps:false}));
      const shapes=phases.slice(1).flatMap((p,i)=>{const left=phases[i].points.at(-1),right=p.points[0];return left&&right?[{type:'line',x0:(left.x+right.x)/2,x1:(left.x+right.x)/2,y0:0,y1:1,yref:'paper',line:{color:'#bccfc3',dash:'dot',width:1}}]:[];});
      $('prepChart').querySelector('.empty-state')?.remove();
      if(typeof Plotly!=='undefined')Plotly.react('prepChart',traces,{margin:{l:50,r:18,t:35,b:48},font:{family:'Arial, "Noto Sans JP", sans-serif',color:'#38594a'},paper_bgcolor:'#ffffff',plot_bgcolor:'#ffffff',xaxis:{title:{text:state.headers[timeCol]},gridcolor:'#edf2ed',zeroline:false},yaxis:{title:{text:state.headers[valueCol]},gridcolor:'#edf2ed',zeroline:false},legend:{orientation:'h',y:1.15},shapes},{responsive:true,displayModeBar:false});
      $('applyPreparationButton').disabled=false;
      $('prepValidation').textContent=T('グラフとデータを確認したら、解析へ進みましょう。');
      roleIds.forEach((id,i)=>{const letter=C.columnNumberToLetters(Number($(id).value)+1);$(['timeRange','phaseRange','valueRange'][i]).textContent=`${letter}${d.first}:${letter}${d.last}`;});
      updateSelectionHighlight();
    } catch(e) {
      $('preparationSummary').innerHTML='';
      if(typeof Plotly!=='undefined')Plotly.purge('prepChart');
      $('prepChart').innerHTML='<div class="empty-state">'+T('①〜③を設定すると、グラフと記述統計が表示されます。')+'</div>';
      $('prepValidation').textContent=T(e.message);$('applyPreparationButton').disabled=true;
    }
    window.SCDI18n?.apply();
  }
  async function showReference(href='reference.html') {
    try {
      if(!$('referenceStage').children.length) {
        const response=await fetch('reference.html');if(!response.ok)throw Error(T('手法の解説を読み込めませんでした。'));
        const page=new DOMParser().parseFromString(await response.text(),'text/html');
        state.referenceJa=page.querySelector('main').innerHTML;
        state.referenceEn=page.querySelector('#englishReference').innerHTML;
        $('referenceStage').innerHTML=window.SCDI18n?.language==='en'?state.referenceEn:state.referenceJa;
      }
      showStage('reference');
      const fragment=href.split('#')[1];if(fragment)requestAnimationFrame(()=>$(fragment)?.scrollIntoView());
    } catch(e){window.location.assign(href);}
  }

  function refreshStats() {
    renderStatsDefinition();
    const count=document.querySelectorAll('#comparisonChecks input:checked').length;
    if(state.prepared && count===2) calculateStats();
    else $('statsResults').innerHTML='<div class="empty-state">比較する2フェーズを選んでください。</div>';
  }

  function initializeEvents() {
    $('fileInput').addEventListener('change', event => { const file = event.target.files[0]; if (file) handleFile(file); });
    $('customDataButton').addEventListener('click',()=>{showStage('prep');$('fileInput').click();});
    $('startPrepButton').addEventListener('click',()=>showStage('prep'));
    $('startAnalysisButton').addEventListener('click',()=>{if(state.prepared)showStage('analysis');});
    $('navPrepButton').addEventListener('click',()=>showStage('prep'));
    $('navAnalysisButton').addEventListener('click',()=>{if(state.prepared)showStage('analysis');});
    $('editPreparationButton').addEventListener('click',()=>showStage('prep'));
    $('applyPreparationButton').addEventListener('click',applyPreparation);
    document.querySelectorAll('[data-pick-role]').forEach(button=>button.addEventListener('click',()=>startSelection(button.dataset.pickRole)));
    $('selectAllRowsButton').addEventListener('click',()=>{state.prepRange={start:0,end:state.rows.length-1};cancelSelection();setPrepared(false);updatePreparationSummary();});
    $('autoRegisterPhasesButton').addEventListener('click',autoRegisterPhases);
    ['visualBaseline','visualIntervention'].forEach(id=>$(id).addEventListener('change',renderVisual));
    ['timeColumn','phaseColumn','dataColumn'].forEach(id=>$(id).addEventListener('input',()=>{setPrepared(false);updatePreparationSummary();$('preparationFeedback').textContent='変更した設定を反映するには「このデータで解析へ進む」を押してください．';}));
    $('sheetSelect').addEventListener('change', event => loadSheet(event.target.value));

    document.addEventListener('pointerup',()=>{if(state.dragging)commitSelection();});
    document.addEventListener('pointercancel',cancelSelection);
    $('dataGridWrap').addEventListener('pointermove',e=>{
      if(!state.dragging)return;
      const wrap=$('dataGridWrap'),rect=wrap.getBoundingClientRect();
      if(e.clientY>rect.bottom-28)wrap.scrollTop+=24;
      if(e.clientY<rect.top+60)wrap.scrollTop-=24;
      const cell=document.elementFromPoint(Math.max(rect.left+45,Math.min(e.clientX,rect.right-15)),Math.max(rect.top+65,Math.min(e.clientY,rect.bottom-8)))?.closest('td[data-row]');
      if(cell&&wrap.contains(cell)){
        if(state.movingRange){const r=state.movingRange,len=r.end-r.start;const start=Math.max(0,Math.min(state.rows.length-1-len,r.start+Number(cell.dataset.row)-r.row));const col=Number(cell.dataset.col);setSelection({row:start,col},{row:start+len,col});}
        else setSelection(state.dragAnchor,{row:Number(cell.dataset.row),col:state.dragAnchor.col});
      }
    });
    $('dataGridWrap').addEventListener('keydown',e=>{
      if(!state.activeRole)return;
      if(e.key==='Escape'){e.preventDefault();cancelSelection();return;}
      if(e.key==='Enter'){e.preventDefault();if(!state.selection)setSelection(state.keyboardPoint,state.keyboardPoint);commitSelection();return;}
      const moves={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]};
      if(!moves[e.key])return;e.preventDefault();
      const p=state.keyboardPoint||{row:0,col:0},[dr,dc]=moves[e.key];
      const next={row:Math.max(0,Math.min(state.rows.length-1,p.row+dr)),col:Math.max(0,Math.min(state.headers.length-1,p.col+dc))};
      if(!e.shiftKey)state.dragAnchor={...next};
      setSelection(state.dragAnchor,{row:next.row,col:state.dragAnchor.col});
      $('dataGridWrap').querySelector(`td[data-row="${next.row}"][data-col="${next.col}"]`)?.scrollIntoView({block:'nearest',inline:'nearest'});
    });
    document.addEventListener('click',e=>{
      const link=e.target.closest('a[href]');if(!link)return;
      const href=link.getAttribute('href');
      if(href.startsWith('reference.html')){if(link.closest('.research-methods'))return;e.preventDefault();showReference(href);}
      else if(href==='index.html'){e.preventDefault();showStage(state.prepared?'analysis':'prep');}
    });
    $('returnAnalysisButton').addEventListener('click',()=>showStage(state.prepared?'analysis':'prep'));
    document.addEventListener('scd:language',()=>{
      const lang=window.SCDI18n.language;
      if(state.referenceJa)$('referenceStage').innerHTML=lang==='en'?state.referenceEn:state.referenceJa;
      updatePreparationSummary();describeMethod();renderStatsDefinition();
      if(state.prepared){renderVisual();refreshStats();}
    });

    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(item => {item.classList.toggle('active', item === tab);item.setAttribute('aria-pressed',String(item === tab));});
      document.querySelectorAll('.analysis-panel').forEach(panel => panel.classList.toggle('active', panel.id === tab.dataset.tab));
      const statsActive = tab.dataset.tab === 'statsPanel';
      $('inlineStatsRegistration').classList.toggle('hidden', !statsActive);
      if (tab.dataset.tab === 'visualPanel' && state.headers.length) renderVisual();
    }));

    ['visualMethod', 'visualDirection', 'visualDigits'].forEach(id => $(id).addEventListener('change', renderVisual));
    $('visualMethod').addEventListener('change',describeMethod);
    ['showPoints', 'showLines', 'pointShape', 'showTrend', 'trendColor', 'trendDash', 'showBounds', 'sdColor', 'sdDash', 'vaiorColor', 'vaiorDash', 'showPhaseBoundaries', 'boundaryColor', 'chartFont', 'backgroundColor', 'axisColor', 'showGridLines', 'gridColor', 'yAxisMin', 'yAxisMax', 'yAxisTick'].forEach(id => $(id).addEventListener('input', renderVisual));
    bindDual('pointSizeRange', 'pointSizeNumber');
    bindDual('lineWidthRange', 'lineWidthNumber');
    bindDual('trendWidthRange', 'trendWidthNumber');
    bindDual('sdWidthRange', 'sdWidthNumber');
    bindDual('vaiorWidthRange', 'vaiorWidthNumber');
    bindDual('boundaryWidthRange', 'boundaryWidthNumber');
    $('resetChartButton').addEventListener('click', resetChartSettings);

    $('customizationToggle').addEventListener('change', event => {
      $('customizationBody').classList.toggle('hidden', !event.target.checked);
      event.target.closest('.collapse-toggle').querySelector('span:first-child').textContent = event.target.checked ? '設定を閉じる' : '設定を開く';
    });

    $('statsMethod').addEventListener('change', () => { $('tauCorrection').checked=$('statsMethod').value==='tauU'; refreshStats(); });
    $('statsDirection').addEventListener('change',refreshStats);
    $('tauCorrection').addEventListener('change', refreshStats);
    $('statsDigits').addEventListener('input',refreshStats);
    $('comparisonChecks').addEventListener('change',refreshStats);
    $('dataSlots').addEventListener('change',refreshStats);
    $('homeButton').addEventListener('click',()=>showStage('welcome'));
    const drop=document.querySelector('.file-drop');
    ['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('drag-over');}));
    drop.addEventListener('dragleave',()=>drop.classList.remove('drag-over'));
    drop.addEventListener('drop',e=>{e.preventDefault();drop.classList.remove('drag-over');if(e.dataTransfer.files[0])handleFile(e.dataTransfer.files[0]);});
    $('calculateStatsButton').addEventListener('click', calculateStats);

    $('openDownloadDialogButton').addEventListener('click', openDownloadDialog);
    $('cancelDownloadButton').addEventListener('click', closeDownloadDialog);
    $('cancelDownloadFooterButton').addEventListener('click', closeDownloadDialog);
    $('downloadFormat').addEventListener('change', () => {
      const editable = $('downloadFormat').value === 'pptx';
      ['downloadWidth','downloadHeight','downloadAspect'].forEach(id => { $(id).disabled = editable; });
    });
    $('confirmDownloadButton').addEventListener('click', downloadChart);
    $('downloadWidth').addEventListener('input', () => syncDownloadDimension('width'));
    $('downloadHeight').addEventListener('input', () => syncDownloadDimension('height'));
    $('downloadDialog').addEventListener('click', event => {
      if (event.target === $('downloadDialog')) closeDownloadDialog();
    });
  }

  document.querySelectorAll('.dual-control').forEach(group=>{const label=group.querySelector('label'),number=group.querySelector('input[type=number]');if(label && number)number.setAttribute('aria-label',label.textContent.trim()+'（数値入力）');});
  initializeEvents();
  renderSlots();
  renderStatsDefinition();
  describeMethod();
  showStage(location.hash==='#analysis'?'prep':'welcome');
})();
