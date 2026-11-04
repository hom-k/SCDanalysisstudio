(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SCDCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-12;

  function isFiniteNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value !== 'string' || value.trim() === '') return false;
    return Number.isFinite(Number(value));
  }

  function toNumber(value) {
    return isFiniteNumber(value) ? Number(value) : null;
  }

  function cleanNumeric(values) {
    const cleaned = [];
    const excluded = [];
    values.forEach((value, index) => {
      const number = toNumber(value);
      if (number === null) excluded.push({ index, value });
      else cleaned.push(number);
    });
    return { values: cleaned, excluded, excludedCount: excluded.length };
  }

  function sum(values) {
    return values.reduce((acc, value) => acc + value, 0);
  }

  function mean(values) {
    if (!values.length) return null;
    return sum(values) / values.length;
  }

  function median(values) {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function sampleSD(values) {
    if (values.length < 2) return null;
    const avg = mean(values);
    const variance = sum(values.map(value => (value - avg) ** 2)) / (values.length - 1);
    return Math.sqrt(variance);
  }

  function descriptiveStats(values) {
    const cleaned = cleanNumeric(values);
    if (!cleaned.values.length) {
      return { n: 0, excludedCount: cleaned.excludedCount, mean: null, sd: null, median: null, max: null, min: null };
    }
    return {
      n: cleaned.values.length,
      excludedCount: cleaned.excludedCount,
      mean: mean(cleaned.values),
      sd: sampleSD(cleaned.values),
      median: median(cleaned.values),
      max: Math.max(...cleaned.values),
      min: Math.min(...cleaned.values)
    };
  }

  // Ordinary least squares: slope = Σ[(x-x̄)(y-ȳ)] / Σ[(x-x̄)²], intercept = ȳ - slope×x̄.
  function linearRegression(x, y) {
    if (x.length !== y.length) throw new Error('XとYのデータ数が一致していません．');
    if (x.length < 2) throw new Error('最小二乗法には2点以上の数値データが必要です．');
    const xMean = mean(x);
    const yMean = mean(y);
    const sxx = sum(x.map(value => (value - xMean) ** 2));
    if (Math.abs(sxx) < EPS) throw new Error('X値がすべて同一のため，傾きを算出できません．');
    const sxy = sum(x.map((value, index) => (value - xMean) * (y[index] - yMean)));
    const slope = sxy / sxx;
    const intercept = yMean - slope * xMean;
    return { slope, intercept, predict: value => slope * value + intercept };
  }

  // Theil–Sen: median of all pairwise slopes with unequal X; intercept is median(y - slope×x).
  function theilSen(x, y) {
    if (x.length !== y.length) throw new Error('XとYのデータ数が一致していません．');
    if (x.length < 2) throw new Error('Theil–Sen法には2点以上の数値データが必要です．');
    const slopes = [];
    let excludedSameX = 0;
    for (let i = 0; i < x.length - 1; i += 1) {
      for (let j = i + 1; j < x.length; j += 1) {
        const dx = x[j] - x[i];
        if (Math.abs(dx) < EPS) {
          excludedSameX += 1;
          continue;
        }
        slopes.push((y[j] - y[i]) / dx);
      }
    }
    if (!slopes.length) throw new Error('異なるX値の組み合わせがないため，Theil–Sen傾きを算出できません．');
    const slope = median(slopes);
    const intercept = median(y.map((value, index) => value - slope * x[index]));
    return { slope, intercept, pairCount: slopes.length, excludedSameX, predict: value => slope * value + intercept };
  }

  // Split-middle celeration line: connect the median coordinate of the first and second halves.
  // For odd n, the center observation is deliberately included in both halves.
  function celerationLine(x, y) {
    if (x.length !== y.length) throw new Error('XとYのデータ数が一致していません．');
    if (x.length < 2) throw new Error('Celeration Lineには2点以上のデータが必要です．');
    const n = x.length;
    const half = Math.floor(n / 2);
    const firstEnd = n % 2 ? half + 1 : half;
    const secondStart = n % 2 ? half : half;
    const firstX = x.slice(0, firstEnd);
    const firstY = y.slice(0, firstEnd);
    const secondX = x.slice(secondStart);
    const secondY = y.slice(secondStart);
    const firstPoint = { x: median(firstX), y: median(firstY) };
    const secondPoint = { x: median(secondX), y: median(secondY) };
    if (Math.abs(secondPoint.x - firstPoint.x) < EPS) throw new Error('前半と後半のX中央値が同一のため，傾きを算出できません．');
    const slope = (secondPoint.y - firstPoint.y) / (secondPoint.x - firstPoint.x);
    const intercept = firstPoint.y - slope * firstPoint.x;
    return { firstPoint, secondPoint, slope, intercept, predict: value => slope * value + intercept };
  }

  function binomialUpperTail(successes, trials, probability = 0.5) {
    if (!Number.isInteger(successes) || !Number.isInteger(trials) || successes < 0 || trials < 0 || successes > trials) {
      throw new Error('二項検定の成功数と試行数が不正です．');
    }
    if (!(probability >= 0 && probability <= 1)) throw new Error('二項検定の確率は0から1の範囲で指定してください．');
    if (trials === 0) return 1;
    if (probability === 0) return successes === 0 ? 1 : 0;
    if (probability === 1) return 1;
    let term = (1 - probability) ** trials;
    let tail = 0;
    for (let k = 0; k <= trials; k += 1) {
      if (k >= successes) tail += term;
      if (k < trials) term *= ((trials - k) / (k + 1)) * (probability / (1 - probability));
    }
    return Math.min(1, Math.max(0, tail));
  }

  // Project a baseline split-middle celeration line into the adjacent intervention phase.
  // The exact one-sided binomial test evaluates whether more intervention observations
  // than expected by chance fall beyond the projected line in the selected improvement direction.
  function celerationABAnalysis(baselineX, baselineY, interventionX, interventionY, direction) {
    if (baselineX.length !== baselineY.length) throw new Error('ベースライン期のXとYのデータ数が一致していません．');
    if (interventionX.length !== interventionY.length) throw new Error('介入期のXとYのデータ数が一致していません．');
    if (baselineY.length < 4) throw new Error('Celeration Line分析にはベースライン期の数値データが4点以上必要です．');
    if (interventionY.length < 1) throw new Error('二項検定には介入期の数値データが1点以上必要です．');
    const model = celerationLine(baselineX, baselineY);
    const predicted = interventionX.map(model.predict);
    let improvedCount = 0;
    let oppositeCount = 0;
    let tiedCount = 0;
    const improvedFlags = interventionY.map((value, index) => {
      const difference = value - predicted[index];
      if (Math.abs(difference) <= EPS) {
        tiedCount += 1;
        return false;
      }
      const improved = direction === 'lower' ? difference < 0 : difference > 0;
      if (improved) improvedCount += 1;
      else oppositeCount += 1;
      return improved;
    });
    const testN = improvedCount + oppositeCount;
    const pValue = testN ? binomialUpperTail(improvedCount, testN, 0.5) : 1;
    return {
      ...model,
      predicted,
      improvedFlags,
      improvedCount,
      oppositeCount,
      tiedCount,
      interventionN: interventionY.length,
      testN,
      pValue,
      effective: testN > 0 && improvedCount > oppositeCount && pValue < 0.05
    };
  }

  function normalizePhaseValue(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '(欠損)';
    return String(value).trim();
  }

  // Phase segmentation is based on consecutive runs, not global labels (A,A,B,B,A -> A1,B1,A2).
  function splitConsecutivePhases(phaseValues) {
    const phases = [];
    const occurrence = new Map();
    let current = null;
    phaseValues.forEach((rawValue, index) => {
      const raw = normalizePhaseValue(rawValue);
      if (!current || current.raw !== raw) {
        const count = (occurrence.get(raw) || 0) + 1;
        occurrence.set(raw, count);
        current = { raw, label: `${raw}${count}`, start: index, end: index, indices: [index] };
        phases.push(current);
      } else {
        current.end = index;
        current.indices.push(index);
      }
    });
    return phases;
  }

  function pairBaselineIntervention(phases) {
    const pairs = [];
    for (let i = 0; i < phases.length - 1; i += 1) {
      const baseline = phases[i];
      const intervention = phases[i + 1];
      if (/^A/i.test(baseline.raw) && /^B/i.test(intervention.raw)) pairs.push({ baseline, intervention });
    }
    return pairs;
  }

  // Classical 2SD band method: horizontal limits at baseline mean ± 2 sample SD.
  function twoSDAnalysis(baselineX, baselineY, interventionX, interventionY, direction) {
    if (baselineX.length !== baselineY.length) throw new Error('ベースライン期のXとYのデータ数が一致していません．');
    if (interventionX.length !== interventionY.length) throw new Error('介入期のXとYのデータ数が一致していません．');
    const baselineMean = mean(baselineY);
    const sd = sampleSD(baselineY);
    if (baselineMean === null || sd === null) throw new Error('2SD法にはベースライン期の数値データが2点以上必要です．');
    const twoSD = 2 * sd;
    const upper = baselineMean + twoSD;
    const lower = baselineMean - twoSD;
    const projected = interventionX.map(x => ({ x, trend: baselineMean, upper, lower }));
    const improvedFlags = interventionY.map(value => direction === 'lower' ? value < lower : value > upper);
    const improvedCount = improvedFlags.filter(Boolean).length;
    return {
      baselineMean,
      sd,
      twoSD,
      upper,
      lower,
      projected,
      predict: () => baselineMean,
      improvedFlags,
      improvedCount,
      interventionN: interventionY.length,
      improvedRate: interventionY.length ? improvedCount / interventionY.length : null
    };
  }

  // VAIOR: project the baseline Theil–Sen trend with a variability band equal to the median absolute residual.
  // Overall criterion = 2 × baseline outside-band rate; intervention must strictly exceed the criterion.
  function vaiorAnalysis(baselineX, baselineY, interventionX, interventionY, direction) {
    const trendModel = theilSen(baselineX, baselineY);
    const baselineProjected = baselineX.map(x => trendModel.predict(x));
    const absoluteDeviations = baselineY.map((value, index) => Math.abs(value - baselineProjected[index]));
    const mad = median(absoluteDeviations);
    const project = x => {
      const trend = trendModel.predict(x);
      return { x, trend, upper: trend + mad, lower: trend - mad };
    };
    const baselineBands = baselineX.map(project);
    const interventionBands = interventionX.map(project);
    const baselineOutsideFlags = baselineY.map((value, index) => value > baselineBands[index].upper || value < baselineBands[index].lower);
    const baselineOutsideCount = baselineOutsideFlags.filter(Boolean).length;
    const baselineOutsideRate = baselineY.length ? baselineOutsideCount / baselineY.length : null;
    const criterion = baselineOutsideRate === null ? null : 2 * baselineOutsideRate;
    const interventionImprovedFlags = interventionY.map((value, index) => direction === 'lower'
      ? value < interventionBands[index].lower
      : value > interventionBands[index].upper);
    const interventionImprovedCount = interventionImprovedFlags.filter(Boolean).length;
    const interventionImprovedRate = interventionY.length ? interventionImprovedCount / interventionY.length : null;
    const immediate = interventionY.length < 3
      ? { status: 'indeterminate', reason: '介入期が3点未満のため判定不能です．' }
      : { status: interventionImprovedFlags.slice(0, 3).every(Boolean) ? 'effective' : 'not_effective', flags: interventionImprovedFlags.slice(0, 3) };
    const delayed = interventionY.length < 3
      ? { status: 'indeterminate', reason: '介入期が3点未満のため判定不能です．' }
      : { status: interventionImprovedFlags.slice(-3).every(Boolean) ? 'effective' : 'not_effective', flags: interventionImprovedFlags.slice(-3) };
    let overall;
    if (criterion === null || interventionImprovedRate === null) {
      overall = { status: 'indeterminate', reason: '割合を算出できるデータがありません．' };
    } else {
      overall = {
        status: interventionImprovedRate > criterion ? 'effective' : 'not_effective',
        impossibleCriterion: criterion > 1
      };
    }
    return {
      ...trendModel,
      mad,
      absoluteDeviations,
      baselineBands,
      interventionBands,
      baselineOutsideFlags,
      baselineOutsideCount,
      baselineN: baselineY.length,
      baselineOutsideRate,
      criterion,
      interventionImprovedFlags,
      interventionImprovedCount,
      interventionN: interventionY.length,
      interventionImprovedRate,
      immediate,
      delayed,
      overall
    };
  }

  function transformDirection(values, direction) {
    return direction === 'lower' ? values.map(value => -value) : [...values];
  }

  function sign(value) {
    return value > 0 ? 1 : value < 0 ? -1 : 0;
  }

  function crossPhaseScores(baseline, intervention, direction) {
    const a = transformDirection(baseline, direction);
    const b = transformDirection(intervention, direction);
    let improved = 0;
    let tied = 0;
    let worsened = 0;
    let score = 0;
    for (const av of a) {
      for (const bv of b) {
        const comparison = sign(bv - av);
        score += comparison;
        if (comparison > 0) improved += 1;
        else if (comparison < 0) worsened += 1;
        else tied += 1;
      }
    }
    return { score, improved, tied, worsened, pairs: a.length * b.length };
  }

  function baselineTrendScore(baseline, direction) {
    const values = transformDirection(baseline, direction);
    let score = 0;
    let improved = 0;
    let tied = 0;
    let worsened = 0;
    for (let i = 0; i < values.length - 1; i += 1) {
      for (let j = i + 1; j < values.length; j += 1) {
        const comparison = sign(values[j] - values[i]);
        score += comparison;
        if (comparison > 0) improved += 1;
        else if (comparison < 0) worsened += 1;
        else tied += 1;
      }
    }
    return { score, improved, tied, worsened, pairs: values.length * (values.length - 1) / 2 };
  }

  function tieTerm(values, powerMode) {
    const counts = new Map();
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    let result = 0;
    counts.forEach(count => {
      if (count > 1) result += powerMode === 'mw' ? count ** 3 - count : count * (count - 1) * (2 * count + 5);
    });
    return result;
  }

  function tieGroupSums(values) {
    const counts = new Map();
    values.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
    let pair = 0;
    let triple = 0;
    let weighted = 0;
    counts.forEach(count => {
      if (count > 1) {
        pair += count * (count - 1);
        triple += count * (count - 1) * (count - 2);
        weighted += count * (count - 1) * (2 * count + 5);
      }
    });
    return { pair, triple, weighted };
  }

  // Variance of the Mann–Whitney/Kendall S score for an A-vs-B contrast,
  // including the usual correction for ties in the outcome values.
  function mannWhitneyScoreVariance(baseline, intervention) {
    const m = baseline.length;
    const n = intervention.length;
    const total = m + n;
    if (m < 1 || n < 1 || total < 2) return null;
    const correction = tieTerm([...baseline, ...intervention], 'mw') / (total * (total - 1));
    const varianceU = (m * n / 12) * (total + 1 - correction);
    return Math.max(0, 4 * varianceU);
  }

  // General tie-corrected variance of Kendall's S for paired variables X and Y.
  // This is used for the original Tau-U baseline-correction coding, where X
  // contains ties for all intervention observations.
  function kendallScoreVarianceXY(x, y) {
    if (x.length !== y.length) throw new Error('Kendall Sの2変数のデータ数が一致していません．');
    const n = x.length;
    if (n < 2) return null;
    const tx = tieGroupSums(x);
    const ty = tieGroupSums(y);
    let variance = (n * (n - 1) * (2 * n + 5) - tx.weighted - ty.weighted) / 18;
    if (n > 1) variance += (tx.pair * ty.pair) / (2 * n * (n - 1));
    if (n > 2) variance += (tx.triple * ty.triple) / (9 * n * (n - 1) * (n - 2));
    return Math.max(0, variance);
  }

  function kendallScoreXY(x, y) {
    if (x.length !== y.length) throw new Error('Kendall Sの2変数のデータ数が一致していません．');
    let score = 0;
    let concordant = 0;
    let discordant = 0;
    let tied = 0;
    for (let i = 0; i < x.length - 1; i += 1) {
      for (let j = i + 1; j < x.length; j += 1) {
        const comparison = sign(x[j] - x[i]) * sign(y[j] - y[i]);
        score += comparison;
        if (comparison > 0) concordant += 1;
        else if (comparison < 0) discordant += 1;
        else tied += 1;
      }
    }
    return { score, concordant, discordant, tied, pairs: x.length * (x.length - 1) / 2 };
  }

  function erf(x) {
    const signX = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * ax);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
    return signX * y;
  }

  function normalCDF(x) {
    return 0.5 * (1 + erf(x / Math.sqrt(2)));
  }

  function pTwoSidedFromZ(z) {
    if (!Number.isFinite(z)) return null;
    return Math.min(1, 2 * (1 - normalCDF(Math.abs(z))));
  }

  function criticalZ(confidence) {
    if (Math.abs(confidence - 0.90) < EPS) return 1.6448536269514722;
    if (Math.abs(confidence - 0.95) < EPS) return 1.959963984540054;
    throw new Error('対応していない信頼水準です．');
  }

  function makeCI(estimate, se, confidence, bounds) {
    if (se === null || !Number.isFinite(se)) return null;
    const z = criticalZ(confidence);
    let lower = estimate - z * se;
    let upper = estimate + z * se;
    if (bounds) {
      lower = Math.max(bounds[0], lower);
      upper = Math.min(bounds[1], upper);
    }
    return { lower, upper, confidence };
  }

  function bisectionRoot(fn, lower, upper, tolerance = 1e-12, maxIterations = 200) {
    let lo = lower;
    let hi = upper;
    let flo = fn(lo);
    let fhi = fn(hi);
    if (!Number.isFinite(flo) || !Number.isFinite(fhi)) return null;
    if (Math.abs(flo) < tolerance) return lo;
    if (Math.abs(fhi) < tolerance) return hi;
    if (flo * fhi > 0) return null;
    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      const mid = (lo + hi) / 2;
      const fmid = fn(mid);
      if (!Number.isFinite(fmid)) return null;
      if (Math.abs(fmid) < tolerance || Math.abs(hi - lo) < tolerance) return mid;
      if (flo * fmid <= 0) {
        hi = mid;
        fhi = fmid;
      } else {
        lo = mid;
        flo = fmid;
      }
    }
    return (lo + hi) / 2;
  }

  // Newcombe (2006), Method 5: symmetrized score-inversion CI for NAP/AUC.
  function newcombeNAPCI(estimate, m, n, confidence) {
    if (![estimate, m, n].every(Number.isFinite) || m < 1 || n < 1) return null;
    const z = criticalZ(confidence);
    const h = (m + n) / 2 - 1;
    const fn = value => m * n * (estimate - value) ** 2 * (2 - value) * (1 + value)
      - z ** 2 * value * (1 - value) * (2 + h + (1 + 2 * h) * value * (1 - value));
    let lower = 0;
    let upper = 1;
    if (estimate > 0) lower = bisectionRoot(fn, 0, estimate) ?? 0;
    if (estimate < 1) {
      // When estimate is exactly zero, x=0 is a trivial root. Move slightly
      // inside the interval to locate the non-trivial upper limit.
      const start = estimate === 0 ? 1e-12 : estimate;
      upper = bisectionRoot(fn, start, 1) ?? 1;
      if (estimate === 0 && upper <= 1e-10) {
        let previousX = 1e-10;
        let previousF = fn(previousX);
        for (let k = 1; k <= 1000; k += 1) {
          const x = k / 1000;
          const fx = fn(x);
          if (previousF * fx <= 0) { upper = bisectionRoot(fn, previousX, x) ?? x; break; }
          previousX = x;
          previousF = fx;
        }
      }
    }
    if (estimate === 1) {
      const end = 1 - 1e-12;
      lower = bisectionRoot(fn, 0, end) ?? 0;
    }
    return { lower: Math.max(0, lower), upper: Math.min(1, upper), confidence };
  }

  function napPairMatrix(baseline, intervention, direction) {
    const a = transformDirection(baseline, direction);
    const b = transformDirection(intervention, direction);
    return a.map(aValue => b.map(bValue => bValue > aValue ? 1 : bValue === aValue ? 0.5 : 0));
  }

  // Exactly unbiased variance estimator for NAP (Sen, 1967; Mee, 1990),
  // matching the implementation in the SingleCaseES package.
  function napUnbiasedVariance(matrix, estimate) {
    const m = matrix.length;
    const n = matrix[0]?.length || 0;
    if (m < 2 || n < 2) return null;
    const rowDeviationSums = matrix.map(row => sum(row.map(value => value - estimate)));
    const colDeviationSums = Array.from({ length: n }, (_, column) => sum(matrix.map(row => row[column] - estimate)));
    const q1 = sum(rowDeviationSums.map(value => value ** 2)) / (m * n ** 2);
    const q2 = sum(colDeviationSums.map(value => value ** 2)) / (m ** 2 * n);
    const truncation = 0.5 / (m * n);
    const truncatedEstimate = Math.min(Math.max(estimate, truncation), 1 - truncation);
    const xTerm = sum(matrix.flat().map(value => (value - estimate) ** 2)) / (m * n);
    const variance = (truncatedEstimate * (1 - truncatedEstimate) + n * q1 + m * q2 - 2 * xTerm) / ((m - 1) * (n - 1));
    return Math.max(0, variance);
  }

  function interpretPND(value) {
    if (!Number.isFinite(value)) return '判定不能';
    if (value < 0.50) return '効果なしの目安';
    if (value < 0.70) return '判断保留の目安';
    if (value < 0.90) return '効果ありの目安';
    return '非常に大きい効果の目安';
  }

  function interpretNAP(value) {
    if (!Number.isFinite(value)) return '判定不能';
    if (value < 0.50 - EPS) return 'B期が低い方向';
    if (Math.abs(value - 0.50) <= EPS) return '方向差なしの目安';
    if (value < 0.66) return 'B期が高い方向（弱い変化）';
    if (value < 0.93) return 'B期が高い方向（中程度の変化）';
    return 'B期が高い方向（強い変化）';
  }

  function tauMagnitude(value) {
    const magnitude = Math.abs(value);
    if (magnitude < 0.20) return '小さい';
    if (magnitude < 0.60) return '中程度';
    if (magnitude < 0.80) return '大きい';
    return '非常に大きい';
  }

  function interpretTau(value) {
    if (!Number.isFinite(value)) return '判定不能';
    if (Math.abs(value) <= EPS) return '方向差なしの目安';
    const magnitude = tauMagnitude(value);
    return value < 0 ? `B期が低い方向（${magnitude}変化）` : `B期が高い方向（${magnitude}変化）`;
  }

  // PND: percentage of intervention values strictly beyond the single best baseline value; ties do not count.
  function pnd(baselineRaw, interventionRaw, direction) {
    const baselineClean = cleanNumeric(baselineRaw);
    const interventionClean = cleanNumeric(interventionRaw);
    const baseline = baselineClean.values;
    const intervention = interventionClean.values;
    if (!baseline.length) throw new Error('PNDにはベースライン期の数値データが1点以上必要です．');
    if (!intervention.length) throw new Error('PNDには介入期の数値データが1点以上必要です．');
    const bestBaseline = direction === 'lower' ? Math.min(...baseline) : Math.max(...baseline);
    const flags = intervention.map(value => direction === 'lower' ? value < bestBaseline : value > bestBaseline);
    const improvedCount = flags.filter(Boolean).length;
    const estimate = improvedCount / intervention.length;
    return {
      bestBaseline,
      improvedCount,
      interventionN: intervention.length,
      pnd: estimate,
      interpretation: interpretPND(estimate),
      direction,
      excludedBaseline: baselineClean.excludedCount,
      excludedIntervention: interventionClean.excludedCount,
      tiesExcludedFromImprovement: true
    };
  }

  // NAP: average of all A×B pair scores (improvement=1, tie=0.5, worsening=0).
  function nap(baselineRaw, interventionRaw, direction) {
    const baselineClean = cleanNumeric(baselineRaw);
    const interventionClean = cleanNumeric(interventionRaw);
    const baseline = baselineClean.values;
    const intervention = interventionClean.values;
    if (!baseline.length || !intervention.length) throw new Error('NAPには各期1点以上の数値データが必要です．');
    const scores = crossPhaseScores(baseline, intervention, direction);
    const estimate = (scores.improved + 0.5 * scores.tied) / scores.pairs;
    const matrix = napPairMatrix(baseline, intervention, direction);
    const unbiasedVariance = napUnbiasedVariance(matrix, estimate);
    const se = unbiasedVariance === null ? null : Math.sqrt(unbiasedVariance);
    const varianceSNull = mannWhitneyScoreVariance(transformDirection(baseline, direction), transformDirection(intervention, direction));
    const seNull = varianceSNull === null ? null : Math.sqrt(varianceSNull) / (2 * scores.pairs);
    const z = seNull && seNull > 0 ? (estimate - 0.5) / seNull : null;
    return {
      nap: estimate,
      ...scores,
      se,
      ci90: newcombeNAPCI(estimate, baseline.length, intervention.length, 0.90),
      ci95: newcombeNAPCI(estimate, baseline.length, intervention.length, 0.95),
      pValue: z === null ? null : pTwoSidedFromZ(z),
      interpretation: interpretNAP(estimate),
      inferenceMethod: 'SE：Sen–Meeの不偏分散推定，CI：Newcombe法，P値：Mann–Whitney Uの同順位補正付き正規近似',
      inferenceCaution: '各期内の観測が相互に独立で，同一分布に従うことを仮定した近似です．',
      excludedBaseline: baselineClean.excludedCount,
      excludedIntervention: interventionClean.excludedCount
    };
  }

  // Tau: signed A×B nonoverlap score, equivalent to 2×NAP−1.
  function tau(baselineRaw, interventionRaw, direction) {
    const napResult = nap(baselineRaw, interventionRaw, direction);
    const estimate = 2 * napResult.nap - 1;
    return {
      tau: estimate,
      improved: napResult.improved,
      tied: napResult.tied,
      worsened: napResult.worsened,
      score: napResult.improved - napResult.worsened,
      pairs: napResult.pairs,
      se: napResult.se === null ? null : 2 * napResult.se,
      ci90: napResult.ci90 ? { lower: 2 * napResult.ci90.lower - 1, upper: 2 * napResult.ci90.upper - 1, confidence: 0.90 } : null,
      ci95: napResult.ci95 ? { lower: 2 * napResult.ci95.lower - 1, upper: 2 * napResult.ci95.upper - 1, confidence: 0.95 } : null,
      pValue: napResult.pValue,
      interpretation: interpretTau(estimate),
      inferenceMethod: 'NAPの不偏SEとNewcombe信頼区間を線形変換し，P値はMann–Whitney Uの同順位補正付き正規近似',
      inferenceCaution: napResult.inferenceCaution,
      excludedBaseline: napResult.excludedBaseline,
      excludedIntervention: napResult.excludedIntervention
    };
  }

  // Tau-U used in this app: optional baseline-trend correction with the A-vs-B denominator.
  // No correction: Tau = S_AB / (n_A*n_B)
  // Baseline correction: Tau-U = (S_AB - S_A) / (n_A*n_B)
  function tauU(baselineRaw, interventionRaw, direction = 'higher', options) {
    const settings = Object.assign({ correctBaseline: true }, options || {});
    const baselineClean = cleanNumeric(baselineRaw);
    const interventionClean = cleanNumeric(interventionRaw);
    const baseline = baselineClean.values;
    const intervention = interventionClean.values;
    if (baseline.length < 2) throw new Error('Tau-Uのベースライン傾向算出には2点以上の数値データが必要です．');
    if (!intervention.length) throw new Error('Tau-Uには介入期の数値データが1点以上必要です．');
    const cross = crossPhaseScores(baseline, intervention, direction);
    const trend = baselineTrendScore(baseline, direction);
    const tauAB = cross.score / cross.pairs;
    const tauA = trend.pairs ? trend.score / trend.pairs : 0;
    const corrected = Boolean(settings.correctBaseline);
    const numerator = corrected ? cross.score - trend.score : cross.score;
    const denominator = cross.pairs;
    const estimate = numerator / denominator;

    let varianceS;
    let inferenceMethod;
    let inferenceCaution;
    if (corrected) {
      const transformedA = transformDirection(baseline, direction);
      const transformedB = transformDirection(intervention, direction);
      // Reverse-code A time and assign a common, later code to every B value.
      // The resulting Kendall S equals S_AB - S_A while excluding B-phase trend.
      const predictor = [
        ...Array.from({ length: baseline.length }, (_, index) => baseline.length - index),
        ...Array.from({ length: intervention.length }, () => baseline.length + 1)
      ];
      const outcome = [...transformedA, ...transformedB];
      const codedScore = kendallScoreXY(predictor, outcome);
      if (codedScore.score !== numerator) throw new Error('Tau-Uの内部照合でS統計量が一致しませんでした．');
      varianceS = kendallScoreVarianceXY(predictor, outcome);
      inferenceMethod = '逆時系列化したA期と定数化したB期によるKendall Sの同順位補正付き正規近似';
      inferenceCaution = 'Tau-Uの標本分布は十分に確立していないため，CIとP値は原著系のKendall S近似による参考値です．';
    } else {
      varianceS = mannWhitneyScoreVariance(transformDirection(baseline, direction), transformDirection(intervention, direction));
      inferenceMethod = 'Mann–Whitney Uの同順位補正付き正規近似';
      inferenceCaution = '各期内の観測が相互に独立であることを仮定した近似です．';
    }
    const se = varianceS === null ? null : Math.sqrt(varianceS) / denominator;
    const z = varianceS && varianceS > 0 ? numerator / Math.sqrt(varianceS) : null;
    return {
      tauU: estimate,
      tauAB,
      tauA,
      cross,
      trend,
      corrected,
      numerator,
      denominator,
      correctionScore: corrected ? trend.score : 0,
      se,
      ci90: makeCI(estimate, se, 0.90, corrected ? null : [-1, 1]),
      ci95: makeCI(estimate, se, 0.95, corrected ? null : [-1, 1]),
      pValue: z === null ? null : pTwoSidedFromZ(z),
      interpretation: interpretTau(estimate),
      inferenceMethod,
      inferenceCaution,
      varianceS,
      excludedBaseline: baselineClean.excludedCount,
      excludedIntervention: interventionClean.excludedCount,
      baselineN: baseline.length,
      interventionN: intervention.length
    };
  }

  function columnNumberToLetters(number) {
    let value = number;
    let letters = '';
    while (value > 0) {
      const remainder = (value - 1) % 26;
      letters = String.fromCharCode(65 + remainder) + letters;
      value = Math.floor((value - 1) / 26);
    }
    return letters;
  }

  function columnLettersToNumber(letters) {
    return letters.toUpperCase().split('').reduce((acc, letter) => acc * 26 + letter.charCodeAt(0) - 64, 0);
  }

  function parseA1Range(rangeText) {
    const match = String(rangeText || '').trim().match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
    if (!match) throw new Error('セル範囲は C2:C6 の形式で入力してください．');
    const startCol = columnLettersToNumber(match[1]) - 1;
    const startRowExcel = Number(match[2]);
    const endCol = columnLettersToNumber(match[3] || match[1]) - 1;
    const endRowExcel = Number(match[4] || match[2]);
    if (startRowExcel < 2 || endRowExcel < 2) throw new Error('1行目は列名です．データ範囲は2行目以降を指定してください．');
    return {
      startCol: Math.min(startCol, endCol),
      endCol: Math.max(startCol, endCol),
      startRow: Math.min(startRowExcel, endRowExcel) - 2,
      endRow: Math.max(startRowExcel, endRowExcel) - 2,
      normalized: `${columnNumberToLetters(Math.min(startCol, endCol) + 1)}${Math.min(startRowExcel, endRowExcel)}:${columnNumberToLetters(Math.max(startCol, endCol) + 1)}${Math.max(startRowExcel, endRowExcel)}`
    };
  }

  return {
    EPS,
    isFiniteNumber,
    toNumber,
    cleanNumeric,
    mean,
    median,
    sampleSD,
    descriptiveStats,
    linearRegression,
    theilSen,
    celerationLine,
    celerationABAnalysis,
    binomialUpperTail,
    splitConsecutivePhases,
    pairBaselineIntervention,
    twoSDAnalysis,
    vaiorAnalysis,
    crossPhaseScores,
    baselineTrendScore,
    pnd,
    nap,
    tau,
    tauU,
    interpretPND,
    interpretNAP,
    interpretTau,
    newcombeNAPCI,
    napUnbiasedVariance,
    kendallScoreVarianceXY,
    normalCDF,
    parseA1Range,
    columnNumberToLetters,
    columnLettersToNumber
  };
});
