// Runs in Node or a browser. All descriptors and matching stay on the device.
export function extractFeatures(cv, rgba, width, height) {
  const src = cv.matFromArray(height, width, cv.CV_8UC4, rgba);
  const gray = new cv.Mat(), mask = new cv.Mat();
  const keypoints = new cv.KeyPointVector(), descriptors = new cv.Mat();
  const detector = new cv.ORB();
  try {
    detector.setMaxFeatures(2200);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    detector.detectAndCompute(gray, mask, keypoints, descriptors);
    const points = [];
    for (let i = 0; i < keypoints.size(); i++) {
      const p = keypoints.get(i).pt;
      points.push([p.x, p.y]);
    }
    return {width, height, points, cols: descriptors.cols, data: Array.from(descriptors.data)};
  } finally {
    for (const obj of [src, gray, mask, keypoints, descriptors, detector]) obj.delete();
  }
}

export function compareFeatures(cv, reference, frame) {
  const empty = {inliers: 0, matches: 0, ratio: 0, coverage: 0, score: 0};
  if (!reference?.points?.length || frame?.points?.length<2 || reference.cols !== frame.cols) return empty;
  const a = cv.matFromArray(reference.points.length, reference.cols, cv.CV_8U, reference.data);
  const b = cv.matFromArray(frame.points.length, frame.cols, cv.CV_8U, frame.data);
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false), pairs = new cv.DMatchVectorVector();
  const allocated = [a,b,matcher,pairs];
  try {
    matcher.knnMatch(a,b,pairs,2);
    const good = [], used = new Set();
    for (let i=0;i<pairs.size();i++) {
      const pair=pairs.get(i);
      if(pair.size()>=2){const m=pair.get(0),n=pair.get(1);
        if(m.distance<.75*n.distance&&m.distance<65&&!used.has(m.trainIdx)){
          good.push({query:m.queryIdx,train:m.trainIdx});used.add(m.trainIdx);
        }
      }
      pair.delete();
    }
    if(good.length<8)return {...empty,matches:good.length};
    const src=cv.matFromArray(good.length,1,cv.CV_32FC2,good.flatMap(m=>reference.points[m.query]));
    const dst=cv.matFromArray(good.length,1,cv.CV_32FC2,good.flatMap(m=>frame.points[m.train]));
    const mask=new cv.Mat();allocated.push(src,dst,mask);
    const transform=cv.findHomography(src,dst,cv.RANSAC,5,mask);allocated.push(transform);
    if(transform.empty())return {...empty,matches:good.length};
    const pts=good.filter((m,i)=>mask.data[i]).map(m=>reference.points[m.query]);
    const inliers=pts.length,ratio=inliers/good.length;
    const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
    const coverage=pts.length?(Math.max(...xs)-Math.min(...xs))*(Math.max(...ys)-Math.min(...ys))/(reference.width*reference.height):0;
    // Heuristic evidence, NOT a calibrated probability. Widely spread geometric
    // agreement is required; a few common text symbols are not enough.
    const score=inliers>=8&&ratio>=.35&&coverage>=.035?inliers*ratio:0;
    return {inliers,matches:good.length,ratio,coverage,score};
  } finally { for(const obj of allocated.reverse())obj.delete(); }
}

export function chooseVisualMatch(ranked) {
  const best=ranked[0],next=ranked[1];
  if(!best||best.score<10||best.inliers<12||best.ratio<.4)return null;
  if(next&&best.score<next.score*1.8+3)return null;
  return best;
}
