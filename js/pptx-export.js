/* Editable PowerPoint export. Each plotted element is a native slide object. */
(() => {
  'use strict';
  const hex = value => {
    if (/^#[0-9a-f]{6}$/i.test(value || '')) return value.slice(1);
    const rgb = String(value || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return rgb ? rgb.slice(1,4).map(v=>Number(v).toString(16).padStart(2,'0')).join('') : '2B2B2B';
  };
  // Clip segments to the axes, including trend lines outside a manual y range.
  function clip(a,b,box) {
    const dx=b.x-a.x,dy=b.y-a.y;let lo=0,hi=1;
    const p=[-dx,dx,-dy,dy],q=[a.x-box.x,box.x+box.w-a.x,a.y-box.y,box.y+box.h-a.y];
    for(let i=0;i<4;i++){if(p[i]===0){if(q[i]<0)return null;}else{const r=q[i]/p[i];if(p[i]<0)lo=Math.max(lo,r);else hi=Math.min(hi,r);if(lo>hi)return null;}}
    return [{x:a.x+lo*dx,y:a.y+lo*dy},{x:a.x+hi*dx,y:a.y+hi*dy}];
  }
  function snapshot(chart,caption) {
    const l=chart._fullLayout;
    if(!l?.xaxis||!chart.data?.length)throw Error('No plotted data to export.');
    const xa=l.xaxis,ya=l.yaxis,rect=chart.getBoundingClientRect();
    const box={x:xa._offset,y:ya._offset,w:xa._length,h:ya._length};
    const point=(x,y)=>({x:xa._offset+xa.l2p(Number(x)),y:ya._offset+ya.l2p(Number(y))});
    const lines=[],dots=[],texts=[];
    const line=(a,b,color,width=1,dash='solid',name='Line',clipped=true)=>{
      const ends=clipped?clip(a,b,box):[a,b];if(ends)lines.push({a:ends[0],b:ends[1],color:hex(color),width,dash,name});
    };
    // Use the displayed tick labels (including user-specified spacing/formatting).
    chart.querySelectorAll('.xtick text,.ytick text,.g-xtitle text,.g-ytitle text').forEach(el=>{
      const r=el.getBoundingClientRect(),style=getComputedStyle(el),vertical=!!el.closest('.g-ytitle');
      texts.push({text:el.textContent,x:r.x-rect.x,y:r.y-rect.y,w:r.width,h:r.height,color:hex(style.fill),size:parseFloat(style.fontSize)||12,vertical});
      if(el.closest('.xtick')&&xa.showgrid){const x=r.x-rect.x+r.width/2;line({x,y:box.y},{x,y:box.y+box.h},xa.gridcolor,1,'solid','X grid',false);}
      if(el.closest('.ytick')&&ya.showgrid){const y=r.y-rect.y+r.height/2;line({x:box.x,y},{x:box.x+box.w,y},ya.gridcolor,1,'solid','Y grid',false);}
    });
    if(xa.showline)line({x:box.x,y:box.y+box.h},{x:box.x+box.w,y:box.y+box.h},xa.linecolor,1,'solid','X axis',false);
    if(ya.showline)line({x:box.x,y:box.y},{x:box.x,y:box.y+box.h},ya.linecolor,1,'solid','Y axis',false);
    (l.shapes||[]).filter(s=>s.type==='line').forEach(s=>{
      const xy=(x,y)=>({x:s.xref==='paper'?box.x+x*box.w:point(x,0).x,y:s.yref==='paper'?box.y+(1-y)*box.h:point(0,y).y});
      line(xy(s.x0,s.y0),xy(s.x1,s.y1),s.line.color,s.line.width,s.line.dash,'Phase boundary');
    });
    chart.data.forEach(t=>{
      if(t.visible===false||t.visible==='legendonly')return;
      let previous=null;
      (t.x||[]).forEach((x,i)=>{
        const y=t.y[i];if(x==null||y==null||!Number.isFinite(Number(x))||!Number.isFinite(Number(y))){previous=null;return;}
        const p=point(x,y);
        if(previous&&String(t.mode).includes('lines'))line(previous,p,t.line?.color,t.line?.width||2,t.line?.dash,t.name||'Trend');
        if(String(t.mode).includes('markers')&&p.x>=box.x&&p.x<=box.x+box.w&&p.y>=box.y&&p.y<=box.y+box.h)dots.push({...p,size:t.marker?.size||8,color:hex(t.marker?.color),symbol:t.marker?.symbol||'circle',name:`${t.name}: ${x}, ${y}`});
        previous=p;
      });
    });
    const legends=[...chart.querySelectorAll('.legend .traces')];
    const visible=chart.data.filter(t=>t.showlegend!==false&&t.visible!==false);
    legends.forEach((group,i)=>{
      const label=group.querySelector('.legendtext');if(!label)return;
      const r=label.getBoundingClientRect(),t=visible[i];if(!t)return;
      const y=r.y-rect.y+r.height/2,x=r.x-rect.x;
      texts.push({text:label.textContent,x,y:r.y-rect.y,w:r.width+6,h:r.height,color:'2B2B2B',size:12});
      if(String(t.mode).includes('lines'))line({x:x-35,y},{x:x-7,y},t.line?.color,t.line?.width||2,t.line?.dash,'Legend line',false);
      if(String(t.mode).includes('markers'))dots.push({x:x-21,y,size:t.marker?.size||8,color:hex(t.marker?.color),symbol:t.marker?.symbol||'circle',name:'Legend marker'});
    });
    return {width:l.width,height:l.height,background:hex(l.paper_bgcolor),caption,lines,dots,texts};
  }
  function build(scene,Constructor=window.PptxGenJS) {
    if(!Constructor)throw Error('PowerPoint export library is unavailable.');
    const pptx=new Constructor();
    const scale=12/scene.width,top=.65,height=scene.height*scale+1;
    pptx.defineLayout({name:'SCD',width:12,height});pptx.layout='SCD';
    pptx.author='SCD Analysis Studio';pptx.subject='Editable single-case research graph';pptx.title=scene.caption;
    const slide=pptx.addSlide();slide.background={color:scene.background};
    slide.addText(scene.caption,{x:.3,y:.12,w:11.4,h:.35,fontFace:'Arial',fontSize:14,margin:0,color:'213F32',breakLine:false});
    scene.lines.forEach(l=>slide.addShape(pptx.ShapeType.line,{x:Math.min(l.a.x,l.b.x)*scale,y:Math.min(l.a.y,l.b.y)*scale+top,w:Math.abs(l.a.x-l.b.x)*scale,h:Math.abs(l.a.y-l.b.y)*scale,flipV:(l.b.x-l.a.x)*(l.b.y-l.a.y)<0,line:{color:l.color,width:l.width*scale*72,dashType:l.dash==='dot'?'sysDot':l.dash==='dash'?'dash':l.dash==='dashdot'?'dashDot':'solid'},objectName:l.name}));
    const shapes={circle:'ellipse',square:'rect',diamond:'diamond','triangle-up':'triangle','triangle-down':'triangle',cross:'plus',x:'plus'};
    scene.dots.forEach(d=>{const size=d.size*scale;slide.addShape(pptx.ShapeType[shapes[d.symbol]||'ellipse'],{x:d.x*scale-size/2,y:d.y*scale+top-size/2,w:size,h:size,rotate:d.symbol==='triangle-down'?180:d.symbol==='x'?45:0,line:{color:d.color,transparency:100},fill:{color:d.color},objectName:d.name});});
    scene.texts.forEach(t=>{
      const w=(t.vertical?t.h:t.w)*scale+.08,h=(t.vertical?t.w:t.h)*scale+.04;
      slide.addText(t.text,{x:(t.x+t.w/2)*scale-w/2,y:(t.y+t.h/2)*scale+top-h/2,w,h,rotate:t.vertical?270:0,fontFace:'Arial',fontSize:t.size*scale*72,color:t.color,margin:0,align:'center',valign:'mid',breakLine:false,objectName:'Label: '+t.text});
    });
    slide.addNotes('Each marker, line and label is an editable PowerPoint object. This is a drawing, not an embedded chart linked to a data workbook.');
    return pptx;
  }
  window.SCDPptx={snapshot,build,clip,download:async(chart,caption)=>build(snapshot(chart,caption)).writeFile({fileName:'SCD_graph_editable.pptx'})};
})();
