'use strict';
const assert = require('assert');
const C = require('../js/core.js');
const almost = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Number.isFinite(actual), `actual is not finite: ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};
let passed = 0;
function run(name, fn) {
  try { fn(); passed += 1; console.log(`✓ ${name}`); }
  catch (error) { console.error(`✗ ${name}\n  ${error.stack}`); process.exitCode = 1; }
}

run('連続フェーズをA1, B1, A2, B2に分割', () => {
  const phases = C.splitConsecutivePhases(['A','A','A','B','B','B','A','A','A','B','B','B']);
  assert.deepStrictEqual(phases.map(p => p.label), ['A1','B1','A2','B2']);
  assert.deepStrictEqual(phases.map(p => [p.start,p.end]), [[0,2],[3,5],[6,8],[9,11]]);
});

run('同じフェーズ記号でも非連続なら別フェーズとして数える', () => {
  const phases = C.splitConsecutivePhases(['A','A','B','A','C','A']);
  assert.deepStrictEqual(phases.map(p => p.label), ['A1','B1','A2','C1','A3']);
});

run('記述統計量は標本標準偏差（n−1）を使用', () => {
  const r = C.descriptiveStats([1,2,3,4]);
  almost(r.mean, 2.5); almost(r.median, 2.5); almost(r.sd, Math.sqrt(5 / 3));
  assert.strictEqual(r.min, 1); assert.strictEqual(r.max, 4); assert.strictEqual(r.n, 4);
});

run('最小二乗法 y=2x+1', () => {
  const r = C.linearRegression([1,2,3,4],[3,5,7,9]);
  almost(r.slope,2); almost(r.intercept,1); almost(r.predict(5),11);
});

run('最小二乗法はXがすべて同じ場合に計算不能とする', () => {
  assert.throws(() => C.linearRegression([1,1,1],[2,3,4]), /X値がすべて同一/);
});

run('Theil–Sen y=2x+1（同一Xペアを除外）', () => {
  const r = C.theilSen([1,2,3,3],[3,5,7,7]);
  almost(r.slope,2); almost(r.intercept,1); assert.strictEqual(r.excludedSameX,1);
});

run('Celeration Lineの奇数データは中央点を両群に含む', () => {
  const r = C.celerationLine([1,2,3,4,5],[2,4,6,8,10]);
  assert.deepStrictEqual(r.firstPoint,{x:2,y:4});
  assert.deepStrictEqual(r.secondPoint,{x:4,y:8});
  almost(r.slope,2); almost(r.intercept,0);
});

run('Celeration Lineの偶数データは同数に二分する', () => {
  const r = C.celerationLine([1,2,3,4],[2,4,6,8]);
  assert.deepStrictEqual(r.firstPoint,{x:1.5,y:3});
  assert.deepStrictEqual(r.secondPoint,{x:3.5,y:7});
  almost(r.slope,2); almost(r.intercept,0);
});


run('Celeration Line：A期の線をB期へ延長し片側二項検定を行う', () => {
  const r = C.celerationABAnalysis([1,2,3,4],[2,4,6,8],[5,6,7,8,9],[11,13,15,17,19],'higher');
  almost(r.slope,2); almost(r.intercept,0);
  assert.strictEqual(r.improvedCount,5); assert.strictEqual(r.oppositeCount,0); assert.strictEqual(r.tiedCount,0);
  almost(r.pValue,0.03125); assert.strictEqual(r.effective,true);
});

run('Celeration Line：予測線上の同値は二項検定から除外', () => {
  const r = C.celerationABAnalysis([1,2,3,4],[2,4,6,8],[5,6,7],[10,13,13],'higher');
  assert.strictEqual(r.improvedCount,1); assert.strictEqual(r.oppositeCount,1); assert.strictEqual(r.tiedCount,1); assert.strictEqual(r.testN,2);
  almost(r.pValue,0.75); assert.strictEqual(r.effective,false);
});
run('2SD法：ベースライン平均±2標本SDの水平帯を介入期へ延長', () => {
  const r = C.twoSDAnalysis([1,2,3],[2,4,6],[4,5],[-1,13],'lower');
  almost(r.baselineMean,4); almost(r.sd,2); almost(r.twoSD,4);
  almost(r.lower,0); almost(r.upper,8); almost(r.projected[0].trend,4);
  assert.deepStrictEqual(r.improvedFlags,[true,false]);
});

run('2SD法：境界線と同値の点は境界超過に含めない', () => {
  const r = C.twoSDAnalysis([1,2,3],[2,4,6],[4],[0],'lower');
  assert.strictEqual(r.improvedCount,0);
});

run('VAIOR：即時・遅延・全体効果を検出', () => {
  const r = C.vaiorAnalysis([1,2,3,4],[10,10,10,10],[5,6,7,8],[5,4,3,2],'lower');
  almost(r.mad,0); assert.strictEqual(r.immediate.status,'effective');
  assert.strictEqual(r.delayed.status,'effective'); assert.strictEqual(r.overall.status,'effective');
});

run('VAIOR：介入期3点未満では即時・遅延効果を判定不能とする', () => {
  const r = C.vaiorAnalysis([1,2,3,4],[10,10,10,10],[5,6],[5,4],'lower');
  assert.strictEqual(r.immediate.status,'indeterminate');
  assert.strictEqual(r.delayed.status,'indeterminate');
});

run('PND：同値を改善に含めない', () => {
  const r = C.pnd([10,9,8],[8,7,6],'lower');
  assert.strictEqual(r.bestBaseline,8); assert.strictEqual(r.improvedCount,2); almost(r.pnd,2/3);
});

run('PND：高値改善と低値改善を反転すると対応した結果になる', () => {
  almost(C.pnd([1,2,3],[4,3,2],'higher').pnd,1/3);
  almost(C.pnd([-1,-2,-3],[-4,-3,-2],'lower').pnd,1/3);
});

run('NAP：完全改善は1，完全悪化は0', () => {
  almost(C.nap([10,11],[1,2],'lower').nap,1);
  almost(C.nap([10,11],[12,13],'lower').nap,0);
});

run('NAP：同値は0.5', () => {
  const r = C.nap([1],[1],'higher');
  almost(r.nap,0.5); assert.strictEqual(r.tied,1);
});

run('NAP：SingleCaseES既知例の点推定・不偏SE・Newcombe信頼区間と一致', () => {
  const r = C.nap([20,20,26,25,22,23],[28,25,24,27,30,30,29],'higher');
  almost(r.nap, 0.9166666666666666);
  almost(r.se, 0.06900655593423538);
  almost(r.ci90.lower, 0.6591091902344411, 1e-9);
  almost(r.ci90.upper, 0.9822247870934007, 1e-9);
  almost(r.ci95.lower, 0.5973193600384168, 1e-9);
  almost(r.ci95.upper, 0.9859976893703788, 1e-9);
});

run('NAP：0または1でもNewcombe信頼区間が0～1内に収まる', () => {
  const ci0 = C.newcombeNAPCI(0,4,5,0.95);
  const ci1 = C.newcombeNAPCI(1,4,5,0.95);
  assert.ok(ci0.lower === 0 && ci0.upper > 0 && ci0.upper < 1);
  assert.ok(ci1.upper === 1 && ci1.lower > 0 && ci1.lower < 1);
});

run('Tau：Tau=2×NAP−1，SE・CIも線形変換', () => {
  const A=[20,20,26,25,22,23], B=[28,25,24,27,30,30,29];
  const n=C.nap(A,B,'higher'); const t=C.tau(A,B,'higher');
  almost(t.tau,2*n.nap-1); almost(t.se,2*n.se);
  almost(t.ci95.lower,2*n.ci95.lower-1); almost(t.ci95.upper,2*n.ci95.upper-1);
});

run('Tau：Parkerらの手計算例でS=16，20ペア，Tau=0.80', () => {
  const r=C.tau([2,3,5,3],[4,5,5,7,6],'higher');
  assert.strictEqual(r.score,16); assert.strictEqual(r.pairs,20); almost(r.tau,0.8);
  almost(r.pValue,0.0453127388,1e-7);
});

run('Tau：改善方向を反転すると符号も反転する', () => {
  almost(C.tau([10,11],[1,2],'lower').tau,1);
  almost(C.tau([10,11],[1,2],'higher').tau,-1);
});

run('Tau-U：補正なしはA–B Tauと一致', () => {
  const r = C.tauU([3,2,1],[0,-1,-2],'lower',{correctBaseline:false});
  almost(r.tauU,r.tauAB); assert.strictEqual(r.corrected,false);
});

run('Tau-U：SingleCaseES既知例で(S_AB−S_A)/(nA×nB)=0.738095...', () => {
  const r=C.tauU([20,20,26,25,22,23],[28,25,24,27,30,30,29],'higher',{correctBaseline:true});
  assert.strictEqual(r.cross.score,35); assert.strictEqual(r.trend.score,4);
  assert.strictEqual(r.denominator,42); almost(r.tauU,31/42);
});

run('Tau-U：ベースライン補正用のKendall S分散を既知の符号化で再現', () => {
  const r=C.tauU([2,3,5,3],[4,5,5,7,6],'higher',{correctBaseline:true});
  assert.strictEqual(r.cross.score,16); assert.strictEqual(r.trend.score,3);
  almost(r.tauU,13/20); almost(r.varianceS,71.85714285714286,1e-10);
});

run('効果量の目安は境界値どおりに分類する', () => {
  assert.strictEqual(C.interpretPND(0.49),'効果なしの目安');
  assert.strictEqual(C.interpretPND(0.50),'判断保留の目安');
  assert.strictEqual(C.interpretPND(0.70),'効果ありの目安');
  assert.strictEqual(C.interpretPND(0.90),'非常に大きい効果の目安');
  assert.strictEqual(C.interpretNAP(0.49),'B期が低い方向');
  assert.strictEqual(C.interpretNAP(0.50),'方向差なしの目安');
  assert.strictEqual(C.interpretNAP(0.66),'B期が高い方向（中程度の変化）');
  assert.strictEqual(C.interpretNAP(0.93),'B期が高い方向（強い変化）');
  assert.strictEqual(C.interpretTau(0.19),'B期が高い方向（小さい変化）');
  assert.strictEqual(C.interpretTau(0.20),'B期が高い方向（中程度変化）');
  assert.strictEqual(C.interpretTau(0.60),'B期が高い方向（大きい変化）');
  assert.strictEqual(C.interpretTau(0.80),'B期が高い方向（非常に大きい変化）');
  assert.strictEqual(C.interpretTau(-0.60),'B期が低い方向（大きい変化）');
});

run('欠損値・非数値値を除外', () => {
  const r = C.pnd([10,null,'x',9],[8,'',7],'lower');
  assert.strictEqual(r.excludedBaseline,2); assert.strictEqual(r.excludedIntervention,1); almost(r.pnd,1);
});

run('A1セル範囲を0始まりのデータ座標へ変換', () => {
  const r = C.parseA1Range('C2:C6');
  assert.deepStrictEqual(r,{startCol:2,endCol:2,startRow:0,endRow:4,normalized:'C2:C6'});
});

if (!process.exitCode) console.log(`\nAll ${passed} tests passed.`);
