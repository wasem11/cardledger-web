import {AuctionTracker,auctionSignal} from './auction-tracker.js';
import {parseWinningBanner,cents,proceeds} from './recognition.js';
import {setupMatchingTest} from './matching-test.js';
import {visualRank} from './browser-matcher.js';
import {setupLiveCapture} from './live-capture.js';
const $=s=>document.querySelector(s),money=n=>n===null?'Not set':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let db;const req=indexedDB.open('cardledger',1);req.onupgradeneeded=()=>req.result.createObjectStore('state');req.onerror=()=>toast('Storage could not open. Try a normal browser window.');
let state={cards:[],sales:[],commission:null},worker,running=false,liveBusy=false,videoUrl,source='';
req.onsuccess=()=>{db=req.result;const read=db.transaction('state').objectStore('state').get('data');read.onsuccess=()=>{if(read.result)state=read.result;$('#commission').value=state.commission??'';render();};};
function save(){return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(state,'data');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,6500);}
function tab(id){document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!==id);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===id));$('#breadcrumb').textContent=id.toUpperCase();}
document.querySelectorAll('[data-tab],[data-go]').forEach(b=>b.onclick=()=>tab(b.dataset.tab||b.dataset.go));
function soldIds(){return new Set(state.sales.filter(s=>s.status==='confirmed').flatMap(s=>s.cardIds));}
function render(){const sold=soldIds(),sales=state.sales.filter(s=>s.status==='confirmed'),gross=sales.reduce((s,v)=>s+v.amount,0),cost=sales.reduce((s,v)=>s+v.cardIds.reduce((n,id)=>n+(state.cards.find(c=>c.id===id)?.cost||0),0),0),net=proceeds(gross,state.commission);$('#metrics').innerHTML=[['Available inventory',state.cards.filter(c=>!sold.has(c.id)).length,'Cards ready for your next stream'],['Confirmed sales',money(gross),`${sales.length} auction lots`],['Estimated margin',net===null?'Set commission':money(net-cost),'After card costs & company cut only'],['Needs review',state.sales.filter(s=>s.status==='review').length,'Automatic candidates to check']].map(([label,value,note])=>`<div class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');$('#cards').innerHTML=state.cards.length?state.cards.map(c=>`<article class="card"><img src="${c.photo}" alt="${escape(c.name)}"><h3>${escape(c.name)}</h3><small>Paid ${money(c.cost)} · ${sold.has(c.id)?'Sold':'Available'}</small></article>`).join(''):'<div class="empty">Your collection starts here. Add your first card above.</div>';renderSales();}
$('#commission').onchange=async e=>{const v=e.target.value;state.commission=v===''?null:Math.max(0,Math.min(100,Number(v)));await save();render();};
function canvas(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c;}
function hashImage(img){const c=canvas(9,8),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,9,8);const data=ctx.getImageData(0,0,9,8).data,gray=i=>data[i*4]*.299+data[i*4+1]*.587+data[i*4+2]*.114;const bits=[];for(let y=0;y<8;y++)for(let x=0;x<8;x++)bits.push(gray(y*9+x)>gray(y*9+x+1)?1:0);return bits;}
async function photo(file){const image=await createImageBitmap(file),width=Math.min(900,image.width),c=canvas(width,Math.round(width*image.height/image.width));if(c.height>4000)throw Error('Photo aspect ratio is too tall. Use a card photo.');c.getContext('2d').drawImage(image,0,0,c.width,c.height);image.close();return{photo:c.toDataURL('image/jpeg',.9),hash:hashImage(c)};}
$('#add-card').onsubmit=async e=>{e.preventDefault();try{if(!db)throw Error('Storage is not ready.');const file=$('#card-photo').files[0];if(!file)throw Error('Choose a card photo.');const cost=cents($('#card-cost').value);if(!Number.isFinite(cost)||cost<0)throw Error('Enter a valid cost.');state.cards.push({id:crypto.randomUUID(),name:$('#card-name').value.trim(),cost,...await photo(file)});await save();e.target.reset();render();toast('Card saved to your inventory.');}catch(e){toast(e.message);}};
const regions={card:{x:23,y:34,w:58,h:39},banner:{x:0,y:78,w:100,h:14}};
$('#regions').innerHTML=Object.entries(regions).map(([name,region])=>`<fieldset><legend>${name==='card'?'Foreground card':'Auction banner'}</legend>${Object.entries(region).map(([key,v])=>`<label>${key} % <input data-region="${name}" data-key="${key}" type="number" min="0" max="100" value="${v}"></label>`).join('')}</fieldset>`).join('');
document.querySelectorAll('[data-region]').forEach(i=>i.onchange=()=>regions[i.dataset.region][i.dataset.key]=Number(i.value));
function crop(video,r){if(r.w<=0||r.h<=0||r.x<0||r.y<0||r.x+r.w>100||r.y+r.h>100)throw Error('Capture regions must fit inside the frame.');const c=canvas(650,Math.round(650*(r.h*video.videoHeight)/(r.w*video.videoWidth)));c.getContext('2d').drawImage(video,r.x/100*video.videoWidth,r.y/100*video.videoHeight,r.w/100*video.videoWidth,r.h/100*video.videoHeight,0,0,c.width,c.height);return c;}
function log(text){const el=$('#log');if(el.textContent==='No frames analyzed yet.')el.textContent='';const line=document.createElement('div');line.textContent=text;el.prepend(line);while(el.children.length>100)el.lastChild.remove();}
function seek(time){return new Promise((resolve,reject)=>{const v=$('#video');if(Math.abs(v.currentTime-time)<.02&&v.readyState>=2)return resolve();const timer=setTimeout(()=>{cleanup();reject(Error('Video seek timed out.'));},15000);const cleanup=()=>{clearTimeout(timer);v.removeEventListener('seeked',done);v.removeEventListener('error',bad);};const done=()=>{cleanup();resolve();},bad=()=>{cleanup();reject(Error('This browser could not decode the video. Try an H.264 MP4.'));};v.addEventListener('seeked',done,{once:true});v.addEventListener('error',bad,{once:true});v.currentTime=time;});}
$('#video-file').onchange=e=>{if(running)return;const f=e.target.files[0];if(!f)return;if(videoUrl)URL.revokeObjectURL(videoUrl);source=`${f.name}:${f.size}:${f.lastModified}`;videoUrl=URL.createObjectURL(f);$('#video').src=videoUrl;$('#run').disabled=true;$('#status').textContent='Loading video…';};
$('#video').onloadeddata=()=>{$('#run').disabled=false;$('#status').textContent=`Ready · ${Math.round($('#video').duration)} seconds. Add inventory before analyzing to enable matching.`;};$('#video').onerror=()=>{$('#status').textContent='Video could not be loaded. Try an H.264 MP4.';};
$('#stop').onclick=()=>{running=false;$('#status').textContent='Stopping after the current OCR operation…';};
$('#run').onclick=async()=>{
 const v=$('#video');if(liveBusy||!db||!Number.isFinite(v.duration))return;
 running=true;$('#run').disabled=true;$('#stop').disabled=false;$('#video-file').disabled=true;v.controls=false;v.pause();
 const step=Math.max(.5,Math.min(10,Number($('#interval').value)||2)),tracker=new AuctionTracker(),auto=$('#auto-match').checked;
 let lastBanner=null,lastFront=null;
 async function record(event){
  if(!event||state.sales.some(s=>s.source===source&&(s.eventKey===event.eventKey||Math.abs(s.time-event.time)<3)))return;
  const accepted=auto&&event.ready&&event.cardIds.every(id=>!soldIds().has(id));
  const row={id:crypto.randomUUID(),source,eventKey:event.eventKey,time:event.time,amount:event.amount,status:accepted?'confirmed':'review',cardIds:accepted?event.cardIds:[],suggestedId:event.suggestedIds[0]||null,score:0,reason:event.reason,evidence:event.evidence||lastFront,banner:lastBanner,ocr:event.ocr,cardText:''};
  state.sales.push(row);await save();render();log(Math.floor(row.time)+'s · winning bid '+money(row.amount)+' · '+row.status+' · '+event.reason);
 }
 try{
  if(!window.Tesseract)throw Error('OCR library is missing. Run npm install first.');
  $('#status').textContent='Loading local OCR engine…';
  worker??=await Tesseract.createWorker('eng',1,{workerPath:'./vendor/tesseract.js/dist/worker.min.js',corePath:'./vendor/tesseract.js-core'});
  for(let t=0;t<v.duration-.15&&running;t+=step){
   await seek(t);const front=crop(v,regions.card),banner=crop(v,regions.banner);
   const {data}=await worker.recognize(banner),signal=auctionSignal(data.text);
   const evidence=front.toDataURL('image/jpeg',.65);lastFront=evidence;
   let matches=[];
   if(signal.kind==='active'&&state.cards.length){
    const result=await visualRank(state.cards,front);
    // Multiple plausible identities remain ambiguous, including identical copies.
    const plausible=result.ranked.filter(m=>m.score>=10&&m.inliers>=12&&m.ratio>=.4);
    matches=plausible.length>1?plausible.map(m=>m.card.id):result.accepted?[result.accepted.card.id]:[];
   }
   if(signal.kind==='won')lastBanner=banner.toDataURL('image/jpeg',.8);
   await record(tracker.observe({time:t,text:data.text,matches,evidence}));
   $('#progress').value=t/v.duration*100;$('#status').textContent='Analyzing '+Math.floor(t)+' / '+Math.round(v.duration)+' seconds · '+state.sales.filter(s=>s.source===source).length+' candidates';
   const preview=$('#preview');preview.width=banner.width;preview.height=banner.height;preview.getContext('2d').drawImage(banner,0,0);
  }
  await record(tracker.flush(v.currentTime));
  $('#status').textContent=running?'Analysis complete. Check Sales & review for detected candidates.':'Stopped. Saved candidates are available in Sales & review.';if(running)$('#progress').value=100;
 }catch(e){$('#status').textContent='Analysis stopped: '+e.message;log(e.message);}
 finally{running=false;$('#run').disabled=false;$('#stop').disabled=true;$('#video-file').disabled=false;v.controls=true;}
};
function renderSales(){const el=$('#sales-list');el.innerHTML=state.sales.length?state.sales.slice().reverse().map(s=>`<article class="panel sale"><div><img src="${s.evidence}" alt="Card evidence"><img src="${s.banner}" alt="Winning bid evidence"></div><div><span class="badge ${s.status==='confirmed'?'confirmed':''}">${escape(s.status)}</span><h3>${money(s.amount)} winning bid · ${Math.floor(s.time/60)}:${String(Math.floor(s.time%60)).padStart(2,'0')}</h3><p>${escape(s.source.split(':')[0])}<br>${s.suggestedId?'Suggested: '+escape(state.cards.find(c=>c.id===s.suggestedId)?.name||'Unknown'):'No inventory match'} · ${escape(s.reason||'Visual suggestion; review required')}</p>${s.status==='review'?`<label>Match inventory (Ctrl / Cmd to select a multi-card lot)<select multiple data-lot="${s.id}">${state.cards.filter(c=>!soldIds().has(c.id)).map(c=>`<option value="${c.id}" ${s.suggestedId===c.id?'selected':''}>${escape(c.name)} · cost ${money(c.cost)}</option>`).join('')}</select></label><div class="actions"><button class="primary" data-confirm="${s.id}">Confirm match</button><button data-ignore="${s.id}">Ignore candidate</button></div>`:`<p>${s.cardIds.map(id=>escape(state.cards.find(c=>c.id===id)?.name||'Unknown')).join(' + ')}</p><button data-reopen="${s.id}">Reopen review</button>`}<details><summary>OCR evidence</summary><p>${escape(s.ocr)}</p></details></div></article>`).join(''):'<div class="empty">No sales yet. Analyze a recording to capture winning bids.</div>';el.querySelectorAll('[data-confirm]').forEach(b=>b.onclick=async()=>{const sale=state.sales.find(s=>s.id===b.dataset.confirm),select=el.querySelector(`[data-lot="${sale.id}"]`),ids=[...select.selectedOptions].map(o=>o.value);if(!ids.length)return toast('Select at least one inventory card.');if(ids.some(id=>soldIds().has(id)))return toast('A selected card is already sold.');sale.cardIds=ids;sale.status='confirmed';await save();render();});el.querySelectorAll('[data-ignore]').forEach(b=>b.onclick=async()=>{state.sales.find(s=>s.id===b.dataset.ignore).status='ignored';await save();render();});el.querySelectorAll('[data-reopen]').forEach(b=>b.onclick=async()=>{const s=state.sales.find(s=>s.id===b.dataset.reopen);s.status='review';s.cardIds=[];await save();render();});}
function download(name,data,type){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#export').onclick=()=>download('cardledger-backup.json',JSON.stringify(state),'application/json');
$('#restore').onchange=async e=>{try{const data=JSON.parse(await e.target.files[0].text());if(!Array.isArray(data.cards)||!Array.isArray(data.sales)||!data.cards.every(c=>typeof c.id==='string'&&typeof c.name==='string'&&Number.isInteger(c.cost)&&c.cost>=0&&/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(c.photo)&&Array.isArray(c.hash)&&c.hash.length===64&&c.hash.every(v=>v===0||v===1))||!data.sales.every(s=>typeof s.id==='string'&&Number.isInteger(s.amount)&&s.amount>0&&Array.isArray(s.cardIds)&&typeof s.evidence==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s.evidence)&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s.banner)&&typeof s.source==='string'&&typeof s.ocr==='string'&&Number.isFinite(s.time)&&Number.isFinite(s.score)&&['review','confirmed','ignored'].includes(s.status))||!(data.commission===null||Number.isFinite(data.commission)&&data.commission>=0&&data.commission<=100))throw Error('Invalid backup.');if(!confirm('Replace this browser’s inventory and sales with the backup? Export your current backup first.'))return;state=data;await save();$('#commission').value=state.commission??'';render();toast('Backup restored.');}catch(e){toast(e.message);}finally{e.target.value='';}};
$('#csv').onclick=()=>{const quote=v=>'"'+String(v).replaceAll('"','""')+'"';const lines=[['Cards','Winning bid USD','Purchase cost USD','Company commission percent','Estimated margin USD','Status','Recording seconds']];for(const s of state.sales.filter(s=>s.status==='confirmed')){const cost=s.cardIds.reduce((n,id)=>n+(state.cards.find(c=>c.id===id)?.cost||0),0),net=proceeds(s.amount,state.commission);lines.push([s.cardIds.map(id=>state.cards.find(c=>c.id===id)?.name).join(' + '),(s.amount/100).toFixed(2),(cost/100).toFixed(2),state.commission??'',net===null?'':((net-cost)/100).toFixed(2),s.status,s.time]);}download('cardledger-sales.csv',lines.map(r=>r.map(quote).join(',')).join('\r\n'),'text/csv');};

render();
setupMatchingTest(()=>state.cards);
setupLiveCapture({
 ready:()=>!!db,busy:()=>running||liveBusy,navigate:tab,getCards:()=>state.cards,
 setBusy:value=>{liveBusy=value;$('#run').disabled=value||!Number.isFinite($('#video').duration);$('#video-file').disabled=value;$('#restore').disabled=value;},
 recognize:async banner=>{worker??=await Tesseract.createWorker('eng',1,{workerPath:'./vendor/tesseract.js/dist/worker.min.js',corePath:'./vendor/tesseract.js-core'});return worker.recognize(banner);},
 saveEvent:async event=>{
  if(state.sales.some(s=>s.source===event.source&&s.eventKey===event.eventKey))return;
  const confirmed=event.auto&&event.ready&&event.cardIds.every(id=>!soldIds().has(id));
  const row={id:crypto.randomUUID(),source:event.source,eventKey:event.eventKey,time:event.time,amount:event.amount,status:confirmed?'confirmed':'review',cardIds:confirmed?event.cardIds:[],suggestedId:event.suggestedIds[0]||null,score:0,reason:event.reason,evidence:event.evidence,banner:event.banner,ocr:event.ocr,cardText:''};
  state.sales.push(row);try{await save();}catch(error){state.sales=state.sales.filter(s=>s!==row);throw error;}render();
 }
});
$('#match-samples').hidden=true;const hero=$('.hero');hero.querySelector('h2').textContent='Let the stream do the bookkeeping.';hero.querySelector('p').textContent='Add your inventory, share the stream window on this PC, and watch for winning prices and card matches.';hero.querySelector('button').textContent='Open live monitor →';hero.querySelector('button').onclick=()=>tab('live');hero.querySelector('small').textContent='Experimental. Check capture regions before every session.';
