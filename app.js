(function(){
"use strict";
const STORE="estoquePadaria.v1";
let products=[], moves=[], toastTimer=null, editingOriginalQty=null;
let auditState={enabled:false,events:[],message:""};
let currentUser=null, accountsStatus={accountsEnabled:false,setupRequired:false}, usersList=[];
const API_BASE=String(window.ESTOQUE_CONFIG&&window.ESTOQUE_CONFIG.apiBaseUrl||"").trim().replace(/\/+$/,"");
const REMOTE_MODE=Boolean(API_BASE);
localStorage.removeItem("estoquePadariaApiToken");
let authToken=sessionStorage.getItem("estoquePadariaApiToken")||"";

const $=id=>document.getElementById(id);
const safe=(v)=>String(v==null?"":v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const num=n=>Number(n||0).toLocaleString("pt-BR",{maximumFractionDigits:2});
const dateFmt=d=>new Date(d).toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"});
function load(){try{const d=JSON.parse(localStorage.getItem(STORE)||"{}");products=Array.isArray(d.products)?d.products:[];moves=Array.isArray(d.moves)?d.moves:[]}catch(e){products=[];moves=[]}}
function save(){if(!REMOTE_MODE)localStorage.setItem(STORE,JSON.stringify({products,moves}));render()}

function msg(s){const t=$("toast");t.textContent=s;t.classList.remove("hidden");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.add("hidden"),3200)}
function clearAuthenticatedState(){
  authToken="";
  sessionStorage.removeItem("estoquePadariaApiToken");
  currentUser=null;
  products=[];
  moves=[];
  usersList=[];
  auditState={enabled:false,events:[],message:""};
  applyRoleUI();
  render();
}
async function apiRequest(path,options={}){
  if(!API_BASE)throw new Error("O endereço do banco online ainda não foi configurado.");
  const headers={"Accept":"application/json"};
  let body=options.body;
  if(body!==undefined && body!==null && typeof body!=="string"){headers["Content-Type"]="application/json";body=JSON.stringify(body)}
  if(authToken&&path!=="/api/login")headers["Authorization"]="Bearer "+authToken;
  const response=await fetch(API_BASE+path,{method:options.method||"GET",headers,body,cache:"no-store"});
  const data=await response.json().catch(()=>({error:"Resposta inválida da API."}));
  if(!response.ok){
    if(response.status===401&&path!=="/api/login"){
      clearAuthenticatedState();
      $("login-overlay").classList.remove("hidden");
      $("login-error").textContent="Sua sessão expirou ou foi revogada. Entre novamente.";
    }
    throw new Error(data.error||"Não foi possível acessar o banco online.");
  }
  return data;
}
async function refreshRemote(){
  const result=await Promise.all([
    apiRequest("/api/products"),
    apiRequest("/api/movements"),
    apiRequest("/api/audit?limit=100").catch(error=>({enabled:false,events:[],message:error.message})),
    apiRequest("/api/me")
  ]);
  products=Array.isArray(result[0])?result[0]:[];
  moves=Array.isArray(result[1])?result[1]:[];
  auditState=result[2]&&typeof result[2]==="object"?result[2]:{enabled:false,events:[],message:"Resposta de auditoria inválida."};
  currentUser=result[3]?.user||null;
  applyRoleUI();
  render();
}
async function configureLoginMode(){
  try{accountsStatus=await apiRequest("/api/auth/status");}
  catch{accountsStatus={accountsEnabled:false,setupRequired:false};}
  const needsSetup=Boolean(accountsStatus.accountsEnabled&&accountsStatus.setupRequired);
  $("login-form").classList.toggle("hidden",needsSetup);
  $("bootstrap-admin-form").classList.toggle("hidden",!needsSetup);
  $("login-username-field").classList.toggle("hidden",!accountsStatus.accountsEnabled||needsSetup);
  $("login-username").required=Boolean(accountsStatus.accountsEnabled&&!needsSetup);
  const passwordLabel=document.querySelector('label[for="login-password"]');
  if(passwordLabel)passwordLabel.textContent=accountsStatus.accountsEnabled?"Senha individual":"Senha de acesso";
  $("login-description").textContent=accountsStatus.accountsEnabled
    ?"Entre com seu usuário e sua senha individual para acessar o estoque da Capricho."
    :"Acesse com a senha da equipe para consultar o estoque compartilhado da Panificação Capricho.";
  if(needsSetup){
    authToken="";
    sessionStorage.removeItem("estoquePadariaApiToken");
  }
}
async function initRemote(){
  if(!REMOTE_MODE){$("storage-status").textContent="Modo local · dispositivo único";$("data-notice").textContent="O modo local mantém os dados apenas neste navegador. Para operar com a equipe, ative a conexão com o banco compartilhado.";return}
  $("backup-restore-card").classList.add("hidden");
  enableRemoteActions();
  applyRoleUI();
  $("storage-status").textContent="Banco online · acesso protegido";
  $("data-notice").textContent="Produtos e movimentações são compartilhados entre dispositivos autorizados. Exporte backups regularmente e guarde-os em local seguro.";
  try {
    const localCopy=JSON.parse(localStorage.getItem(STORE)||"{}");
    const count=Array.isArray(localCopy.products)?localCopy.products.length:0;
    const warning=$("local-data-warning");
    if(count>0){warning.textContent="Este aparelho ainda tem "+count+" produto(s) salvos localmente. Eles não serão enviados ao banco automaticamente. Exporte um backup antes de migrar o estoque.";warning.classList.remove("hidden");}
    else warning.classList.add("hidden");
  } catch {}
  await configureLoginMode();
  $("login-overlay").classList.remove("hidden");
  if(authToken&&!accountsStatus.setupRequired){
    try{
      await refreshRemote();
      $("login-overlay").classList.add("hidden");
      msg("Conectado ao estoque compartilhado.");
      return;
    }catch(error){
      authToken="";sessionStorage.removeItem("estoquePadariaApiToken");
      $("login-error").textContent=error.message;
    }
  }
  if(accountsStatus.setupRequired)$("bootstrap-current-password").focus();
  else if(accountsStatus.accountsEnabled)$("login-username").focus();
  else $("login-password").focus();
}
function enableRemoteActions(){
  if(REMOTE_MODE)$("remote-actions").classList.remove("hidden");
}
$("sync-now").addEventListener("click",async()=>{
  const button=$("sync-now");button.disabled=true;button.textContent="Atualizando…";
  try{await refreshRemote();msg("Estoque atualizado.");}
  catch(error){msg(error.message);}
  finally{button.disabled=false;button.textContent="↻ Atualizar";}
});
$("refresh-audit").addEventListener("click",async()=>{
  const button=$("refresh-audit");button.disabled=true;button.textContent="Atualizando…";
  try{
    auditState=await apiRequest("/api/audit?limit=100");
    renderAudit();
    msg(auditState.enabled?"Auditoria atualizada.":"A auditoria ainda precisa ser ativada no banco.");
  }catch(error){
    auditState={enabled:false,events:[],message:"Não foi possível carregar a auditoria: "+error.message};
    renderAudit();msg(error.message);
  }finally{button.disabled=false;button.textContent="Atualizar auditoria";}
});
$("logout-now").addEventListener("click",()=>{
  clearAuthenticatedState();
  $("login-password").value="";$("login-username").value="";$("login-error").textContent="";
  $("login-password").type="password";
  $("toggle-password-label").textContent="Mostrar";
  $("toggle-password").setAttribute("aria-label","Mostrar senha");
  $("toggle-password").setAttribute("aria-pressed","false");
  $("login-overlay").classList.remove("hidden");
  msg("Sessão encerrada neste dispositivo.");
});
window.addEventListener("focus",()=>{
  if(REMOTE_MODE&&authToken&&!document.hidden)refreshRemote().catch(()=>{});
});
document.addEventListener("visibilitychange",()=>{
  if(REMOTE_MODE&&authToken&&!document.hidden)refreshRemote().catch(()=>{});
});
window.setInterval(()=>{
  if(REMOTE_MODE&&authToken&&!document.hidden)refreshRemote().catch(()=>{});
},60000);
$("toggle-password").addEventListener("click",()=>{
  const input=$("login-password");
  const show=input.type==="password";
  input.type=show?"text":"password";
  $("toggle-password-label").textContent=show?"Ocultar":"Mostrar";
  $("toggle-password").setAttribute("aria-label",show?"Ocultar senha":"Mostrar senha");
  $("toggle-password").setAttribute("aria-pressed",String(show));
});
$("login-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const submit=$("login-submit"),error=$("login-error");
  submit.disabled=true;submit.textContent="Conectando…";error.textContent="";
  try{
    const body={password:$("login-password").value};
    if(accountsStatus.accountsEnabled)body.username=$("login-username").value.trim();
    const result=await apiRequest("/api/login",{method:"POST",body});
    authToken=result.token;
    sessionStorage.setItem("estoquePadariaApiToken",authToken);
    await refreshRemote();
    $("login-overlay").classList.add("hidden");
    $("login-password").value="";
    $("login-password").type="password";
    $("toggle-password-label").textContent="Mostrar";
    $("toggle-password").setAttribute("aria-label","Mostrar senha");
    $("toggle-password").setAttribute("aria-pressed","false");
    $("login-username").value="";
    msg("Conectado ao estoque compartilhado.");
  }catch(err){error.textContent=err.message||"Falha ao entrar. Tente novamente."}
  finally{submit.disabled=false;submit.textContent="Acessar estoque"}
});
$("bootstrap-admin-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const button=$("bootstrap-submit"),error=$("bootstrap-error");
  button.disabled=true;button.textContent="Configurando…";error.textContent="";
  try{
    const username=$("bootstrap-username").value.trim().toLowerCase();
    await apiRequest("/api/users/bootstrap",{method:"POST",body:{
      currentPassword:$("bootstrap-current-password").value,
      username,
      displayName:$("bootstrap-display-name").value.trim(),
      password:$("bootstrap-password").value
    }});
    $("bootstrap-current-password").value="";
    $("bootstrap-password").value="";
    await configureLoginMode();
    $("login-username").value=username;
    $("login-error").textContent="Administrador criado. Entre com o usuário e a nova senha individual.";
    $("login-password").focus();
  }catch(err){error.textContent=err.message||"Não foi possível configurar o administrador."}
  finally{button.disabled=false;button.textContent="Criar administrador"}
});


function applyRoleUI(){
  const role=currentUser?.role||(REMOTE_MODE?"viewer":"admin");
  const individual=Boolean(currentUser&&!currentUser.legacy);
  const admin=individual&&role==="admin";
  $("nav-users").classList.toggle("hidden",!admin);
  const canWrite=["admin","manager","operator"].includes(role);
  $("product-form").closest(".panel").classList.toggle("hidden",REMOTE_MODE&&!canWrite);
  $("movement-form").closest(".panel").classList.toggle("hidden",REMOTE_MODE&&!canWrite);
  const backupCard=$("backup-export-card");
  if(backupCard)backupCard.classList.toggle("hidden",REMOTE_MODE&&!["admin","manager"].includes(role));
  if(REMOTE_MODE&&currentUser){
    $("storage-status").textContent="Conectado: "+currentUser.displayName+" · "+({admin:"Administrador",manager:"Gerente",operator:"Operador",viewer:"Consulta"}[role]||"Equipe");
  }
}
function dateOrDash(value){return value?dateFmt(value):"Nunca";}
const userRoleOptions=[["admin","Administrador"],["manager","Gerente"],["operator","Operador"],["viewer","Consulta"]];
function renderUsers(){
  $("users-count").textContent=usersList.length+" usuário(s)";
  $("users-empty").classList.toggle("hidden",usersList.length>0);
  $("users-table").innerHTML=usersList.map(user=>{
    const roleOptions=userRoleOptions.map(([value,label])=>'<option value="'+value+'"'+(user.role===value?" selected":"")+'>'+label+'</option>').join("");
    return '<tr data-user-row="'+safe(user.id)+'"><td><strong>'+safe(user.username)+'</strong></td>'+
      '<td><input data-user-name maxlength="80" aria-label="Nome exibido" value="'+safe(user.displayName)+'"></td>'+
      '<td><select data-user-role aria-label="Perfil">'+roleOptions+'</select></td>'+
      '<td><select data-user-active aria-label="Status"><option value="true"'+(user.active?" selected":"")+'>Ativo</option><option value="false"'+(!user.active?" selected":"")+'>Inativo</option></select></td>'+
      '<td>'+safe(dateOrDash(user.lastLoginAt))+'</td>'+
      '<td><input data-user-password type="password" autocomplete="new-password" minlength="12" maxlength="128" placeholder="Deixe vazio para manter" aria-label="Nova senha"></td>'+
      '<td><button class="btn small primary" data-user-save type="button">Salvar</button></td></tr>';
  }).join("");
}
async function loadUsers(){
  const rows=await apiRequest("/api/users");
  usersList=Array.isArray(rows)?rows:[];
  renderUsers();
}
$("refresh-users").addEventListener("click",async()=>{
  const button=$("refresh-users");button.disabled=true;
  try{await loadUsers();msg("Lista de acessos atualizada.");}
  catch(error){msg(error.message)}
  finally{button.disabled=false}
});
$("user-create-form").addEventListener("submit",async e=>{
  e.preventDefault();
  const button=$("user-create-submit"),error=$("user-create-error");
  button.disabled=true;button.textContent="Criando…";error.textContent="";
  try{
    await apiRequest("/api/users",{method:"POST",body:{
      username:$("new-user-username").value.trim(),
      displayName:$("new-user-name").value.trim(),
      password:$("new-user-password").value,
      role:$("new-user-role").value
    }});
    $("user-create-form").reset();
    await loadUsers();
    msg("Usuário criado. Entregue a senha individual por um canal seguro.");
  }catch(err){error.textContent=err.message||"Não foi possível criar o usuário."}
  finally{button.disabled=false;button.textContent="Criar usuário"}
});
$("users-table").addEventListener("click",async e=>{
  const button=e.target.closest("[data-user-save]");
  if(!button)return;
  const row=button.closest("[data-user-row]");
  const id=row?.dataset.userRow;
  if(!id)return;
  button.disabled=true;button.textContent="Salvando…";
  try{
    const password=row.querySelector("[data-user-password]").value;
    const body={
      displayName:row.querySelector("[data-user-name]").value.trim(),
      role:row.querySelector("[data-user-role]").value,
      active:row.querySelector("[data-user-active]").value==="true"
    };
    if(password)body.password=password;
    await apiRequest("/api/users/"+encodeURIComponent(id),{method:"PUT",body});
    await loadUsers();
    msg(password?"Acesso atualizado e senha redefinida.":"Acesso atualizado.");
  }catch(error){msg(error.message)}
  finally{button.disabled=false;button.textContent="Salvar"}
});
function status(p){if(Number(p.qty)<=0)return '<span class="pill zero">Sem estoque</span>';if(Number(p.qty)<=Number(p.min||0))return '<span class="pill low">Estoque baixo</span>';return '<span class="pill">Disponível</span>'}
function qty(p){return num(p.qty)+" "+p.unit}
function findProducts(query){const q=norm(query);return products.filter(p=>norm(p.name+" "+p.category+" "+p.notes).includes(q))}
function showView(v){document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active",el.id==="view-"+v));document.querySelectorAll("[data-view]").forEach(el=>el.classList.toggle("active",el.dataset.view===v));$("crumb").textContent=({inicio:"Visão geral",produtos:"Produtos",movimentacoes:"Movimentações",relatorios:"Relatórios e backup",acessos:"Acessos da equipe"})[v]||"Visão geral";if(v==="acessos"&&currentUser?.role==="admin"&&!currentUser.legacy)loadUsers().catch(error=>msg(error.message));window.scrollTo({top:0,behavior:"smooth"})}
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
document.querySelectorAll("[data-goto]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.goto)));
$("today").textContent=new Date().toLocaleDateString("pt-BR",{weekday:"short",day:"2-digit",month:"short",year:"numeric"});
function auditActionLabel(action){
  return ({
    product_created:"Produto cadastrado",
    product_updated:"Dados do produto alterados",
    stock_adjusted:"Ajuste de estoque",
    product_deleted:"Produto excluído",
    movement_created:"Movimentação registrada"
  })[action]||action||"Operação";
}
function auditDescription(event){
  const d=event.details||{};
  if(event.action==="product_created")return "Saldo inicial: "+num(d.initialQuantity||0)+" "+safe(d.unit||"")+(d.category?" · "+safe(d.category):"");
  if(event.action==="product_updated"){
    const labels={name:"nome",category:"categoria",unit:"unidade",min:"estoque mínimo",notes:"observações"};
    return "Campos alterados: "+(Array.isArray(d.fieldsChanged)?d.fieldsChanged.map(key=>safe(labels[key]||key)).join(", "):"—");
  }
  if(event.action==="stock_adjusted")return "Saldo: "+num(d.previousQuantity)+" → "+num(d.newQuantity)+" "+safe(d.unit||"")+" · Motivo: "+safe(d.reason||"—");
  if(event.action==="movement_created")return (d.type==="entrada"?"Entrada":"Saída")+" de "+num(d.quantity)+" "+safe(d.unit||"")+" · Saldo: "+num(d.previousBalance)+" → "+num(d.balanceAfter)+(d.note?" · "+safe(d.note):"");
  if(event.action==="product_deleted")return "Excluído com saldo "+num(d.quantityAtDeletion||0)+" "+safe(d.unit||"");
  return safe(JSON.stringify(d));
}
function renderAudit(){
  const state=auditState||{enabled:false,events:[],message:""};
  const events=Array.isArray(state.events)?state.events:[];
  const enabled=REMOTE_MODE&&state.enabled===true;
  const unavailable=$("audit-unavailable");
  unavailable.classList.toggle("hidden",enabled);
  $("audit-table-wrap").classList.toggle("hidden",!enabled||events.length===0);
  $("audit-empty").classList.toggle("hidden",!enabled||events.length>0);
  if(!enabled){
    const reason=state.message||"A auditoria online ainda não foi ativada.";
    unavailable.textContent=REMOTE_MODE
      ?reason+" Para ativar, execute cloudflare/migrations/0002_audit_events.sql no Console do D1."
      :"A auditoria fica disponível quando o aplicativo estiver conectado ao banco online.";
    return;
  }
  $("audit-table").innerHTML=events.map(event=>'<tr><td>'+safe(dateFmt(event.createdAt))+'</td><td><span class="pill">'+safe(auditActionLabel(event.action))+'</span></td><td><strong>'+safe(event.productName||"—")+'</strong></td><td>'+safe(event.actor||"equipe")+'</td><td>'+auditDescription(event)+'</td></tr>').join("");
}
function render(){
$("stat-products").textContent=products.length;
$("stat-low").textContent=products.filter(p=>Number(p.qty)<=Number(p.min||0)).length;
const today=new Date().toDateString();$("stat-moves").textContent=moves.filter(m=>new Date(m.date).toDateString()===today).length;
$("dashboard-products").innerHTML=products.slice().sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).slice(0,8).map(p=>'<tr><td><strong>'+safe(p.name)+'</strong><div class="subline">'+safe(p.notes)+'</div></td><td>'+safe(p.category||"—")+'</td><td>'+safe(qty(p))+'</td><td>'+status(p)+'</td></tr>').join("");
$("dashboard-empty").classList.toggle("hidden",products.length>0);
$("products-count").textContent=products.length+" produto(s) cadastrado(s)";
const f=norm($("product-filter").value);
const filtered=products.filter(p=>norm(p.name+" "+p.category).includes(f)).sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"));
$("products-table").innerHTML=filtered.map(p=>'<tr><td><strong>'+safe(p.name)+'</strong><div class="subline">'+safe(p.notes)+'</div></td><td>'+safe(p.category||"—")+'</td><td>'+safe(qty(p))+'</td><td>'+num(p.min||0)+' '+safe(p.unit)+'</td><td>'+status(p)+'</td><td><button class="btn small" data-edit="'+safe(p.id)+'">Editar</button> <button class="btn small danger" data-delete="'+safe(p.id)+'">Excluir</button></td></tr>').join("");
$("products-empty").classList.toggle("hidden",filtered.length>0);
const roleForActions=currentUser?.role||(REMOTE_MODE?"viewer":"admin");
document.querySelectorAll("#products-table [data-edit]").forEach(button=>button.classList.toggle("hidden",REMOTE_MODE&&!["admin","manager","operator"].includes(roleForActions)));
document.querySelectorAll("#products-table [data-delete]").forEach(button=>button.classList.toggle("hidden",REMOTE_MODE&&roleForActions!=="admin"));
$("m-product").innerHTML='<option value="">Selecione um produto</option>'+products.slice().sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map(p=>'<option value="'+safe(p.id)+'">'+safe(p.name)+' ('+safe(qty(p))+')</option>').join("");
$("movements-table").innerHTML=moves.slice().sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,100).map(m=>'<tr><td>'+safe(dateFmt(m.date))+'</td><td>'+safe(m.name)+'</td><td><span class="pill '+(m.type==="saida"?"low":"")+'">'+(m.type==="saida"?"Saída":"Entrada")+'</span></td><td>'+safe(num(m.qty))+' '+safe(m.unit)+'</td><td>'+safe(num(m.after))+' '+safe(m.unit)+'</td><td>'+safe(m.note||"—")+'</td></tr>').join("");
$("movements-empty").classList.toggle("hidden",moves.length>0);
renderAudit();
}
function resetForm(){$("product-form").reset();$("product-id").value="";$("p-qty").value="0";$("p-min").value="0";$("p-adjustment-note").value="";editingOriginalQty=null;$("adjustment-note-field").classList.add("hidden");$("p-adjustment-note").required=false;$("product-title").textContent="Cadastrar produto";$("cancel-edit").classList.add("hidden")}
function updateAdjustmentNoteField(){const changed=Boolean($("product-id").value)&&editingOriginalQty!==null&&Number($("p-qty").value)!==editingOriginalQty;$("adjustment-note-field").classList.toggle("hidden",!changed);$("p-adjustment-note").required=changed;if(!changed)$("p-adjustment-note").value=""}
$("p-qty").addEventListener("input",updateAdjustmentNoteField);
$("product-form").addEventListener("submit",async e=>{
e.preventDefault();
const id=$("product-id").value;
const name=$("p-name").value.trim(),unit=$("p-unit").value.trim();
if(!name||!unit){msg("Preencha o nome e a unidade.");return}
const data={name,category:$("p-category").value.trim(),unit,qty:Number($("p-qty").value),min:Number($("p-min").value||0),notes:$("p-notes").value.trim()};
const quantityChanged=Boolean(id)&&editingOriginalQty!==null&&data.qty!==editingOriginalQty;
const adjustmentNote=$("p-adjustment-note").value.trim();
if(!Number.isFinite(data.qty)||!Number.isFinite(data.min)||data.qty<0||data.min<0){msg("Use quantidades iguais ou maiores que zero.");return}
if(quantityChanged&&!adjustmentNote){msg("Informe o motivo do ajuste de estoque.");$("p-adjustment-note").focus();return}
if(REMOTE_MODE){
  try{
    if(id)await apiRequest("/api/products/"+encodeURIComponent(id),{method:"PUT",body:{...data,adjustmentNote}});
    else await apiRequest("/api/products",{method:"POST",body:data});
    await refreshRemote();resetForm();msg(id?"Produto atualizado no estoque compartilhado.":"Produto cadastrado no estoque compartilhado.");
  }catch(error){msg(error.message)}
  return;
}
if(id){const ix=products.findIndex(p=>p.id===id);if(ix>=0){const old=products[ix];if(old.qty!==data.qty)moves.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),date:new Date().toISOString(),productId:id,name,unit,type:data.qty>old.qty?"entrada":"saida",qty:Math.abs(data.qty-old.qty),after:data.qty,note:adjustmentNote});products[ix]={...old,...data}}msg("Produto atualizado.")}else{data.id=crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random();products.push(data);if(data.qty>0)moves.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now())+"-initial",date:new Date().toISOString(),productId:data.id,name,unit,type:"entrada",qty:data.qty,after:data.qty,note:"Saldo inicial"});msg("Produto cadastrado.")}
save();resetForm()
});
$("cancel-edit").addEventListener("click",resetForm);
$("products-table").addEventListener("click",async e=>{
const edit=e.target.closest("[data-edit]"),del=e.target.closest("[data-delete]");
if(edit){const p=products.find(p=>p.id===edit.dataset.edit);if(!p)return;$("product-id").value=p.id;$("p-name").value=p.name;$("p-category").value=p.category||"";$("p-unit").value=p.unit;$("p-qty").value=p.qty;editingOriginalQty=Number(p.qty);$("p-min").value=p.min||0;$("p-notes").value=p.notes||"";$("p-adjustment-note").value="";updateAdjustmentNoteField();$("product-title").textContent="Editar produto";$("cancel-edit").classList.remove("hidden");$("p-name").focus();window.scrollTo({top:0,behavior:"smooth"})}
if(del){const p=products.find(p=>p.id===del.dataset.delete);if(!p)return;if(confirm('Excluir "'+p.name+'"? O histórico antigo será mantido.')){if(REMOTE_MODE){try{await apiRequest("/api/products/"+encodeURIComponent(p.id),{method:"DELETE"});await refreshRemote();msg("Produto excluído do estoque compartilhado.")}catch(error){msg(error.message)}}else{products=products.filter(x=>x.id!==p.id);save();msg("Produto excluído.")}}}
});
$("product-filter").addEventListener("input",render);
$("movement-form").addEventListener("submit",async e=>{
e.preventDefault();
const p=products.find(p=>p.id===$("m-product").value),type=$("m-type").value,amount=Number($("m-qty").value);
if(!p){msg("Cadastre ou selecione um produto.");return}
if(!(amount>0)||!Number.isFinite(amount)){msg("Informe uma quantidade maior que zero.");return}
if(REMOTE_MODE){
  try{await apiRequest("/api/movements",{method:"POST",body:{productId:p.id,type,qty:amount,note:$("m-note").value.trim()}});await refreshRemote();$("movement-form").reset();msg("Movimentação registrada no estoque compartilhado.")}
  catch(error){msg(error.message)}
  return;
}
const result=Number(p.qty)+(type==="entrada"?amount:-amount);
if(result<0){msg("A saída é maior que o saldo disponível ("+qty(p)+").");return}
p.qty=Math.round((result+Number.EPSILON)*100)/100;moves.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now()),date:new Date().toISOString(),productId:p.id,name:p.name,unit:p.unit,type,qty:amount,after:p.qty,note:$("m-note").value.trim()});save();$("movement-form").reset();msg("Movimentação registrada.")
});
$("query-form").addEventListener("submit",e=>{e.preventDefault();const q=$("query-input").value.trim(),found=findProducts(q),el=$("query-result");if(!found.length){el.innerHTML='<div class="result"><div><b>Nenhum produto encontrado</b><br><small>Confira o nome ou cadastre o produto primeiro.</small></div><button class="btn small" id="query-register">Cadastrar produto</button></div>';const b=$("query-register");b.addEventListener("click",()=>{showView("produtos");$("p-name").value=q;$("p-name").focus()});return}const list=found.map(p=>'<div class="result"><div><b>'+safe(p.name)+'</b><br><small>'+safe(p.category||"Sem categoria")+' · '+status(p)+'</small></div><div><div class="qty">'+safe(qty(p))+'</div><small>Limite mínimo: '+num(p.min||0)+' '+safe(p.unit)+'</small></div><button class="btn small" data-query-pdf="'+safe(p.id)+'">PDF</button></div>').join("");el.innerHTML=list});
$("query-result").addEventListener("click",e=>{const b=e.target.closest("[data-query-pdf]");if(b){const p=products.find(p=>p.id===b.dataset.queryPdf);if(p)makePDF("Consulta de estoque",[{Produto:p.name,Categoria:p.category||"—",Quantidade:qty(p),"Limite mínimo":num(p.min||0)+" "+p.unit,Situação:statusText(p),Observação:p.notes||"—"}],"capricho-consulta-"+slug(p.name)+".pdf") }});
$("product-filter").value="";
function statusText(p){if(Number(p.qty)<=0)return"Sem estoque";if(Number(p.qty)<=Number(p.min||0))return"Estoque baixo";return"Disponível"}
function slug(s){return norm(s).replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"estoque"}
function makePDF(title,rows,filename,share){if(!window.jspdf||!window.jspdf.jsPDF){msg("O gerador de PDF precisa de conexão com a internet. Use Imprimir > Salvar como PDF como alternativa.");return}const doc=new window.jspdf.jsPDF({unit:"mm",format:"a4"});const navy=[94,48,35];doc.setFont("helvetica","bold");doc.setFontSize(17);doc.setTextColor(...navy);doc.text("Panificação Capricho",14,18);doc.setFontSize(12);doc.setTextColor(123,103,92);doc.text(title,14,26);doc.setFont("helvetica","normal");doc.setFontSize(9);doc.text("Gerado em "+new Date().toLocaleString("pt-BR"),14,32);let y=40;const keys=rows.length?Object.keys(rows[0]):[];if(!rows.length){doc.text("Nenhum produto cadastrado.",14,y)}else{const usable=180;const colW=usable/Math.max(keys.length,1);doc.setFillColor(243,233,220);doc.rect(14,y-5,usable,8,"F");doc.setTextColor(...navy);doc.setFont("helvetica","bold");doc.setFontSize(8);keys.forEach((k,i)=>doc.text(doc.splitTextToSize(k,colW-2)[0],14+i*colW,y));y+=8;doc.setFont("helvetica","normal");doc.setTextColor(45,47,65);rows.forEach((row,ri)=>{const vals=keys.map(k=>String(row[k]??"—"));const lines=vals.map((v,i)=>doc.splitTextToSize(v,colW-3));const height=Math.max(6,...lines.map(l=>l.length*4))+2;if(y+height>276){doc.addPage();y=18}if(ri%2===0){doc.setFillColor(249,245,239);doc.rect(14,y-4,usable,height,"F")}lines.forEach((ls,i)=>doc.text(ls,14+i*colW,y));y+=height})}const pages=doc.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFontSize(8);doc.setTextColor(130,130,145);doc.text("Página "+i+" de "+pages,196,288,{align:"right"})}if(share){const blob=doc.output("blob"),file=new File([blob],filename,{type:"application/pdf"});if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){navigator.share({files:[file],title:title,text:"Relatório de estoque da Panificação Capricho"}).catch(err=>{if(err.name!=="AbortError"){doc.save(filename);msg("PDF baixado para compartilhar.")}})}else{doc.save(filename);msg("PDF baixado. Anexe-o no aplicativo desejado.")}}else{doc.save(filename);msg("PDF gerado com sucesso.")}}
$("download-stock-pdf").addEventListener("click",()=>makePDF("Relatório completo do estoque",products.slice().sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map(p=>({Produto:p.name,Categoria:p.category||"—",Quantidade:qty(p),"Limite mínimo":num(p.min||0)+" "+p.unit,Situação:statusText(p),Observação:p.notes||"—"})),"capricho-estoque.pdf"));
$("share-stock-pdf").addEventListener("click",()=>makePDF("Relatório completo do estoque",products.slice().sort((a,b)=>a.name.localeCompare(b.name,"pt-BR")).map(p=>({Produto:p.name,Categoria:p.category||"—",Quantidade:qty(p),"Limite mínimo":num(p.min||0)+" "+p.unit,Situação:statusText(p),Observação:p.notes||"—"})),"capricho-estoque.pdf",true));
$("download-movements").addEventListener("click",async()=>{
  let source=moves;
  if(REMOTE_MODE){try{source=await apiRequest("/api/movements?all=1")}catch(error){msg(error.message);return}}
  makePDF("Histórico de movimentações",source.slice().sort((a,b)=>new Date(a.date)-new Date(b.date)).map(m=>({"Data e hora":dateFmt(m.date),Produto:m.name,Movimento:m.type==="entrada"?"Entrada":"Saída",Quantidade:num(m.qty)+" "+m.unit,"Saldo após":num(m.after)+" "+m.unit,Observação:m.note||"—"})),"capricho-historico-estoque.pdf");
});
$("export-backup").addEventListener("click",async()=>{
  const button=$("export-backup");button.disabled=true;
  try{
    const data=REMOTE_MODE?await apiRequest("/api/backup"):{products,moves,exportedAt:new Date().toISOString()};
    const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");a.href=url;a.download="backup-capricho-estoque.json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    msg(data.movementsTruncated?"Backup exportado; há mais de 5.000 movimentações e o histórico foi limitado.":"Backup exportado.");
  }catch(error){msg(error.message)}
  finally{button.disabled=false}
});
$("import-backup").addEventListener("change",async e=>{
const file=e.target.files[0];if(!file)return;
if(REMOTE_MODE){msg("A restauração de backup no banco online ainda não está habilitada. O estoque compartilhado não foi alterado.");e.target.value="";return}
try{const d=JSON.parse(await file.text());if(!Array.isArray(d.products)||!Array.isArray(d.moves))throw new Error("Formato inválido");if(!confirm("A importação substituirá os dados atuais deste navegador. Continuar?"))return;products=d.products;moves=d.moves;save();resetForm();msg("Backup restaurado.")}catch(err){msg("Não foi possível ler o backup. Escolha um JSON exportado pelo aplicativo.")}finally{e.target.value=""}});
load();render();initRemote();
})();
