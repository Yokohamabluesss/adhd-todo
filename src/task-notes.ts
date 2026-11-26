import { tr } from './i18n.ts';
import { esc } from './copy.ts';
import { check, NOTE_IMAGE_LIMIT, newId } from './rules.ts';
import type { Board, Task } from './rules.ts';

function imageFor(b:Board,t?:Task|null) {
  return t?.note?.image ? b.noteImages?.[t.note.image] : undefined;
}
function linkedNoteText(text:string) {
  let html = '', offset = 0;
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"“”，。！？；（）]+/gi)) {
    let label = match[0].replace(/[.,!?;:'’\]]+$/, '');
    // Keep balanced parentheses in article titles and other URL paths.
    if (label.endsWith(')')) {
      const excess = label.split(')').length - label.split('(').length;
      const trailing = label.match(/\)+$/)![0].length;
      if (excess > 0) label = label.slice(0,-Math.min(excess,trailing));
    }
    if (!URL.canParse(label)) continue;
    html += esc(text.slice(offset,match.index)) + '<a href="' + esc(new URL(label).href)
      + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>';
    offset = match.index + label.length;
  }
  return html + esc(text.slice(offset));
}
export function notePreview(b:Board,t?:Task|null) {
  if(!t?.note) return '';
  const data=imageFor(b,t);
  return `<button type="button" class="panel note-preview" data-action="view-note" aria-label="${tr("View task note")}">
    <strong>${tr("Task note")}</strong>${data?`<img src="${esc(data)}" alt="">`:''}
    ${t.note.text?`<span>${esc(t.note.text)}</span>`:''}</button>`;
}
export function noteDetails(dialog:HTMLDialogElement,b:Board,t:Task,edit:()=>void) {
  const data=imageFor(b,t);
  dialog.innerHTML=`<h2 id="dialog-title">${tr("Task note")}</h2><p class="muted">${esc(t.title)}</p>
    <div class="note-details">${t.note?.text?`<p>${linkedNoteText(t.note.text)}</p>`:''}
    ${data?`<img src="${esc(data)}" alt="${tr("Task note attachment")}">`:''}</div>
    <div class="actions"><button type="button" data-edit>${tr("Edit note")}</button><button type="button" class="primary" data-close>${tr("Close")}</button></div>`;
  dialog.setAttribute('aria-labelledby','dialog-title');
  dialog.querySelector<HTMLButtonElement>('[data-edit]')!.onclick=()=>{dialog.close();edit();};
  dialog.querySelector<HTMLButtonElement>('[data-close]')!.onclick=()=>dialog.close();
  dialog.showModal();
}

export function noteFields(t?:Task|null) {
  return `<div class="stack note-fields"><label>${tr("Note text")}<textarea name="noteText" rows="4" placeholder="${esc(tr("Write a note or paste a link (https://…)"))}">${esc(t?.note?.text ?? '')}</textarea></label>
    <label>${tr("Attach an image")}<input type="file" accept="image/jpeg,image/png,image/webp" data-image-file></label>
    <div data-attached hidden><img alt="${tr("Attached image")}"><button type="button" data-remove>${tr("Remove image")}</button></div>
    <small role="status" data-image-status></small></div>`;
}

async function resizeImage(file:File) {
  check(['image/jpeg','image/png','image/webp'].includes(file.type),'Choose a JPEG, PNG or WebP image.');
  const url=URL.createObjectURL(file);
  try {
    const img=new Image(); img.src=url;
    try { await img.decode(); } catch { throw new Error('This image could not be opened.'); }
    const canvas=document.createElement('canvas');
    let scale=Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
    const ctx=canvas.getContext('2d');
    check(ctx,'Could not prepare this image.');
    for (;;) {
      canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
      canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const data=canvas.toDataURL('image/webp',0.85);
      check(data.startsWith('data:image/'),'Could not prepare this image.');
      if(data.length<=NOTE_IMAGE_LIMIT) return data;
      scale*=0.7;
    }
  } finally { URL.revokeObjectURL(url); }
}

// The draft stays in the form until Save. Images are immutable and may be
// shared by a library template, its independent placements and past completions.
export function bindNoteFields(dialog:HTMLDialogElement,b:Board,t?:Task|null) {
  let data=imageFor(b,t);
  const fields=dialog.querySelector<HTMLElement>('.note-fields')!;
  const input=fields.querySelector<HTMLInputElement>('[data-image-file]')!;
  const attached=fields.querySelector<HTMLElement>('[data-attached]')!;
  const img=attached.querySelector('img')!;
  const status=fields.querySelector<HTMLElement>('[data-image-status]')!;
  const save=dialog.querySelector<HTMLButtonElement>('button.primary')!;
  let revision=0, loading=false;
  function preview() {
    attached.hidden=!data;
    if(data) img.src=data; else img.removeAttribute('src');
  }
  attached.querySelector('button')!.onclick=()=>{
    revision++;loading=false;save.disabled=false;data=undefined;input.value='';status.textContent='';preview();
  };
  input.onchange=async()=>{
    const file=input.files?.[0];if(!file) return;
    const token=++revision;loading=true;save.disabled=true;status.textContent=tr('Preparing image…');
    try {
      const resized=await resizeImage(file);
      if(token===revision){data=resized;preview();status.textContent='';}
    } catch(error) {
      if(token===revision) status.textContent=tr(error instanceof Error?error.message:'Could not read this image.');
    } finally {
      if(token===revision){loading=false;save.disabled=false;input.value='';}
    }
  };
  preview();
  return (board:Board,task:Task,form:FormData)=>{
    check(!loading,'Wait for the image to finish loading.');
    const text=String(form.get('noteText') ?? '');
    if(!text.trim() && !data){delete task.note;return;}
    task.note={text:text.trim()?text:''};
    if(data){
      const images=board.noteImages ??= {};
      const existing=Object.keys(images).find(id=>images[id]===data);
      const id=existing ?? newId();
      images[id]=data;task.note.image=id;
    }
  };
}
