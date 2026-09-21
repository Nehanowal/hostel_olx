import test from "node:test";
import assert from "node:assert/strict";
import { preparePhoto } from "../src/preparePhoto.js";

test("small photos remain unchanged and files above the original limit are rejected", async () => {
  const small = new File(["photo"],"photo.jpg",{type:"image/jpeg"});
  assert.equal(await preparePhoto(small), small);
  await assert.rejects(preparePhoto({name:"large.jpg",size:8*1024*1024+1}), /over 8 MB/);
});

test("large phone photos are resized below the function payload limit and resources released", async t => {
  let closed=false;
  const bitmap={width:4000,height:3000,close:()=>{closed=true;}};
  const canvas={getContext:()=>({drawImage(){}}),toBlob:resolve=>resolve(new Blob(["compressed"],{type:"image/webp"}))};
  const originalBitmap = globalThis.createImageBitmap, originalDocument = globalThis.document;
  globalThis.createImageBitmap = async()=>bitmap;
  globalThis.document = {createElement:()=>canvas};
  t.after(()=>{ if (originalBitmap) globalThis.createImageBitmap=originalBitmap; else delete globalThis.createImageBitmap; if (originalDocument) globalThis.document=originalDocument; else delete globalThis.document; });
  const result=await preparePhoto({name:"phone.jpg",size:6*1024*1024});
  assert.equal(canvas.width,1600); assert.equal(canvas.height,1200);
  assert.equal(result.type,"image/webp"); assert.ok(result.size<3.5*1024*1024);
  assert.equal(closed,true);
});
