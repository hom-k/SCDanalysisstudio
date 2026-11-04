(() => {
  const content=document.getElementById('referenceContent');
  const japanese=content.innerHTML;
  const english=document.getElementById('englishReference').innerHTML;
  function render(){content.innerHTML=window.SCDI18n.language==='en'?english:japanese;}
  document.addEventListener('scd:language',render);
  document.addEventListener('DOMContentLoaded',render);
})();
