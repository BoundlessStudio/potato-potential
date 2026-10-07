import { shellQuote, HttpError } from "./security";
import type { AgentProvider } from "./providers";
import type { FileUpload } from "@boundless/shared";

export const FILE_TRANSFER_VERSION = 3;
export const FILE_TRANSFER_HELPER = "/home/node/.boundless/file-upload.mjs";
export const uploadStage = (id: string) =>
  `/home/node/.boundless/file-uploads/${id}`;
export function uploadDirectory(value: string) {
  const path =
    value === "~"
      ? "/home/node"
      : value.replace(/^~\//, "/home/node/").replace(/\/+$/, "");
  if (
    /[\x00-\x1f\\]/.test(path) ||
    path.split("/").some((part) => part === ".." || part === ".") ||
    !["/home/node", "/home/linuxbrew"].some(
      (root) => path === root || path.startsWith(root + "/"),
    )
  )
    throw new HttpError(
      400,
      "invalid_directory",
      "Choose a folder in /home/node or /home/linuxbrew.",
    );
  return path.replace(/\/{2,}/g, "/");
}
export function filePath(value: string) {
  if (
    !value ||
    value.length > 4096 ||
    /[\x00-\x1f\\]/.test(value) ||
    !(value.startsWith("/") || value.startsWith("~/"))
  )
    throw new HttpError(
      400,
      "invalid_path",
      "An absolute file path is required.",
    );
  return value;
}
export function transferCommand(
  command: string,
  upload: FileUpload,
  index?: number,
) {
  return `node ${shellQuote(FILE_TRANSFER_HELPER)} ${shellQuote(command)} ${shellQuote(Buffer.from(JSON.stringify({ ...upload, index })).toString("base64url"))}`;
}
export async function runTransfer(
  a37: AgentProvider,
  command: string,
  upload: FileUpload,
  index?: number,
): Promise<any> {
  const result = await a37.exec(
    upload.instanceId,
    transferCommand(command, upload, index),
  );
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    /* Provider returned no trustworthy receipt. */
  }
  if (result.exit_code || !value)
    throw new HttpError(
      result.exit_code ? (value?.code === "upload_busy" ? 409 : 400) : 502,
      value?.code || "upload_interrupted",
      value?.error || "The file transfer was interrupted. Retry this upload.",
    );
  return value;
}

// Fixed code, with all variable input supplied as encoded data. The same helper is tested on
// a local filesystem and installed in each computer's persistent home by Lifecycle.
export const fileTransferHelper = String.raw`import { createHash } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { lstat, mkdir, open, readFile, writeFile, link, unlink, rm } from 'node:fs/promises';
import { basename, dirname, join, extname } from 'node:path';
const command=process.argv[2];
const u=JSON.parse(Buffer.from(process.argv[3], 'base64url').toString('utf8'));
const roots=['/home/node','/home/linuxbrew'];
const fail=(message,code='upload_invalid')=>{const e=new Error(message);e.code=code;throw e;};
if(!/^[a-f0-9-]{36}$/.test(u.id)) fail('Invalid upload id.');
const stage='/home/node/.boundless/file-uploads/'+u.id;
const partial=join(u.directory,'.boundless-upload-'+u.id+'.partial');
const lockRoot='/home/node/.boundless/file-upload-locks';
const lockPath=lockRoot+'/'+u.id;let locked=false;
const inside=p=>roots.some(root=>p===root||p.startsWith(root+'/'));
async function safeDirectory(p,create=false) {
 if(!inside(p)||p.split('/').some(s=>s==='..'||s==='.')||/[\x00-\x1f\\]/.test(p)) fail('Destination must be in persistent storage.','invalid_directory');
 let current='';
 for(const piece of p.split('/').filter(Boolean)) {
  current+='/'+piece;
  let s;
  try{s=await lstat(current);}catch(e){if(e.code!=='ENOENT')throw e;if(!create)throw e;try{await mkdir(current,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}s=await lstat(current);}
  if(s.isSymbolicLink()||!s.isDirectory()) fail('A destination folder contains a symbolic link or is not a directory.','invalid_directory');
 }
}
async function regular(p) {
 const s=await lstat(p);
 if(!s.isFile()||s.isSymbolicLink())fail('Expected a regular file.');
 return s;
}
async function digest(p) {
 const h=createHash('sha256');let size=0;
 await regular(p);
 const fd=await open(p,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{for await(const bytes of fd.createReadStream({autoClose:false})){size+=bytes.length;h.update(bytes);}}finally{await fd.close();}
 return {size,sha256:h.digest('hex')};
}
async function entry(p){const s=await regular(p);return {name:basename(p),path:p,type:'file',size:s.size,modified:s.mtimeMs,hidden:basename(p).startsWith('.')};}
async function removePartial(){try{const s=await regular(partial);if(s.nlink!==1){const t=await regular(u.target);if(s.ino!==t.ino||s.dev!==t.dev)fail('Unsafe partial file.');}await unlink(partial);}catch(e){if(e.code!=='ENOENT')throw e;}}
async function acquire() {
 await safeDirectory(lockRoot,true);
 let boot='portable';try{boot=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();}catch{}
 try {await mkdir(lockPath,{mode:0o700});}
 catch(e) {
  if(e.code!=='EEXIST')throw e;
  await safeDirectory(lockPath);
  let live=false;
  try{const owner=JSON.parse(await readFile(join(lockPath,'owner.json'),'utf8'));if(owner.boot===boot){try{process.kill(owner.pid,0);live=true;}catch(e){if(e.code!=='ESRCH')live=true;}}}
  catch {live=Date.now()-(await lstat(lockPath)).mtimeMs<60000;}
  if(live)fail('The computer is still processing this upload. Retry shortly.','upload_busy');
  await rm(lockPath,{recursive:true});
  try{await mkdir(lockPath,{mode:0o700});}catch(e){if(e.code==='EEXIST')fail('The upload is busy. Retry shortly.','upload_busy');throw e;}
 }
 locked=true;
 await writeFile(join(lockPath,'owner.json'),JSON.stringify({pid:process.pid,boot}),{flag:'wx'});
}
try {
 await acquire();
 if(command==='prepare') {
  await safeDirectory(u.directory,true);await safeDirectory(stage,true);
  console.log(JSON.stringify({directory:u.directory}));
 } else if(command==='chunk') {
  await safeDirectory(stage);
  if(!Number.isSafeInteger(u.index)||u.index<0||u.index>=Math.ceil(u.size/2097152))fail('Invalid chunk.');
  try{const s=await regular(join(stage,u.index+'.part'));if(s.nlink!==1)fail('Unsafe chunk.');}catch(e){if(e.code!=='ENOENT')throw e;}
  console.log(JSON.stringify({ok:true}));
 } else if(command==='cleanup') {
  try{await safeDirectory(u.directory);await removePartial();}catch(e){if(e.code!=='ENOENT')throw e;}
  try{await safeDirectory(stage);await rm(stage,{recursive:true,force:true});}catch(e){if(e.code!=='ENOENT')throw e;}
  console.log(JSON.stringify({ok:true}));
 } else if(command==='complete') {
  await safeDirectory(u.directory);await safeDirectory(stage);
  if(!u.target||dirname(u.target)!==u.directory||basename(u.target).startsWith('.boundless-upload-'))fail('Invalid destination.');
  let receipt;
  try{receipt=JSON.parse(await readFile(join(stage,'receipt.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!receipt) {
   // Recover a crash after atomic publication but before the durable receipt.
   try {
    const p=await regular(partial),t=await regular(u.target);
    if(p.ino===t.ino&&p.dev===t.dev) {
     const d=await digest(u.target);
     if(d.size!==u.size||d.sha256!==u.sha256)fail('File verification failed.','checksum_mismatch');
     receipt={target:u.target,sha256:u.sha256,ino:String(t.ino)};
     await writeFile(join(stage,'receipt.json'),JSON.stringify(receipt),{flag:'wx'});
    }
   } catch(e) {if(e.code!=='ENOENT')throw e;}
  }
  if(receipt) {
   const d=await digest(u.target);const s=await regular(u.target);
   if(receipt.target!==u.target||receipt.sha256!==u.sha256||String(s.ino)!==receipt.ino||d.sha256!==u.sha256||d.size!==u.size)fail('Completed file changed.','upload_changed');
   await removePartial();
   console.log(JSON.stringify({file:await entry(u.target)}));
  } else {
   await removePartial();
   const out=await open(partial,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   const full=createHash('sha256');let size=0;
   try {
    const count=Math.ceil(u.size/2097152);
    for(let i=0;i<count;i++) {
     const part=join(stage,i+'.part');await regular(part);
     const fd=await open(part,constants.O_RDONLY|constants.O_NOFOLLOW);
     const h=createHash('sha256');let length=0;
     try{for await(const bytes of fd.createReadStream({autoClose:false})) {
      length+=bytes.length;size+=bytes.length;
      if(length>Math.min(2097152,u.size-i*2097152))fail('Chunk length changed.');
      h.update(bytes);full.update(bytes);let offset=0;
      while(offset<bytes.length){const r=await out.write(bytes,offset,bytes.length-offset);if(!r.bytesWritten)fail('Disk write failed.');offset+=r.bytesWritten;}
     }}finally{await fd.close();}
     if(length!==Math.min(2097152,u.size-i*2097152)||h.digest('hex')!==u.chunks[String(i)])fail('Chunk verification failed.','checksum_mismatch');
    }
    if(size!==u.size||full.digest('hex')!==u.sha256)fail('File verification failed.','checksum_mismatch');
    await out.sync();
   } finally {await out.close();}
   try{await link(partial,u.target);}catch(e){
    if(e.code!=='EEXIST')throw e;
    const p=await regular(partial),t=await regular(u.target);
    if(p.ino!==t.ino||p.dev!==t.dev)fail('A file already exists at this destination.','file_exists');
   }
   const s=await regular(u.target);
   await writeFile(join(stage,'receipt.json'),JSON.stringify({target:u.target,sha256:u.sha256,ino:String(s.ino)}),{flag:'wx'});
   await unlink(partial);
   console.log(JSON.stringify({file:await entry(u.target)}));
  }
 } else fail('Unknown transfer operation.');
} catch(error) {
 console.log(JSON.stringify({error:error.code==='ENOSPC'?'The computer is out of disk space.':error.message,code:error.code||'upload_invalid'}));process.exitCode=1;
} finally {
 if(locked)await rm(lockPath,{recursive:true,force:true});
}
`;

export const fileStatScript = String.raw`const fs=require('node:fs');const path=require('node:path');const p=path.resolve(Buffer.from(process.argv[1],'base64url').toString('utf8').replace(/^~(?=\/|$)/,'/home/node'));try{const s=fs.statSync(p);if(!s.isFile())throw new Error('Not a regular file');console.log(JSON.stringify({name:path.basename(p),path:p,type:'file',size:s.size,modified:s.mtimeMs,hidden:path.basename(p).startsWith('.')}));}catch(e){console.log(JSON.stringify({error:'File not found or not a regular file.',code:'file_not_found'}));process.exitCode=1;}`;

// Browsing obeys the same destination restrictions as assembly, including every ancestor.
export const directoryStatScript = String.raw`const fs=require('node:fs');const p=Buffer.from(process.argv[1],'base64url').toString('utf8');try{if(!['/home/node','/home/linuxbrew'].some(r=>p===r||p.startsWith(r+'/'))||p.split('/').some(s=>s==='.'||s==='..')||/[\x00-\x1f\\]/.test(p))throw Object.assign(new Error(),{code:'invalid_directory'});let current='';for(const piece of p.split('/').filter(Boolean)){current+='/'+piece;const s=fs.lstatSync(current);if(s.isSymbolicLink()||!s.isDirectory())throw Object.assign(new Error(),{code:'invalid_directory'});}console.log(JSON.stringify({path:p}));}catch(e){const missing=e.code==='ENOENT';console.log(JSON.stringify({error:missing?'This folder no longer exists. Choose another folder.':'Choose a regular folder in /home/node or /home/linuxbrew; symbolic links cannot be upload destinations.',code:missing?'directory_not_found':'invalid_directory'}));process.exitCode=1;}`;
