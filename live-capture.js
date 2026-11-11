import {AuctionTracker,auctionSignal} from './auction-tracker.js';
import {visualRank} from './browser-matcher.js';

export function setupLiveCapture({ready,busy,setBusy,getCards,recognize,saveEvent,navigate}) {
 const nav=document.createElement('button');nav.dataset.tab='live';nav.textContent='◉   Live monitor';nav.onclick=()=>navigate('live');document.querySelector('nav').append(nav);
 const page=document.createElement('section');page.id='live';page.className='page';page.hidden=true;
 page.innerHTML=`<div class="eyebrow">LOCAL SCREEN CAPTURE</div><h1>Watch your sales come in.</h1>
 <p class="subtitle">Open the TikTok stream on this PC, then share its browser tab or window. Cards and winning prices are processed locally.</p>
 <article class="panel"><ol><li>Open the stream as a viewer in another tab or window.</li><li>Choose that tab or window below. Do not select CardLedger itself.</li><li>On the preview, draw a box around the card area and another around the auction banner. Include the “won” and “Winning bid” text.</li></ol>
 <div class="controls"><button id="live-share" class="primary">Choose stream window</button><button id="live-start" disabled>Start monitoring</button><button id="live-stop" disabled>Stop sharing</button></div>
 <p id="live-status" role="status">Ready to choose a stream. No recording uploads or paid cloud processing.</p>
 <label>Draw region<select id="live-region"><option value="card">Card area (green)</option><option value="banner">Auction banner (yellow)</option></select></label>
 <canvas id="live-view" hidden style="width:100%;touch-action:none;height:auto" aria-label="Stream preview: drag to select capture regions"></canvas>
 <video id="live-video" muted playsinline hidden></video>
 <label><input id="live-auto" type="checkbox"> Automatically confirm consistent single-card matches (experimental)</label>
 <p>Keep the stream playing, the PC awake, and CardLedger open. Leave the window size unchanged after selecting regions. Only sale evidence is saved, not the full stream. First use downloads OCR language data. A stream without visible winning banners cannot provide final prices.</p>
 <p>Check Sales &amp; review for candidates. Start a new session after an interruption; repeated auctions across sessions may need deduplication. Phone and PC inventories are not synced yet.</p></article>`;
 document.querySelector('main').append(page);
 const $=s=>document.querySelector(s),video=$('#live-video'),view=$('#live-view'),ctx=view.getContext('2d');
 const regions={card:{x:.23,y:.34,w:.58,h:.39},banner:{x:0,y:.78,w:1,h:.14}};
 let stream=null,active=false,selecting=false,processing=false,closing=false,tracker=null,source='',started=0,timer,previewTimer,lastFront,lastBanner,drag=null,region='card',dimensions='';
 const status=text=>$('#live-status').textContent=text;
 function controls(){
  $('#live-share').disabled=selecting||!!stream||closing||busy();
  $('#live-start').disabled=!stream||active||closing;
  $('#live-stop').disabled=!stream||closing;
  $('#live-region').disabled=active||closing;
  $('#live-auto').disabled=active||closing;
 }
 const frame=()=>{const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);return c;};
 function crop(image,r){const c=document.createElement('canvas');c.width=650;c.height=Math.max(1,Math.round(650*r.h*image.height/(r.w*image.width)));if(c.height>4000)throw Error('Selected region is too narrow. Select a wider rectangle.');c.getContext('2d').drawImage(image,r.x*image.width,r.y*image.height,r.w*image.width,r.h*image.height,0,0,c.width,c.height);return c;}
 function preview(){
  if(!stream||video.readyState<2)return;
  const size=video.videoWidth+'x'+video.videoHeight;
  if(active&&dimensions!==size){void stop('Capture size changed. Select the window again and check both regions.');return;}
  view.hidden=false;view.width=Math.min(1000,video.videoWidth);view.height=Math.round(video.videoHeight*view.width/video.videoWidth);ctx.drawImage(video,0,0,view.width,view.height);
  for(const [name,r] of Object.entries(regions)){
   ctx.strokeStyle=name==='card'?'#2bffb2':'#ffcf59';ctx.lineWidth=3;ctx.strokeRect(r.x*view.width,r.y*view.height,r.w*view.width,r.h*view.height);
   ctx.fillStyle=ctx.strokeStyle;ctx.font='16px sans-serif';ctx.fillText(name==='card'?'CARD':'AUCTION BANNER',r.x*view.width+5,Math.max(18,r.y*view.height+18));
  }
 }
 function point(e){const r=view.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))};}
 view.onpointerdown=e=>{if(!stream||active||closing)return;drag=point(e);view.setPointerCapture(e.pointerId);};
 view.onpointerup=e=>{if(!drag)return;const end=point(e),r={x:Math.min(drag.x,end.x),y:Math.min(drag.y,end.y),w:Math.abs(end.x-drag.x),h:Math.abs(end.y-drag.y)};drag=null;if(r.w<.03||r.h<.02)return status('Draw a larger region.');regions[region]=r;preview();status('Region updated. Select the other region, then start monitoring.');};
 view.onpointercancel=()=>{drag=null;};
 $('#live-region').onchange=e=>{region=e.target.value;};
 async function record(event){if(event)await saveEvent({...event,source,evidence:event.evidence||lastFront,banner:lastBanner,auto:$('#live-auto').checked});}
 async function sample(){
  if(!active)return;processing=true;
  try{
   if(video.readyState<2||stream.getVideoTracks()[0]?.muted){status('Waiting for visible stream frames…');return;}
   const image=frame(),front=crop(image,regions.card),banner=crop(image,regions.banner),time=(performance.now()-started)/1000;
   const {data}=await recognize(banner),signal=auctionSignal(data.text);lastFront=front.toDataURL('image/jpeg',.65);
   let matches=[];
   if(signal.kind==='active'&&getCards().length){const result=await visualRank(getCards(),front),plausible=result.ranked.filter(m=>m.score>=10&&m.inliers>=12&&m.ratio>=.4);matches=plausible.length>1?plausible.map(m=>m.card.id):result.accepted?[result.accepted.card.id]:[];}
   if(signal.kind==='won')lastBanner=banner.toDataURL('image/jpeg',.8);
   await record(tracker.observe({time,text:data.text,matches,evidence:lastFront}));
   if(active)status('Monitoring · '+Math.floor(time)+' seconds · '+(signal.kind==='won'?'winning banner detected':signal.kind==='active'?'auction in progress':'waiting for auction text'));
  }catch(e){active=false;status('Monitoring stopped: '+e.message);}
  finally{processing=false;if(active)timer=setTimeout(sample,1000);else await finish();}
 }
 async function finish(){
  if(processing)return;
  try{if(tracker)await record(tracker.flush((performance.now()-started)/1000));}
  catch(e){status('Could not save the final candidate: '+e.message);}
  tracker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;view.hidden=true;clearInterval(previewTimer);clearTimeout(timer);closing=false;setBusy(false);controls();
 }
 async function stop(message='Monitoring stopped. Saved candidates are in Sales & review.'){
  active=false;closing=true;clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());status(message);controls();await finish();
 }
 $('#live-share').onclick=async()=>{
  if(busy()||!ready())return status('Wait for storage or the other analysis to finish.');
  if(!navigator.mediaDevices?.getDisplayMedia)return status('Screen capture needs desktop Chrome or Edge on localhost. It is not available here.');
  selecting=true;setBusy(true);controls();
  try{
   stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:5,max:10}},audio:false,selfBrowserSurface:'exclude',surfaceSwitching:'exclude'});
   video.srcObject=stream;await video.play();dimensions=video.videoWidth+'x'+video.videoHeight;
   stream.getVideoTracks()[0].addEventListener('ended',()=>void stop('Screen sharing ended. Saved candidates are in Sales & review.'),{once:true});
   previewTimer=setInterval(preview,300);preview();status('Check the preview. Draw the card area and auction banner area, then start monitoring.');
  }catch(e){stream?.getTracks().forEach(t=>t.stop());stream=null;setBusy(false);status(e.name==='NotAllowedError'?'Screen sharing cancelled or denied. Choose a stream window to try again.':'Could not share screen: '+e.message);}
  finally{selecting=false;controls();}
 };
 $('#live-start').onclick=()=>{if(!stream||active)return;tracker=new AuctionTracker();source='Live '+new Date().toLocaleString()+':'+crypto.randomUUID();started=performance.now();lastFront=null;lastBanner=null;active=true;dimensions=video.videoWidth+'x'+video.videoHeight;controls();status('Loading recognition…');void sample();};
 $('#live-stop').onclick=()=>void stop();
 window.addEventListener('beforeunload',()=>stream?.getTracks().forEach(t=>t.stop()));
 controls();
}
