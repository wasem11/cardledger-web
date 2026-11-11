export function parseWinningBanner(text){
 if(!/\bwon\b/i.test(text)||!/winning\s*bid/i.test(text))return null;
 const m=text.match(/winning\s*bid\s*[:\-]?\s*\$\s*(\d+(?:[.,]\d{1,2})?)/i);
 if(!m)return null; const amount=Number(m[1].replace(',','.'));return Number.isFinite(amount)&&amount>0?{amount}:null;
}
export function similarity(a,b){if(!a?.length||a.length!==b?.length)return 0;return a.reduce((s,v,i)=>s+(v===b[i]?1:0),0)/a.length;}
export function rankMatches(cards,hash,text){const words=new Set(text.toLowerCase().match(/[a-z]{4,}/g)||[]);return cards.map(card=>{const names=card.name.toLowerCase().match(/[a-z]{4,}/g)||[];const nameMatch=names.length>0&&names.every(w=>words.has(w));const visual=similarity(hash,card.hash);return{card,visual,nameMatch,score:visual*.75+(nameMatch?.25:0)};}).sort((a,b)=>b.score-a.score);}
export function cents(value){return Math.round(Number(value)*100);}
export function proceeds(amount,commission){return commission===null?null:Math.round(amount*(1-commission/100));}
