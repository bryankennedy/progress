// Generates the full Progress PWA / favicon icon set from the master mark.
// Pure Node (zlib only) — no sharp / native deps. Run: `bun scripts/gen-icons.mjs`
// Writes into both brand-assets/ (handoff source) and public/brand-assets/ (served).
//
// Two icon purposes, by design (see brand-assets/HANDOFF.md "App-icon rules"):
//   • "any"      -> rounded squircle with TRANSPARENT corners (browser tabs etc.)
//   • "maskable" -> OPAQUE full-bleed (macOS dock / Android adaptive; the OS masks
//                   it into the squircle — transparent pixels would become a white
//                   plate, so these must be opaque edge-to-edge).
// Ship the maskable at 1024 too: Chrome uses it for the Retina dock icon and a
// 512 source upscales blurry.
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return ~c>>>0;}
function chunk(t,d){const l=Buffer.alloc(4);l.writeUInt32BE(d.length,0);const tt=Buffer.from(t,"ascii");const cc=Buffer.alloc(4);cc.writeUInt32BE(crc32(Buffer.concat([tt,d])),0);return Buffer.concat([l,tt,d,cc]);}
const hex=(h)=>{h=h.replace("#","");return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16));};
function bez(P0,C1,C2,P3,n=56){const p=[];for(let i=0;i<=n;i++){const t=i/n,u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;p.push([a*P0[0]+b*C1[0]+c*C2[0]+d*P3[0],a*P0[1]+b*C1[1]+c*C2[1]+d*P3[1]]);}return p;}
function distPoly(px,py,pts){let m=1e9;for(let i=0;i<pts.length-1;i++){const[x1,y1]=pts[i],[x2,y2]=pts[i+1];const dx=x2-x1,dy=y2-y1;const L=dx*dx+dy*dy||1e-9;let t=((px-x1)*dx+(py-y1)*dy)/L;t=t<0?0:t>1?1:t;const d=Math.hypot(px-(x1+t*dx),py-(y1+t*dy));if(d<m)m=d;}return m;}
function sdRR(px,py,half,rr){const qx=Math.abs(px-half)-(half-rr),qy=Math.abs(py-half)-(half-rr);return Math.hypot(Math.max(qx,0),Math.max(qy,0))+Math.min(Math.max(qx,qy),0)-rr;}

const CREAM = "#f5efe0", STROKE = 11, BOW = 2.5, RAD = STROKE/2;
// bottom -> top: [xLeft, xRight, centerY, color]. centers 73.75/58.75/43.75/28.75
// => spacing 15 (clear gaps at stroke 11), stack centered on y=50, taper = stack shape.
const BARS = [
  [22, 80, 73.75, "#455224"], // deep moss
  [26, 78, 58.75, "#6c7c33"], // moss
  [30, 74, 43.75, "#b25c39"], // adobe
  [34, 66, 28.75, "#d17a4f"], // salmon
].map(([xL,xR,cy,col])=>{
  const mx=(xL+xR)/2, C1=[mx-(mx-xL)*0.4,cy-BOW], C2=[mx+(xR-mx)*0.4,cy-BOW];
  const pts=bez([xL,cy],C1,C2,[xR,cy]);
  let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  for(const[x,y] of pts){if(x<minx)minx=x;if(x>maxx)maxx=x;if(y<miny)miny=y;if(y>maxy)maxy=y;}
  const r2=(n)=>Math.round(n*100)/100;
  return {pts,col:hex(col),colHex:col,bb:[minx-RAD,miny-RAD,maxx+RAD,maxy+RAD],
    pathStr:`M${r2(xL)},${r2(cy)} C${r2(C1[0])},${r2(C1[1])} ${r2(C2[0])},${r2(C2[1])} ${r2(xR)},${r2(cy)}`};
});

// mode: "full" = opaque full-bleed (maskable); "rounded" = squircle w/ transparent corners (any)
function renderPng(size, mode){
  const SS=4, big=size*SS, scale=big/100, corner=big*0.225, bg=hex(CREAM);
  const stride=size*4, raw=Buffer.alloc((stride+1)*size);
  for(let y=0;y<size;y++){
    raw[y*(stride+1)]=0;
    for(let x=0;x<size;x++){
      let r=0,g=0,b=0,cov=0;
      for(let sy=0;sy<SS;sy++)for(let sx=0;sx<SS;sx++){
        const px=x*SS+sx+0.5, py=y*SS+sy+0.5;
        const onIcon = mode==="full" ? true : sdRR(px,py,big/2,corner)<=0;
        if(onIcon){
          let col=bg; const ux=px/scale, uy=py/scale;
          for(const bar of BARS){const[a,c,d,e]=bar.bb; if(ux<a||ux>d||uy<c||uy>e) continue; if(distPoly(ux,uy,bar.pts)<=RAD) col=bar.col;}
          r+=col[0]; g+=col[1]; b+=col[2]; cov++;
        }
      }
      const N=SS*SS, o=y*(stride+1)+1+x*4;
      raw[o]=cov?Math.round(r/cov):0; raw[o+1]=cov?Math.round(g/cov):0; raw[o+2]=cov?Math.round(b/cov):0;
      raw[o+3]=mode==="rounded"?Math.round(255*cov/N):255;
    }
  }
  const sig=Buffer.from([137,80,78,71,13,10,26,10]);
  const ih=Buffer.alloc(13); ih.writeUInt32BE(size,0); ih.writeUInt32BE(size,4); ih[8]=8; ih[9]=6;
  return Buffer.concat([sig,chunk("IHDR",ih),chunk("IDAT",zlib.deflateSync(raw,{level:9})),chunk("IEND",Buffer.alloc(0))]);
}
function svg(rounded){
  const paths = BARS.map(b=>`    <path d="${b.pathStr}" stroke="${b.colHex}"></path>`).join("\n");
  const rect = rounded ? `  <rect width="100" height="100" rx="22.5" fill="${CREAM}"></rect>` : `  <rect width="100" height="100" fill="${CREAM}"></rect>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512" role="img" aria-label="Progress">\n${rect}\n  <g fill="none" stroke-linecap="round" stroke-width="${STROKE}">\n${paths}\n  </g>\n</svg>\n`;
}

for (const out of ["public/brand-assets", "brand-assets"]) {
  writeFileSync(`${out}/icon-1024.png`, renderPng(1024, "rounded"));
  writeFileSync(`${out}/icon-512.png`,  renderPng(512,  "rounded"));
  writeFileSync(`${out}/favicon-32.png`, renderPng(32, "rounded"));
  writeFileSync(`${out}/favicon-16.png`, renderPng(16, "rounded"));
  writeFileSync(`${out}/progress-icon.svg`, svg(true));
  writeFileSync(`${out}/icon-1024-maskable.png`, renderPng(1024, "full"));
  writeFileSync(`${out}/icon-512-maskable.png`,  renderPng(512,  "full"));
  writeFileSync(`${out}/progress-icon-maskable.svg`, svg(false));
  writeFileSync(`${out}/apple-touch-icon-180.png`, renderPng(180, "full"));
  console.log(`wrote icon set -> ${out}`);
}
