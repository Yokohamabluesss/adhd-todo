import * as g from './rules.ts';
import type { Board, Priority, Task, Workspace } from './rules.ts';

export const SAMPLE_VERSION = 5;
export const upgradedSampleName = 'Sample board (full grid)';

function addSampleOneOffs(b:Board,at:number) {
  const examples = [
    {title:'Return a library book',category:'Errands',minutes:10},
    {title:'Book a dentist appointment',category:'Home',minutes:5},
    {title:'Email my draft to my advisor',category:'Writing',minutes:15},
  ];
  for(const example of examples) {
    if([...b.temporary.slots,...b.cells].some(t=>g.isTask(t) && t.library==='temporary' && t.title===example.title)) continue;
    const slot=b.temporary.slots.indexOf(null);
    if(slot<0) break;
    const task:Task={...example,library:'temporary',priority:'Standard',due:'',source:g.newId()};
    b.temporary.slots[slot]=task;
    g.recordEvent(b,'created',{source:task.source,library:task.library,category:task.category,priority:task.priority},at);
  }
}

// Compare the complete saved demo with its original seed before retiring it.
// UUIDs differ on every replay, and SQLite can reorder object keys on import.
function comparableSample(board:Board) {
  const ids=new Map<string,number>();
  return JSON.stringify({...board,name:'',sampleUpdated:undefined,categories:g.boardCategories(board)},(key,value)=>{
    if(typeof value==='string' && ['id','source','placement','round','board'].includes(key)) {
      if(!ids.has(value)) ids.set(value,ids.size);
      return ids.get(value);
    }
    if(value && typeof value==='object' && !Array.isArray(value))
      return Object.fromEntries(Object.keys(value).sort().map(k=>[k,value[k]]));
    return value;
  });
}
function originalDemo(b:Board) {
  if((b.sampleVersion!==2 && b.sampleVersion!==3) || b.rounds.length!==38 ||
    !['Sample board',upgradedSampleName,'Sample board (small actions)'].includes(b.name)) return false;
  const date=new Date(b.rounds[0].start);
  date.setDate(date.getDate()+30);
  return comparableSample(b)===comparableSample(generateSample(date,b.sampleVersion));
}

export function updateSavedSample(state: Workspace): boolean {
  const existing=state.boards.filter(b=>b.sample && b.sampleVersion===4);
  for(const b of existing) {
    addSampleOneOffs(b,Date.now());
    b.sampleVersion=SAMPLE_VERSION;
  }
  const older = state.boards.filter(b => b.sample && (b.sampleVersion ?? 1)<SAMPLE_VERSION &&
    (!b.sampleUpdated || b.sampleVersion===2 || b.sampleVersion===3));
  if (!older.length) return existing.length>0;
  const current = state.boards.find(b => b.sample && (b.sampleVersion ?? 1) >= SAMPLE_VERSION);
  const replacement = current ?? sampleBoard();
  if (!current) {
    replacement.name = upgradedSampleName;
    state.boards.push(replacement);
  }
  if (older.some(b => b.id === state.defaultId)) state.defaultId = replacement.id;
  const pristine=new Set(older.filter(originalDemo));
  state.boards=state.boards.filter(b=>!pristine.has(b));
  for (const b of older) {
    if(pristine.has(b)) continue;
    b.sampleUpdated=true;
    if(b.sampleVersion===2 || b.sampleVersion===3) {
      delete b.sample;
      if(['Sample board',upgradedSampleName,'Sample board (small actions)'].includes(b.name))
        b.name='Saved practice ('+(b.sampleVersion===3?'projects':'original grid')+')';
    }
  }
  return true;
}

export function sampleBoard(today=new Date()) {
  return generateSample(today,SAMPLE_VERSION);
}
function generateSample(today:Date,version:number) {
  const b=g.createBoard('Sample board'); b.sample=true; b.sampleVersion=version;
  let seed=20261120;
  const random=()=>{seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296;};
  // The legacy layouts are replayed only to distinguish untouched examples from user edits.
  const projects:{title:string;category:string;priority:Priority;minutes:number;actions?:string[]}[] = version===3 ? [
    {title:'Pack for the move',category:'Moving',priority:'Standard',minutes:5,
      actions:['Label one box','Pack one book','Wrap one mug']},
    {title:'Work on my portfolio',category:'Portfolio',priority:'Low',minutes:5,
      actions:['Pick one screenshot','Write one caption','Choose a project title','Write one sentence about the result']},
    {title:'Read one page',category:'Study',priority:'Standard',minutes:5,
      actions:['Read one page']},
  ] : [
    {title:'Read one page',category:'Study',priority:'Standard',minutes:15},
    {title:'Stretch',category:'Movement',priority:'Low',minutes:5},
    {title:'Review notes',category:'Study',priority:'Standard',minutes:30},
    version===2 ? {title:'Water a plant',category:'Home',priority:'Low',minutes:5} :
      {title:'Write my paper',category:'Writing',priority:'Standard',minutes:30},
    {title:'Write a paragraph',category:'Writing',priority:'Standard',minutes:30},
  ];
  const day=new Date(today); day.setHours(9,0,0,0); day.setDate(day.getDate()-30);
  projects.forEach(({title,category,priority,minutes},i)=>{
    const source=g.newId();
    b.daily.slots[i]={title,category,priority,minutes,source,library:'daily',due:''};
    g.recordEvent(b,'created',{source,library:'daily',category,priority},+day);
  });
  const projectSlots=version===3 ? [0,1,0,1,2] : [0,1,2,3,4];
  function placeEveryday(square:number,at:number) {
    const slot=projectSlots[Math.floor(random()*projectSlots.length)];
    g.place(b,'daily',slot,square,at);
    const copy=b.cells[square];
    const actions=projects[slot].actions;
    if(actions && g.isTask(copy)) copy.title=actions[square%actions.length];
  }
  for(let d=0;d<30;d++,day.setDate(day.getDate()+1)) {
    const sessions=d%4===0?2:1;
    for(let s=0;s<sessions;s++){
      const now=new Date(day); now.setHours(9+5*s);
      const empty=b.cells.flatMap((cell,i)=>cell===null?[i]:[]);
      const mustSlot=d%3===0 && empty.length && !g.hasX(b)
        ? empty[Math.floor(random()*empty.length)] : -1;
      for(const i of empty){
        if(i===mustSlot){
          const t:Task={title:version===3?'Send one portfolio draft':'Send an outline',category:version===3?'Portfolio':'Writing',
            priority:'X',minutes:version===3?10:60,library:'temporary',due:'',source:g.newId()};
          b.temporary.slots[0]=t;
          g.recordEvent(b,'created',{source:t.source,library:t.library,category:t.category,priority:t.priority},+now);
          g.place(b,'temporary',0,i,+now);
        }else placeEveryday(i,+now);
      }
      g.start(b,now);
      const goal=d%7===0?0:1+Math.floor(random()*4);
      for(let j=0;j<goal;j++){
        const time=+now+(j+1)*600000;
        let i=g.draw(b,random);
        g.recordDraw(b,i,time-60000);
        if(j===0 && d%5===0){i=g.draw(b,random);g.recordDraw(b,i,time-30000);}
        if(d%6===0 && j===0){
          const available=b.cells.flatMap((cell,index)=>g.isTask(cell)?[index]:[]);
          i=available[Math.floor(random()*available.length)];
        }
        g.complete(b,i,time);
      }
      g.finish(b,+now+(goal+1)*600000);
    }
  }
  // The next playable round starts with a full board too.
  const afterLastRound=b.rounds[b.rounds.length-1].end!;
  b.cells.forEach((cell,i)=>{if(cell===null) placeEveryday(i,afterLastRound+1);});
  if(version===SAMPLE_VERSION) addSampleOneOffs(b,afterLastRound+1);
  return b;
}
