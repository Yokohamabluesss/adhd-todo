// Emit expected snapshots from the production TypeScript rules for the Python suite.
import * as g from '../src/rules.ts';

const cases = [];
function scenario(name,setup,actions) {
  const b=g.createBoard(name);
  for (let i=0;i<9;i++) b.daily.slots[i]={
    source:'source-'+i,title:'task-'+i,library:'daily',priority:i===2?'X':i%2?'Low':'Standard',
    minutes:[59,60,5][i%3],category:'study',due:'',
  };
  b.temporary.slots[0]={...b.daily.slots[0],library:'temporary',source:'oneoff'};
  setup(b);
  const initial=structuredClone(b), steps=[];
  let at=+new Date(2026,10,19,3,59);
  for(const a of actions) {
    at+=10_000;
    const random=()=>a.random ?? 0.31;
    let result=null,error=null;
    try {
      switch(a.kind) {
        case 'start': g.start(b,new Date(at)); break;
        case 'place': g.place(b,a.library,a.from,a.to,at); break;
        case 'fill': g.randomFill(b,a.daily,random,at); break;
        case 'copy': g.copyTask(b,a.from,a.index,at); break;
        case 'convert': g.moveBetweenLibraries(b,a.from,a.index,a.slot); break;
        case 'pick': result=g.draw(b,random); break;
        case 'recordDraw': g.recordDraw(b,a.index,at); break;
        case 'complete': g.complete(b,a.index,at); break;
        case 'shuffle': g.shuffle(b,random,at); break;
        case 'finish': g.finish(b,at); break;
        case 'reset': a.day=g.roundDay(new Date(at),b.dayStart); g.resetBoard(b,a.scope,new Date(at)); break;
        case 'move': g.move(b,a.from,a.to); break;
        case 'return': g.removeFromBoard(b,a.index,a.destination); break;
        case 'discard': g.deletePlacedTask(b,a.index); break;
      }
    } catch (err) {error=err.message;}
    // The TS return/discard helpers use the wall clock internally.
    if(['return','discard'].includes(a.kind) && !error) {
      b.events.at(-1).at=at;
      b.events.at(-1).day=g.active(b)?.day ?? g.roundDay(new Date(at),b.dayStart);
    }
    g.discardUnusedImages(b);
    steps.push({action:a,at,result,error,state:structuredClone(b)});
  }
  cases.push({initial,steps});
}
const place=(from,to,library='daily')=>({kind:'place',from,to,library});
const complete=index=>({kind:'complete',index});
scenario('Bingo with a remaining Must-do',b=>{
  b.grouped=true;
  b.daily.slots[0].steps={size:2,slots:[{title:'open',done:true,doneDay:'2026-11-18'},null,null,null]};
},[place(0,0),place(1,1),place(3,2),place(2,7),{kind:'start'},{kind:'pick'},{kind:'recordDraw',index:7},
  complete(0),complete(1),complete(2),{kind:'move',from:7,to:5},complete(7),complete(7),
  {kind:'shuffle',random:0.99},{kind:'finish'},{kind:'reset',scope:'all'}]);
scenario('Weights, copies and early stop',b=>{b.weights={Standard:1,Low:3};},
  [place(0,0),place(1,1),place(0,3),place(0,8,'temporary'),{kind:'move',from:3,to:4},
   {kind:'start'},...[0,0.17,0.5,0.99].map(random=>({kind:'pick',random})),
   {kind:'recordDraw',index:1},{kind:'return',index:8,destination:{library:'daily'}},
   {kind:'return',index:8,destination:{library:'temporary',slot:3}},{kind:'discard',index:4},
   complete(1),{kind:'shuffle',random:0.999},{kind:'finish'},{kind:'start'},{kind:'reset',scope:'grid'}]);
scenario('Restore steps and legacy marks',b=>{
  b.cells[0]=structuredClone(b.daily.slots[0]);
  b.cells[0].steps={size:2,slots:[{title:'a',done:true,doneDay:'2026-11-18'},null,null,null]};
  b.cells[1]=structuredClone(b.daily.slots[1]);
  const t=+new Date(2026,10,18,20);
  g.start(b,new Date(t)); g.complete(b,0,t); delete b.cells[0].entry;
},[{kind:'reset',scope:'today'},{kind:'start'},complete(0),complete(1),{kind:'finish'}]);
for (const [name,line] of [['row',[0,1,2]],['column',[1,4,7]],['diagonal',[0,4,8]],['reverse diagonal',[2,4,6]]]) {
  const extra=[0,1,2,3,4,5,6,7,8].find(i=>!line.includes(i));
  scenario(name,b=>{b.dayStart='02:45';},[
    ...line.map(i=>place(0,i)),place(2,extra),{kind:'start'},...line.map(complete),
    {kind:'recordDraw',index:extra},{kind:'discard',index:extra},{kind:'finish'},
  ]);
}
scenario('Empty squares and sparse clear',()=>{},[
  {kind:'start'},place(0,0),place(0,1),{kind:'start'},complete(0),{kind:'finish'},
  {kind:'start'},complete(1),{kind:'pick'},{kind:'finish'},{kind:'reset',scope:'grid'},
]);
scenario('Repeated copies with row grouping',b=>{
  b.grouped=true;
},[...Array.from({length:9},(_,i)=>place(0,i)),{kind:'start'},{kind:'shuffle'},complete(0),
  {kind:'shuffle',random:0.999},{kind:'finish'}]);
scenario('Copy placements and convert library tasks',b=>{
  b.daily.slots[0].note={text:'Read https://example.org'};
  b.daily.slots[0].steps={size:2,slots:[{title:'Chapter one',done:false},null,null,null]};
},[place(0,0),{kind:'start'},{kind:'copy',from:'board',index:0},
   {kind:'convert',from:'daily',index:0,slot:0},{kind:'convert',from:'daily',index:0,slot:2},
   {kind:'copy',from:'board',index:0},{kind:'copy',from:'temporary',index:2},
   {kind:'convert',from:'temporary',index:1},complete(0),{kind:'copy',from:'board',index:0}]);
scenario('Random fill with quotas, shortages and marked squares',b=>{
  b.temporary.slots[3]={...b.temporary.slots[0],source:'urgent',priority:'X'};
},[place(0,0),{kind:'start'},complete(0),{kind:'fill',daily:9},{kind:'fill',daily:2},
   {kind:'fill',daily:0},{kind:'fill',daily:4},{kind:'fill',daily:0}]);
console.log(JSON.stringify(cases));
