import {extractFeatures,compareFeatures,chooseVisualMatch} from './visual-matcher.js';
let loading;
const cache=new Map();
export function loadVision(){
  return loading??=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='./vendor/@techstark/opencv-js/dist/opencv.js';
    script.onerror=()=>reject(Error('Visual engine could not load. Run npm install.'));
    script.onload=async()=>{try{let cv=await window.cv;if(!cv?.Mat)await new Promise((done,bad)=>{const timer=setTimeout(()=>bad(Error('Visual engine initialization timed out.')),30000);cv.onRuntimeInitialized=()=>{clearTimeout(timer);done();};});resolve(cv);}catch(e){reject(e);}};
    document.head.append(script);
  });
}
export function scaledCanvas(image){
  const w=image.videoWidth||image.naturalWidth||image.width,h=image.videoHeight||image.naturalHeight||image.height;
  const c=document.createElement('canvas');c.width=Math.min(900,w);c.height=Math.round(h*c.width/w);
  c.getContext('2d').drawImage(image,0,0,c.width,c.height);return c;
}
export async function imageFrom(src){const img=new Image();img.src=src;await img.decode();return img;}
export async function canvasFeatures(canvas){const cv=await loadVision(),ctx=canvas.getContext('2d',{willReadFrequently:true});return extractFeatures(cv,ctx.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);}
export async function visualRank(cards,image){
  const cv=await loadVision(),query=await canvasFeatures(scaledCanvas(image)),ranked=[];
  for(const card of cards){let entry=cache.get(card.id);if(!entry||entry.photo!==card.photo){entry={photo:card.photo,features:await canvasFeatures(scaledCanvas(await imageFrom(card.photo)))};cache.set(card.id,entry);}ranked.push({card,...compareFeatures(cv,entry.features,query)});}
  ranked.sort((a,b)=>b.score-a.score);return{ranked,accepted:chooseVisualMatch(ranked)};
}
