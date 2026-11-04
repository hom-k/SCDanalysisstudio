'use strict';
// Integration checks run the real UI functions with a small DOM adapter.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const C = require('../js/core.js');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    value: '', textContent: '', innerHTML: '', disabled: false, checked: false,
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {}, querySelector() { return null; }, setAttribute() {}, querySelectorAll() { return []; }, addEventListener() {}
  });
  return elements.get(id);
}
const checked = [{ value: '0' }, { value: '1' }];
const document = {
  getElementById: element,
  querySelectorAll: selector => selector === '#comparisonChecks input:checked' ? checked : [],
};
const context = vm.createContext({ window: { SCDCore: C }, document });
let source = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const start = source.lastIndexOf('  initializeEvents();');
assert(start > 0);
source = source.slice(0, start) + `window.test = { state, getVisualDataset, selectedRows,
  validatePreparation, calculateStats, setPrepared, registerSlot, splitPhases, commitSelection };\n})();`;
vm.runInContext(source, context);
const api = context.window.test;
let passed = 0;
function run(name, fn) {
  fn(); passed++;
  console.log('✓ ' + name);
}
Object.assign(api.state, {
  headers: ['Day', 'Phase', 'Outcome'],
  rows: [[1,'A',999],[2,'A',10],[3,'A',12],[4,'B',5],[5,'B',4],[6,'B',-999]],
  analysisRange: { start: 1, end: 4 }, prepRange: {start:1,end:4}, prepared: true
});
for (const [id, value] of Object.entries({ timeColumn:'0',phaseColumn:'1',dataColumn:'2',statsDigits:'3',statsDirection:'lower',statsMethod:'pnd' })) element(id).value=value;
run('Excel 3〜6行を両端を含む4測定点として抽出', () => {
  assert.strictEqual(api.selectedRows().length,4);
  assert.strictEqual(api.selectedRows()[0][2],10);
  assert.strictEqual(api.selectedRows()[3][2],4);
});
run('視覚分析に範囲外の±999が混入しない', () => {
  const d=api.getVisualDataset();
  const ys=d.phases.flatMap(p=>p.y);
  assert.strictEqual(ys.length,4);
  assert.strictEqual(Math.max(...ys),12);
  assert.strictEqual(Math.min(...ys),4);
  assert.strictEqual(C.descriptiveStats(ys).mean,7.75);
});
run('範囲内の連続フェーズを保持', () => {
  const d=api.getVisualDataset();
  assert.strictEqual(d.phases.map(p=>p.label).join(','),'A1,B1');
});
run('同一列への重複割当を拒否', () => {
  element('dataColumn').value='0';
  assert.throws(()=>api.validatePreparation(),/異なる列/);
  element('dataColumn').value='2';
});
run('空の列選択を0列と誤認しない', () => {
  element('timeColumn').value='';
  assert.throws(()=>api.getVisualDataset(),/異なる列/);
  element('timeColumn').value='0';
});
run('逆順・小数・上限外の行範囲を拒否', () => {
  for (const [first,last] of [[6,3],[2.5,6],[2,8],[1,6]]) {
    api.state.prepRange={start:first-2,end:last-2};
    assert.throws(()=>api.validatePreparation(),/測定範囲/);
  }
  api.state.prepRange={start:1,end:4};
});
run('時間または測定値が欠損した点を視覚分析から除外', () => {
  api.state.rows[1][0]=null;
  assert.strictEqual(api.getVisualDataset().phases.flatMap(p=>p.y).length,3);
  assert.strictEqual(api.validatePreparation().valid,3);
  api.state.rows[1][0]=2;
});
api.state.slots=[{name:'A1',range:'C3:C4',values:[10,12],excluded:0},{name:'B1',range:'C5:C6',values:[5,4],excluded:0}];
run('UIのdirection引数が4統計指標に反映される', () => {
  for (const method of ['pnd','nap','tau','tauU']) {
    element('statsMethod').value=method; element('tauCorrection').checked=method==='tauU';
    element('statsDirection').value='lower';api.calculateStats();
    const lower=element('statsResults').innerHTML;
    assert(lower.includes('key-result'),method);
    element('statsDirection').value='higher';api.calculateStats();
    assert.notStrictEqual(element('statsResults').innerHTML,lower,method);
  }
});
run('低値改善のPNDではA期最小値を表示', () => {
  element('statsMethod').value='pnd';element('statsDirection').value='lower';api.calculateStats();
  assert(element('statsResults').innerHTML.includes('A期最小値'));
  assert(element('statsResults').innerHTML.includes('100.000％'));
});
run('低値改善のペアラベルをHTMLとして誤解釈しない', () => {
  element('statsMethod').value='tau';api.calculateStats();
  assert(element('statsResults').innerHTML.includes('B&lt;A 4'));
});
run('手動統計範囲が準備した行範囲外なら登録を拒否', () => {
  api.registerSlot(0,'C2:C4');
  assert(element('statsValidation').textContent.includes('準備画面で指定した行範囲内'));
  assert.strictEqual(api.state.slots[0].range,'C3:C4');
});
run('データ再設定時に古い結果と解析への導線を無効化', () => {
  api.setPrepared(false);
  assert.strictEqual(api.state.prepared,false);
  assert.strictEqual(element('navAnalysisButton').disabled,true);
  assert(!element('statsResults').innerHTML.includes('key-result'));
});
run('番号付きフェーズ名を二重採番しない', () => {
  assert.strictEqual(api.splitPhases(['A1','A1','B1','B1','A2','B2']).map(p=>p.label).join(','),'A1,B1,A2,B2');
});
run('表選択した列と共通行範囲を確定して旧解析を無効化', () => {
  api.state.activeRole='dataColumn';api.state.selection={startRow:2,endRow:4,startCol:2,endCol:2};
  api.commitSelection();
  assert.strictEqual(api.state.prepRange.start,2);assert.strictEqual(api.state.prepRange.end,4);
  assert.strictEqual(element('dataColumn').value,'2');assert.strictEqual(api.state.activeRole,null);
  assert.strictEqual(api.state.prepared,false);
});
console.log(`All ${passed} workflow tests passed.`);
