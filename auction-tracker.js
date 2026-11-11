import {parseWinningBanner,cents} from './recognition.js';

export function auctionSignal(text) {
  const win=parseWinningBanner(text);
  if(win)return {kind:'won',amount:cents(win.amount)};
  const lot=text.match(/#\s*(\d+)\b/);
  if(/starting\s*bid|is\s*winning|bids?\s*reset/i.test(text))return {kind:'active',lot:lot?.[1]||null};
  return {kind:'unknown'};
}

// Card observations are accumulated ONLY during an active auction. A persistent
// winner banner must never acquire the next card shown by the host.
export class AuctionTracker {
  constructor(){this.sequence=0;this.current=null;this.pending=null;this.closed=false;}
  begin(lot,time){this.current={key:lot?`lot-${lot}`:`segment-${++this.sequence}`,lot,start:time,votes:new Map(),evidence:null,ambiguous:false};this.pending=null;this.closed=false;}
  observe({time,text,matches=[],evidence=null}) {
    const signal=auctionSignal(text);
    if(signal.kind==='active') {
      const previous=this.pending&&!this.closed?this.finish(time,true):null;
      if(!this.current||this.closed||(signal.lot&&signal.lot!==this.current.lot))this.begin(signal.lot,time);
      this.pending=null;
      if(matches.length>1)this.current.ambiguous=true;
      for(const id of new Set(matches)){
        const old=this.current.votes.get(id)||{count:0,last:time,evidence:null};
        this.current.votes.set(id,{count:old.count+1,last:time,evidence:evidence||old.evidence});
      }
      if(evidence)this.current.evidence=evidence;
      return previous;
    }
    if(signal.kind!=='won'||this.closed)return null;
    if(!this.current)this.begin(null,time); // clip may start at a winner banner
    if(!this.pending||this.pending.amount!==signal.amount){this.pending={amount:signal.amount,count:1,time,text};return null;}
    this.pending.count++;
    return this.finish(time);
  }
  finish(time,partial=false){
    if(!this.pending||this.closed)return null;
    this.closed=true;
    const votes=[...this.current.votes].sort((a,b)=>b[1].count-a[1].count);
    const strong=votes.filter(([,v])=>v.count>=2&&this.pending.time-v.last<=8);
    const id=!this.current.ambiguous&&strong.length===1&&votes.length===1?strong[0][0]:null;
    return {eventKey:this.current.key,lot:this.current.lot,time:this.pending.time,amount:this.pending.amount,
      cardIds:id?[id]:[],suggestedIds:strong.map(([id])=>id),
      ready:!partial&&!!id,reason:partial?'Winning price seen only once':id?'Repeated card and winning-price observations':votes.length>1?'Multiple card identities observed; review lot':'Not enough recent card observations',
      evidence:id?strong[0][1].evidence:this.current.evidence,ocr:this.pending.text};
  }
  flush(time){return this.finish(time,true);}
}
