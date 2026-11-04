(() => {
  'use strict';
  const dictionary=window.SCD_EN||{};
  let language='ja';
  try { language=localStorage.getItem('scd-language')==='en'?'en':'ja'; } catch {}
  const reverse=new Map();
  const originals=new WeakMap(), attributes=new WeakMap();
  const skip='[data-i18n-skip], script, style, code, .citation-list, #chart .plot-container, #prepChart .plot-container';
  const phrases=Object.entries(dictionary).filter(([ja])=>ja.length>3).sort((a,b)=>b[0].length-a[0].length);
  function translate(text) {
    if(language!=='en'||typeof text!=='string')return text;
    if(dictionary[text]){reverse.set(dictionary[text],text);return dictionary[text];}
    let output=text;
    for(const [ja,en] of phrases)output=output.split(ja).join(en);
    output=output.replace(/(\d+)シート/g,'$1 worksheets').replace(/(\d+)データ行/g,'$1 observations').replace(/欠損セル (\d+)/g,'Missing cells: $1').replace(/混合型列 (\d+)/g,'Mixed-type columns: $1').replace(/(\d+)列/g,'$1 columns').replace(/(\d+)〜(\d+)行/g,'rows $1–$2').replace(/(\d+)行/g,'$1 rows').replace(/(\d+)点/g,'$1 observations').replace(/(\d+)フェーズ登録済み/g,'$1 phases registered').replace(/(\d+)データ登録済み/g,'$1 series registered');
    const terms={'使用データ：':'Observations: ','推論法：':'Inference: ','統計解析はB期が低い方向を改善として計算します．目安は便宜的な区分であり，グラフの水準・傾向・ばらつきと併せて解釈してください．':'Lower B-phase values indicate improvement. Interpret these heuristic guides together with level, trend and variability.','統計解析はB期が高い方向を改善として計算します．目安は便宜的な区分であり，グラフの水準・傾向・ばらつきと併せて解釈してください．':'Higher B-phase values indicate improvement. Interpret these heuristic guides together with level, trend and variability.','自動登録：':'Registered phases: ','同値':'ties','除外：':'Excluded: ','A期':'Phase A','B期':'Phase B','数値データ：':'Numeric observations: ','データ1':'Series 1','データ2':'Series 2','データ3':'Series 3','データ4':'Series 4','（補正なし）':' (uncorrected)','（数値入力）':' (numeric input)','（弱い変化）':' (weak change)','（中程度の変化）':' (moderate change)','（中程度変化）':' (moderate change)','（大きい変化）':' (large change)','（小さい変化）':' (small change)','改善方向':'Improvement direction','逆方向':'Opposite direction','非常に大きい効果の目安':'Very large effect (guide)'};
    for(const [ja,en] of Object.entries(terms).sort((a,b)=>b[0].length-a[0].length))output=output.split(ja).join(en);
    if(output!==text)reverse.set(output,text);
    return output;
  }
  let observer;
  function apply() {
    observer?.disconnect();
    document.documentElement.lang=language;
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())) {
      if(!node.parentElement||node.parentElement.closest(skip)||!node.textContent.trim())continue;
      const saved=originals.get(node);
      const raw=saved&&node.textContent===saved.rendered?saved.source:node.textContent;
      const source=reverse.get(raw)||raw;
      const trimmed=source.trim();const rendered=language==='en'?source.replace(trimmed,translate(trimmed)):source;
      if(node.textContent!==rendered)node.textContent=rendered;
      originals.set(node,{source,rendered});
    }
    document.querySelectorAll('[aria-label],[title],[placeholder]').forEach(el=>{
      if(el.closest('[data-i18n-skip]')&&!el.hasAttribute('data-i18n-aria'))return;
      let map=attributes.get(el);if(!map){map={};attributes.set(el,map);}
      ['aria-label','title','placeholder'].forEach(attr=>{if(!el.hasAttribute(attr))return;const current=el.getAttribute(attr),saved=map[attr];const source=saved&&current===saved.rendered?saved.source:current;const rendered=translate(source);if(current!==rendered)el.setAttribute(attr,rendered);map[attr]={source,rendered};});
    });
    document.querySelectorAll('[data-language]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.language===language)));
    observer?.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','aria-label','placeholder']});
  }
  function setLanguage(next) {
    if(!['ja','en'].includes(next))return;
    language=next;try{localStorage.setItem('scd-language',next);}catch{}
    apply();document.dispatchEvent(new CustomEvent('scd:language',{detail:{language}}));apply();
  }
  window.SCDI18n={get language(){return language;},translate,apply,setLanguage};
  document.addEventListener('click',event=>{const button=event.target.closest('[data-language]');if(button)setLanguage(button.dataset.language);});
  document.addEventListener('DOMContentLoaded',()=>{
    observer=new MutationObserver(()=>apply());
    apply();document.dispatchEvent(new CustomEvent('scd:language',{detail:{language}}));
  });
})();
