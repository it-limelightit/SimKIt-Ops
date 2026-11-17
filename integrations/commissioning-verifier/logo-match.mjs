// Multi-channel normalized cross-correlation. Integral images bound per-window statistics;
// a fixed operation budget prevents an oversized reference from monopolizing the worker.
export function findLogoMatch(image, template) {
  const {width:w,height:h,pixels}=image;
  const {width:tw,height:th,pixels:target}=template;
  if(![w,h,tw,th].every(value=>Number.isInteger(value)&&value>0)||pixels.length!==w*h*3||target.length!==tw*th*3)
    throw new Error('Invalid logo pixel data');
  if(tw>w||th>h)return null;
  const count=tw*th;
  if((w-tw+1)*(h-th+1)*count*3>500000000)throw new Error('Logo search exceeds the processing limit');
  const means=[0,0,0];
  for(let i=0;i<target.length;i++)means[i%3]+=target[i];
  for(let c=0;c<3;c++)means[c]/=count;
  const centered=new Float64Array(target.length);
  let variance=0;
  for(let i=0;i<target.length;i++){const value=target[i]-means[i%3];centered[i]=value;variance+=value*value;}
  if(variance<1e-6)return null;
  const stride=w+1,size=stride*(h+1);
  const sums=[new Float64Array(size),new Float64Array(size),new Float64Array(size),new Float64Array(size)];
  for(let y=1;y<=h;y++){
    const row=[0,0,0,0];
    for(let x=1;x<=w;x++){
      const p=((y-1)*w+x-1)*3,index=y*stride+x,above=index-stride;
      for(let c=0;c<3;c++)row[c]+=pixels[p+c];
      row[3]+=pixels[p]*pixels[p]+pixels[p+1]*pixels[p+1]+pixels[p+2]*pixels[p+2];
      for(let c=0;c<4;c++)sums[c][index]=sums[c][above]+row[c];
    }
  }
  let best=null;
  for(let y=0;y<=h-th;y++)for(let x=0;x<=w-tw;x++){
    const a=y*stride+x,b=a+tw,c=(y+th)*stride+x,d=c+tw;
    let windowVariance=sums[3][d]-sums[3][b]-sums[3][c]+sums[3][a];
    for(let channel=0;channel<3;channel++){
      const total=sums[channel][d]-sums[channel][b]-sums[channel][c]+sums[channel][a];
      windowVariance-=total*total/count;
    }
    if(windowVariance<1e-6)continue;
    let dot=0;
    for(let row=0;row<th;row++){
      const offset=((y+row)*w+x)*3,reference=row*tw*3;
      for(let k=0;k<tw*3;k++)dot+=pixels[offset+k]*centered[reference+k];
    }
    const score=Math.max(-1,Math.min(1,dot/Math.sqrt(variance*windowVariance)));
    if(!best||score>best.score)best={x,y,score};
  }
  return best;
}
