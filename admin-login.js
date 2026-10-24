(function(){
const $=id=>document.getElementById(id);
const BASE=(window.API_BASE||'').replace(/\/+$/,'');
const tok=()=>{try{return sessionStorage.getItem('asid')||''}catch(e){return ''}};
async function call(path,body){
  const r=await fetch(BASE,{method:'POST',redirect:'follow',body:JSON.stringify({path:path,q:{},token:tok(),body:body||{}})});
  return r.json();
}
function loadPanel(){const s=document.createElement('script');s.src='admin-app.js';document.body.appendChild(s)}
async function go(){
  $('aerr').textContent='';
  try{
    const j=await call('/api/admin/login',{password:$('ap').value});
    if(j.status!==200){$('aerr').textContent=j.error||'Login failed';return}
    try{sessionStorage.setItem('asid',j.data.token)}catch(e){}
    $('ap').value='';loadPanel();
  }catch(e){$('aerr').textContent='Cannot reach the server. Check config.js'}
}
$('alogin').onclick=go;$('ap').addEventListener('keydown',e=>{if(e.key==='Enter')go()});
call('/api/public').then(j=>{if(j.status===200&&window.setTheme)setTheme(j.data.theme||'classic',j.data.center,'Admin')}).catch(()=>{});
if(tok())call('/api/admin/me').then(j=>{if(j.status===200)loadPanel();else try{sessionStorage.removeItem('asid')}catch(e){}}).catch(()=>{});
})();
